// Prompts that turn a one-line request into a renderable HyperFrames composition.

export const SIZES = {
  reel: { label: "Reel 9:16", width: 1080, height: 1920, footageAspect: "portrait" },
  landscape: { label: "Landscape 16:9", width: 1920, height: 1080, footageAspect: "landscape" },
  square: { label: "Square 1:1", width: 1080, height: 1080, footageAspect: "landscape" },
  portrait: { label: "Portrait 4:5", width: 1080, height: 1350, footageAspect: "portrait" },
};

export const DURATIONS = [8, 15, 30, 60];

export const COMPOSITION_SYSTEM = `You are a motion designer who writes HyperFrames compositions: a single HTML file that the HyperFrames renderer turns into an MP4.

Return ONLY the complete HTML document, starting with <!doctype html>. No explanation, no markdown fences.

## The contract (the renderer depends on every rule)
- Load GSAP with exactly: <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
- <body> holds one root: <div id="root" data-composition-id="main" data-start="0" data-width="W" data-height="H" data-duration="D">. Never wrap it in <template>.
- html, body are sized exactly W x H px with overflow:hidden; #root is width:100%; height:100%; position:relative; overflow:hidden. Do not hardcode pixel sizes on #root.
- Scenes are elements with class="clip", data-start (seconds), data-duration (seconds) and data-track-index. Every clip must end at or before D. The framework shows and hides clips; never tween display, visibility or autoAlpha on a .clip element: animate its children instead.
- One timeline: const tl = gsap.timeline({ paused: true }); add every tween at absolute times; finish with window.__timelines["main"] = tl;
- Set start states inside tweens with gsap.fromTo(...). Never give an element a CSS transform that a tween also animates.
- Deterministic only: no Math.random, Date, setTimeout, setInterval, requestAnimationFrame, fetch, or user input. A repeating tween uses a finite repeat count.
- Text: no <br> in body text; size text so the longest word fits its box; keep everything inside the frame with at least 6% safe margins.
- Fonts: only system stacks (system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, Georgia, "Times New Roman", "Courier New", sans-serif, serif, monospace). No web fonts, no @font-face.
- Media: <video> and <audio> never get a crossorigin attribute. Never put a <video data-start> inside another element that also has data-start. Background footage is muted and playsinline, object-fit: cover, full-bleed.
- No external images or URLs other than the GSAP script. Draw shapes with CSS or inline SVG.

## Design
- Design for the canvas: a 9:16 reel stacks content vertically with large type (headlines 90-160px) and keeps the middle third clear of key text; 16:9 uses horizontal layouts.
- 3 to 6 scenes, each with a clear entrance and a short hold; vary motion (slides, scales, masks, staggered words, counters, progress bars).
- A deliberate palette of 2-4 colors with strong contrast; text over footage sits on a scrim or shadow so it stays readable.
- Keep the copy short and punchy; use the user's own words for names, prices and facts, and never invent statistics.`;

export function compositionRequest({ prompt, size, duration, clips }) {
  const s = SIZES[size];
  const lines = [
    `Make this video: ${prompt}`,
    "",
    `Canvas: ${s.width} x ${s.height} px (${s.label}). W=${s.width}, H=${s.height}.`,
    `Length: D=${duration} seconds.`,
  ];
  if (clips.length) {
    lines.push(
      "",
      "AI-generated footage clips are in the project (each is a muted 16:9 or 9:16 video; crop with object-fit: cover):",
      ...clips.map(
        (c) => `- assets/${c.file}: ${c.seconds} s long, shows: ${c.prompt}. Use it as a full-bleed background <video> clip with its own data-start and data-duration (at most ${c.seconds}).`,
      ),
      "Sequence the clips across the video, back to back, and lay titles and graphics over them. Where no clip plays, use designed backgrounds.",
    );
  }
  return lines.join("\n");
}

export const FOOTAGE_SYSTEM = `You plan b-roll for short videos. Given a video request, write cinematic text-to-video prompts, one per shot.
Each prompt describes one continuous 8-second shot: subject, action, setting, camera movement, lighting and style. No on-screen text, captions, logos or real people's names.
Return ONLY JSON: {"shots": ["prompt 1", "prompt 2"]}`;

export function footageRequest({ prompt, size, shots }) {
  const s = SIZES[size];
  return `Video request: ${prompt}\nFormat: ${s.label}.\nWrite exactly ${shots} shot prompt(s).`;
}

export function repairRequest(html, findings) {
  return [
    "This HyperFrames composition fails validation. Fix every error below and return the full corrected HTML document only.",
    "",
    "Errors:",
    ...findings.map((f) => `- [${f.code}] ${f.message}`),
    "",
    "Composition:",
    html,
  ].join("\n");
}

// Pull the HTML document out of a model answer, tolerating markdown fences.
export function extractHtml(text) {
  const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.search(/<!doctype html|<html/i);
  if (start === -1) throw new Error("The model did not return an HTML document.");
  return body.slice(start);
}

export function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("The model did not return JSON.");
  return JSON.parse(match[0]);
}
