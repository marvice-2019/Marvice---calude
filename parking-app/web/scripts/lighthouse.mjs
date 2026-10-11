// Lighthouse (mobile profile, simulated slow 4G) on the given URLs. Prints category scores and
// exits non-zero if performance or accessibility is under 90 (the stage 5 gate).
// Usage: CHROME_PATH=/path/to/chrome node scripts/lighthouse.mjs <url> [url...]
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";
import { mkdirSync, writeFileSync } from "node:fs";

const urls = process.argv.slice(2);
if (!urls.length) { console.error("Pass at least one URL."); process.exit(2); }
mkdirSync("lighthouse", { recursive: true });

const chrome = await launch({ chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"] });
let failed = false;
try {
  for (const url of urls) {
    const r = await lighthouse(url, { port: chrome.port, output: "html", logLevel: "error",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"] });
    const c = r.lhr.categories, s = k => Math.round((c[k]?.score ?? 0) * 100);
    const scores = { performance: s("performance"), accessibility: s("accessibility"), "best-practices": s("best-practices"), seo: s("seo") };
    const a = r.lhr.audits;
    console.log(url, JSON.stringify(scores), `LCP ${a["largest-contentful-paint"].displayValue}, CLS ${a["cumulative-layout-shift"].displayValue}, TBT ${a["total-blocking-time"].displayValue}`);
    for (const [id, au] of Object.entries(a)) if (au.score !== null && au.score < 0.9 && au.scoreDisplayMode === "binary") console.log("   needs work:", id, "-", au.title);
    writeFileSync(`lighthouse/${new URL(url).pathname.replace(/\W+/g, "_") || "home"}.html`, r.report);
    if (scores.performance < 90 || scores.accessibility < 90) failed = true;
  }
} finally { await chrome.kill(); }
process.exit(failed ? 1 : 0);
