/**
 * WebGL1 light show (brief §4). Loaded with import() after first paint.
 * - One fullscreen triangle, the brief's fragment shader, no libraries.
 * - Draws only while on screen (IntersectionObserver) and the tab is visible.
 * - Reduced motion: one static frame, redrawn only on resize or mode change.
 * - Adaptive quality: createQualityController drops resolution on slow devices.
 * - Interactive canvases aim the beams at the pointer (uAim eases in, and back
 *   out after 2.6 s idle); touch-action: pan-y keeps page scroll working.
 */
import { beatLevel } from "@/lib/beat";
import { baseScale, canvasSize, createQualityController } from "./quality";
import { FRAGMENT_SHADER, hexToRgb, VERTEX_SHADER } from "./shader";

export type LightRenderer = {
  setPalette(colours: readonly [string, string, string] | readonly string[]): void;
  /** Fire a shockwave (Drop, or a tap on the hero). */
  drop(strength?: number): void;
  destroy(): void;
};

type Options = { interactive: boolean; beams?: number; onLost?: () => void; onFrame?: () => void };

const AIM_IDLE_MS = 2600;
const DROP_DECAY = 1 / 1.4; // per second: a drop fades out in ~1.4 s

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type);
  if (!s) throw new Error("createShader failed");
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader compile failed");
  return s;
}

/** Returns null when WebGL is unavailable; the caller keeps the CSS beams. */
export function createLightRenderer(canvas: HTMLCanvasElement, opts: Options): LightRenderer | null {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, powerPreference: "low-power", preserveDrawingBuffer: false });
  if (!gl) return null;

  let program: WebGLProgram;
  try {
    program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link failed");
  } catch (err) {
    console.warn("light show disabled:", err);
    return null;
  }
  gl.useProgram(program);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const u = (name: string) => gl.getUniformLocation(program, name);
  const U = { res: u("uRes"), m: u("uM"), t: u("uT"), beat: u("uBeat"), drop: u("uDrop"), aim: u("uAim"), n: u("uN"), a: u("uA"), b: u("uB"), c: u("uC") };

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const touch = window.matchMedia("(pointer: coarse)").matches;
  const quality = createQualityController(baseScale(touch));
  const beams = opts.beams ?? (touch ? 5 : 7);
  let palette: [number, number, number][] = [hexToRgb("#2BB8DC"), hexToRgb("#4A93E8"), hexToRgb("#E3B26A")];
  let dropLevel = 0;
  let aim = 0;
  let aimTarget = 0;
  let lastPointer = 0;
  const mouse = { x: 0.5, y: 0.6 };
  let onScreen = false;
  let raf = 0;
  let lastFrame = 0;
  const t0 = performance.now();
  let destroyed = false;

  function resize() {
    const r = canvas.getBoundingClientRect();
    const { width, height } = canvasSize(r.width, r.height, window.devicePixelRatio, quality.scale);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl!.viewport(0, 0, width, height);
      return true;
    }
    return false;
  }

  function draw(now: number) {
    const asp = canvas.width / Math.max(1, canvas.height);
    gl!.uniform2f(U.res, canvas.width, canvas.height);
    gl!.uniform2f(U.m, mouse.x * asp, mouse.y);
    gl!.uniform1f(U.t, reduce ? 12.0 : (now - t0) / 1000);
    gl!.uniform1f(U.beat, reduce ? 0 : beatLevel(now));
    gl!.uniform1f(U.drop, dropLevel);
    gl!.uniform1f(U.aim, aim);
    gl!.uniform1f(U.n, beams);
    gl!.uniform3fv(U.a, palette[0]!);
    gl!.uniform3fv(U.b, palette[1]!);
    gl!.uniform3fv(U.c, palette[2]!);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    opts.onFrame?.();
  }

  function frame(now: number) {
    raf = 0;
    if (destroyed || !onScreen || document.hidden) return;
    const dt = lastFrame ? now - lastFrame : 16;
    lastFrame = now;
    if (quality.frame(dt)) resize();
    if (quality.giveUp) {
      // Device can't keep up even at the lowest resolution: hand over to the CSS beams.
      destroyed = true;
      opts.onLost?.();
      return;
    }
    dropLevel = Math.max(0, dropLevel - (dt / 1000) * DROP_DECAY);
    if (opts.interactive && now - lastPointer > AIM_IDLE_MS) aimTarget = 0;
    aim += (aimTarget - aim) * Math.min(1, dt / 250);
    draw(now);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (reduce) {
      resize();
      draw(performance.now());
      return;
    }
    if (!raf && onScreen && !document.hidden) {
      lastFrame = 0;
      raf = requestAnimationFrame(frame);
    }
  }

  const io = new IntersectionObserver(([e]) => {
    onScreen = !!e?.isIntersecting;
    if (onScreen) start();
  });
  io.observe(canvas);
  const onVisibility = () => !document.hidden && start();
  document.addEventListener("visibilitychange", onVisibility);
  const ro = new ResizeObserver(() => {
    if (resize() && reduce) draw(performance.now());
  });
  ro.observe(canvas);

  function onPointer(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) / r.width;
    mouse.y = 1 - (e.clientY - r.top) / r.height;
    lastPointer = performance.now();
    aimTarget = 1;
  }
  if (opts.interactive && !reduce) canvas.addEventListener("pointermove", onPointer, { passive: true });

  function onLost(e: Event) {
    e.preventDefault();
    opts.onLost?.();
  }
  canvas.addEventListener("webglcontextlost", onLost);

  resize();
  return {
    setPalette(colours) {
      palette = colours.slice(0, 3).map(hexToRgb) as [number, number, number][];
      if (reduce) draw(performance.now());
    },
    drop(strength = 1) {
      if (reduce) return;
      dropLevel = Math.min(1, Math.max(dropLevel, strength));
      start();
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointermove", onPointer);
      canvas.removeEventListener("webglcontextlost", onLost);
    },
  };
}
