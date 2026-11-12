# Marvice Motion: every open-source video model that fits Kaggle's free 16 GB T4, same prompt, one by one.
# Each model saves /kaggle/working/<key>.mp4 as soon as it finishes; report.json is rewritten after each,
# so partial results survive a later failure. Generation is capped at 60 minutes per model.
import gc
import json
import os
import shutil
import subprocess
import sys
import time
import traceback
from pathlib import Path

T0 = time.time()
# Reduces fragmentation out-of-memory errors on the 16 GB T4 (must be set before torch loads).
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
# Kaggle's ~/.cache/huggingface is read-only on newer images (run 1 failed there); download to /tmp.
os.environ["HF_HOME"] = "/tmp/hf"
subprocess.run(
    [
        sys.executable,
        "-m",
        "pip",
        "install",
        "-q",
        "diffusers==0.42.1",
        "accelerate",
        "ftfy",
        "imageio",
        "imageio-ffmpeg",
        "sentencepiece",
        "protobuf",
    ],
    check=True,
)

import numpy as np
import torch
from diffusers import DiffusionPipeline
from diffusers.utils import export_to_video

OUT = Path("/kaggle/working")
PROMPT = (
    "Slow push-in on a barista pouring latte art in a cosy Hyderabad café, morning light, handheld feel, "
    "shallow depth of field, photorealistic live-action footage, natural motion and lighting, "
    "real camera movement, true-to-life detail"
)
NEGATIVE = (
    "blurry, low quality, distorted hands, extra fingers, deformed, static, overexposed, text, watermark, "
    "cartoon, painting, still picture"
)
LIMIT_S = 60 * 60
# Always float16: a T4 only emulates bfloat16, and in bfloat16 PyTorch falls back to full attention,
# which asked for 13-48 GB in run 1. float16 enables memory-efficient attention on the T4.
FP = torch.float16

# key, repo, height, width, frames, fps, steps, guidance, offload ("model" or "sequential"), licence
MODELS = [
    # Wan 2.2 5B ran out of memory at 1280x704 on a T4 (first test, 12 Nov 2026), so 832x480 here.
    (
        "wan22-5b-480p",
        "Wan-AI/Wan2.2-TI2V-5B-Diffusers",
        832,
        480,
        121,
        24,
        50,
        5.0,
        "model",
        "Apache-2.0",
    ),
    (
        "wan21-1.3b",
        "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
        832,
        480,
        81,
        16,
        50,
        5.0,
        "model",
        "Apache-2.0",
    ),
    (
        "ltx-video-2b",
        "Lightricks/LTX-Video",
        704,
        480,
        121,
        24,
        50,
        3.0,
        "model",
        "LTX (custom)",
    ),
    (
        "cogvideox-5b",
        "zai-org/CogVideoX-5b",
        480,
        720,
        49,
        8,
        50,
        6.0,
        "sequential",
        "CogVideoX (custom)",
    ),
    (
        "hunyuanvideo-1.5",
        "hunyuanvideo-community/HunyuanVideo-1.5-Diffusers-480p_t2v_distilled",
        832,
        480,
        121,
        24,
        50,
        6.0,
        "sequential",
        "Tencent (custom)",
    ),
    (
        "mochi-1",
        "genmo/mochi-1-preview",
        480,
        848,
        85,
        30,
        50,
        4.5,
        "sequential",
        "Apache-2.0",
    ),
]

report = {
    "prompt": PROMPT,
    "gpus": [torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())],
    "dtype": str(FP),
    "torch": torch.__version__,
    "diffusers": "0.42.1",
    "results": [],
}


def save_report():
    with open(OUT / "report.json", "w") as f:
        json.dump(report, f, indent=2)


class TooSlow(Exception):
    pass


for key, repo, h, w, frames, fps, steps, cfg, offload, licence in MODELS:
    r = {
        "key": key,
        "repo": repo,
        "licence": licence,
        "size": f"{w}x{h}",
        "frames": frames,
        "fps": fps,
        "seconds": round(frames / fps, 1),
        "steps": steps,
    }
    pipe = None
    try:
        t = time.time()
        kwargs = {"torch_dtype": FP}
        if key.startswith("wan"):
            from diffusers import AutoencoderKLWan

            kwargs["vae"] = AutoencoderKLWan.from_pretrained(
                repo, subfolder="vae", torch_dtype=torch.float32
            )
        pipe = DiffusionPipeline.from_pretrained(repo, **kwargs)
        if offload == "sequential":
            pipe.enable_sequential_cpu_offload()
        else:
            pipe.enable_model_cpu_offload()
        for name in ("enable_tiling", "enable_slicing"):
            if hasattr(pipe, "vae") and hasattr(pipe.vae, name):
                getattr(pipe.vae, name)()
        r["pipeline"] = type(pipe).__name__
        r["load_s"] = round(time.time() - t)

        start = time.time()

        def guard(_pipe, _step, _timestep, callback_kwargs, start=start, steps=steps):
            if time.time() - start > LIMIT_S:
                raise TooSlow(
                    f"stopped after {LIMIT_S // 60} min at step {_step}/{steps}"
                )
            return callback_kwargs

        torch.cuda.reset_peak_memory_stats()
        out = pipe(
            prompt=PROMPT,
            negative_prompt=NEGATIVE,
            height=h,
            width=w,
            num_frames=frames,
            num_inference_steps=steps,
            guidance_scale=cfg,
            callback_on_step_end=guard,
            generator=torch.Generator("cpu").manual_seed(42),
        )
        video = out.frames[0]
        r["generate_s"] = round(time.time() - start)
        r["peak_gpu_gb"] = round(torch.cuda.max_memory_allocated() / 1e9, 1)
        arr = np.asarray(video, dtype=np.float32)
        r["broken_frames"] = bool(np.isnan(arr).any() or np.nanstd(arr) < 0.02)
        export_to_video(video, str(OUT / f"{key}.mp4"), fps=fps)
        r["status"] = "ok"
    except TooSlow as e:
        r["status"] = "too_slow"
        r["error"] = str(e)
    except Exception as e:  # noqa: BLE001 - record any model's failure and move on to the next model
        r["status"] = "failed"
        r["error"] = f"{type(e).__name__}: {e}"[:500]
        r["trace"] = traceback.format_exc()[-1500:]
    finally:
        del pipe
        gc.collect()
        torch.cuda.empty_cache()
        # Free disk before the next model: each download is 10-40 GB.
        cache = (
            Path(os.environ["HF_HOME"]) / "hub" / ("models--" + repo.replace("/", "--"))
        )
        shutil.rmtree(cache, ignore_errors=True)
    r["elapsed_total_s"] = round(time.time() - T0)
    report["results"].append(r)
    save_report()
    print(json.dumps({k: v for k, v in r.items() if k != "trace"}), flush=True)

print("done")
