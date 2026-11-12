# Marvice Motion: open-source video test on Kaggle's free GPU.
# Wan 2.2 TI2V-5B (Apache-2.0) text-to-video, 5 s at 24 fps, 704x1280 (9:16 reel).
# Writes /kaggle/working/cafe-reel.mp4 and /kaggle/working/report.json (timings, GPU, frame check).
import json
import subprocess
import sys
import time

T0 = time.time()
report = {
    "model": "Wan-AI/Wan2.2-TI2V-5B-Diffusers",
    "steps": 50,
    "size": "704x1280",
    "frames": 121,
    "fps": 24,
}
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
    ],
    check=True,
)
report["install_s"] = round(time.time() - T0)

import numpy as np
import torch
from diffusers import AutoencoderKLWan, WanPipeline
from diffusers.utils import export_to_video

report["gpus"] = [
    torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())
]
report["torch"] = torch.__version__
# T4 has no native bfloat16, so the transformer runs in float16; the VAE stays in float32.
dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
report["dtype"] = str(dtype)

t = time.time()
model_id = report["model"]
vae = AutoencoderKLWan.from_pretrained(
    model_id, subfolder="vae", torch_dtype=torch.float32
)
pipe = WanPipeline.from_pretrained(model_id, vae=vae, torch_dtype=dtype)
pipe.enable_model_cpu_offload()  # fits a 16 GB T4 by keeping idle parts in RAM
if hasattr(pipe.vae, "enable_tiling"):
    pipe.vae.enable_tiling()
report["load_s"] = round(time.time() - t)

prompt = (
    "Slow push-in on a barista pouring latte art in a cosy Hyderabad café, morning light, handheld feel, "
    "shallow depth of field, photorealistic live-action footage, natural motion and lighting, "
    "real camera movement, true-to-life detail"
)
negative = (
    "blurry, low quality, distorted hands, extra fingers, deformed, static, overexposed, text, watermark, "
    "cartoon, painting, still picture"
)
report["prompt"] = prompt

t = time.time()
torch.cuda.reset_peak_memory_stats()
frames = pipe(
    prompt=prompt,
    negative_prompt=negative,
    height=1280,
    width=704,
    num_frames=121,
    guidance_scale=5.0,
    num_inference_steps=50,
    generator=torch.Generator("cpu").manual_seed(42),
).frames[0]
report["generate_s"] = round(time.time() - t)
report["peak_gpu_gb"] = round(torch.cuda.max_memory_allocated() / 1e9, 1)

arr = np.asarray(frames, dtype=np.float32)
report["frame_check"] = {
    "nan": bool(np.isnan(arr).any()),
    "mean": round(float(np.nanmean(arr)), 3),
    "std": round(float(np.nanstd(arr)), 3),
    "count": int(arr.shape[0]),
}
report["blank_or_broken"] = bool(np.isnan(arr).any() or np.nanstd(arr) < 0.02)

export_to_video(frames, "/kaggle/working/cafe-reel.mp4", fps=24)
report["total_s"] = round(time.time() - T0)
with open("/kaggle/working/report.json", "w") as f:
    json.dump(report, f, indent=2)
print(json.dumps(report, indent=2))
