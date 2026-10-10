# /brag plan — Marvice Studio (video.marvice.tech)

Source: `video.marvice.tech/` in this repo (creator UI, README, prompts). The live site is behind basic auth, so the video is built from the real code, not screenshots.

## Rubric

1. **What is it?** Marvice Studio: type what a video should show, pick a size and a length, get an MP4.
2. **Who is it for, what does it do for them?** Marvice's own team and clients who need a short brand video now, not after a production cycle. It removes the editor, the designer, and the wait.
3. **What sets it apart?** An AI writes a real, editable HyperFrames composition (HTML, not a black-box clip), optionally films AI footage with Veo or Sora, lints it, renders it, and lets you keep editing in the Studio editor.
4. **Most impressive claim?** Prompt → finished MP4 in four sizes and four lengths, with the choice of Claude, OpenAI or Gemini as the writer.
5. **Visual hook?** The real H1: "Type it. Get a video." in Marvice ink on Marvice paper.
6. **Real UI to show?** The `/create` form (textarea, size cards, length chips, writer/footage selects, "Create video" button), the job pipeline statuses (Queued → Planning → Filming AI footage → Writing → Checking → Rendering → Ready), and the finished job card's actions (Download MP4 / Download HTML / Open in editor).
7. **Tone?** `polished` with a little play: Marvice is an agency, the brand is warm paper + ink + copper. Clean, confident, no shouting.
8. **Share caption?** "Type it. Get a video. Marvice Studio turns a sentence into a finished MP4 — any size, any length, rendered by the same engine that made this clip."
9. **Angle?** Show the product doing its job once, start to finish, in 20 seconds: a prompt gets typed, the pipeline runs, the video lands. Then the meta point: this launch video was rendered by the same engine.

## Format

- Landscape 1920×1080, 30 fps, 20.5 s.
- Palette (from `creator/public/index.html`): paper `#f6f3ee`, panel `#ffffff`, line `#e3ddd2`, ink `#2d3837`, on-ink `#fbf8f3`, muted `#5f6b68`, copper `#bd8b53`, ok `#1e6b3f`.
- Type: the UI's system stack (Inter is installed on the render box and is used as first choice; falls back to system-ui in Studio).
- Logo: `marvice-logo.svg` (ink) on paper; a light copy (`marvice-logo-light.svg`, ink glyphs recoloured to on-ink) on the ink outro.

## Music

`happy-beats-business-moves-vol-11-by-ende-dot-app.mp3` (114.84 BPM). Level is steady from 0 s (−15 to −17 dB RMS), so the hook can land on the first beat. Cue plan (strong beats from the bundled preset): 1.60 reveal line, 3.70 UI in, 5.80 typing starts, 8.96 button press, 12.65 "Ready", 17.91 outro flip. Music under the video at ≈ −9 dB, fades out over the last 1.5 s. SFX sit under the music: keypresses ≈ −20 dB, clicks ≈ −14 dB, one soft impact and one bell for the payoff ≈ −10 dB.

## Storyboard (20.5 s)

| # | Time | Scene | On screen | Motion | Sound |
|---|---|---|---|---|---|
| 1 | 0.0–3.7 | Hook | Paper. "Type it." then "Get a video." (the real H1), copper rule under it. | Words rise and settle at 0.3 s and 1.6 s; rule draws left→right. | Music in. Soft impact on 1.6. |
| 2 | 3.7–9.5 | Reveal: the form | The `/create` page: header (logo + STUDIO), H1 + sub, textarea, four size cards (Reel 9:16 selected), length chips (15s pressed), writer "Claude (Anthropic) · claude-opus-5-5", footage "Google Veo". | Page slides up into frame on 3.7; cursor appears; prompt types character by character from 5.8 s (≈ 60 chars, 40 ms each ≈ 2.5 s); the Create button presses at 8.96. | Keypress ticks (8 samples rotated, quiet). Click on press. |
| 3 | 9.5–13.6 | The pipeline | The job card: status pill steps Queued → Planning → Filming AI footage → Writing → Checking → Rendering, then flips green "Ready" on 12.65; the card's video slot fills; actions appear: Download MP4 · Download HTML · Open in editor. | Pill text swaps on beats (≈ every 0.53 s); progress bar under the card; "Ready" scales in. | A soft click per step, bell on "Ready". |
| 4 | 13.6–17.9 | Highlights | Two lines, each with the real options: "Any size." + four shape icons labelled Reel 9:16 · Landscape 16:9 · Square 1:1 · Portrait 4:5. "Any length." + chips 8s · 15s · 30s · 60s. Then "Claude, OpenAI or Gemini write it. Veo or Sora film it." | Items stagger in left→right; each line holds ≥ 1.5 s after it is fully in. | Drop sound as each row lands. |
| 5 | 17.9–20.5 | Outro | Dip to ink. Light logo + STUDIO wordmark, "video.marvice.tech/create", small line "This video was rendered by the same engine." | Logo scales from 0.92 → 1, URL rises; hold 1.8 s. | Soft impact on the flip; music fades 19.0 → 20.5. |

Readability check: every read line holds ≥ 0.3 s per word after it is fully on screen. The typed prompt is UI texture while typing and is held fully visible for 1.2 s before the button press.

## Honesty notes

- Every label, status and option in the video exists in the code (`STEPS`, `SIZES`, `DURATIONS`, provider labels).
- No numbers, testimonials or speed claims are invented. "Rendered by the same engine" is true: this composition is rendered with the `hyperframes` CLI, the renderer Marvice Studio runs.
- The job card shows a placeholder "video" area (ink block with a play glyph), not a fake generated clip.
