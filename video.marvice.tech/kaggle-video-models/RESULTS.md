# Kaggle run 4 results (12 Nov 2026, free T4 16 GB, float16)

Same prompt for every model (barista pouring latte art, Hyderabad café). Clips are 9:16 portrait.

| Model | Licence | Clip | Generate time | Peak GPU | Result |
| --- | --- | --- | --- | --- | --- |
| Wan 2.2 TI2V 5B | Apache-2.0 | 480×832, 5 s, 24 fps | 33 min (+5 min load) | 12.5 GB | OK. Realistic café, latte art, kettle pour, steady push-in. Best of the run. |
| LTX-Video 2B | LTX (custom) | 480×704, 5 s, 24 fps | 3.5 min | 4.6 GB | OK technically, but the scene morphs (cup, window, person appear from nowhere). Not usable for ads. |
| Wan 2.1 T2V 1.3B | Apache-2.0 | 480×832, 5 s, 16 fps | stopped at 60 min (step 49/50) | n/a | Too slow on a T4 in this setup. |

CogVideoX 5B, HunyuanVideo 1.5 and Mochi 1 need their own session (`RUN_HEAVY=1`): the disk turns read-only after
about 70 GB of downloads per session.
