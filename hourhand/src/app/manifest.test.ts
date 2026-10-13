import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("web app manifest", () => {
  const m = manifest();

  it("opens the dashboard as a standalone app", () => {
    expect(m.start_url).toBe("/dashboard");
    expect(m.display).toBe("standalone");
    expect(m.theme_color).toBe("#b4410e");
  });

  it("lists 192 and 512 icons plus a maskable 512", () => {
    expect(m.icons).toEqual([
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
  });
});
