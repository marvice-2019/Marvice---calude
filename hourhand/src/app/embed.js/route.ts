// The script hosts paste on their own website to show their Hourhand booking page:
//   <div data-hourhand-inline="https://hourhand.cloud/priya/coaching"></div>
//   <button data-hourhand-popup="https://hourhand.cloud/priya">Book a session</button>
//   <script src="https://hourhand.cloud/embed.js" async></script>
// Only pages on this server are framed, and only messages from it (height, redirect) are acted on.
const SCRIPT = `(function () {
  var me = document.currentScript && document.currentScript.src;
  if (!me) return;
  var origin = new URL(me).origin;
  function ours(href) { try { var u = new URL(href, location.href); return u.origin === origin ? u : null; } catch (e) { return null; } }
  function frame(u) {
    var f = document.createElement("iframe");
    f.src = u.toString(); f.title = "Book a time"; f.loading = "lazy"; f.allow = "payment";
    f.style.cssText = "width:100%;border:0;min-height:640px;display:block;background:transparent";
    return f;
  }
  document.querySelectorAll("[data-hourhand-inline]").forEach(function (el) {
    var u = ours(el.getAttribute("data-hourhand-inline")); if (!u || el.querySelector("iframe")) return;
    el.appendChild(frame(u));
  });
  var overlay = null, opener = null;
  function close() { if (overlay) { overlay.remove(); overlay = null; document.documentElement.style.overflow = ""; if (opener) opener.focus(); } }
  function open(u, from) {
    close(); opener = from;
    overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true"); overlay.setAttribute("aria-label", "Book a time");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px";
    var box = document.createElement("div");
    box.style.cssText = "position:relative;width:100%;max-width:960px;height:min(90vh,820px);background:#fff;border-radius:12px;overflow:auto";
    var x = document.createElement("button");
    x.type = "button"; x.textContent = "\\u00d7"; x.setAttribute("aria-label", "Close");
    x.style.cssText = "position:absolute;top:8px;right:8px;width:44px;height:44px;border:0;border-radius:22px;background:#16181d;color:#fff;font-size:24px;cursor:pointer;z-index:1";
    x.onclick = close;
    var f = frame(u); f.style.minHeight = "100%"; f.style.height = "100%";
    box.appendChild(x); box.appendChild(f); overlay.appendChild(box);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); } });
    document.body.appendChild(overlay); document.documentElement.style.overflow = "hidden"; x.focus();
  }
  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest && e.target.closest("[data-hourhand-popup]"); if (!el) return;
    var u = ours(el.getAttribute("data-hourhand-popup")); if (!u) return;
    e.preventDefault(); open(u, el);
  });
  window.addEventListener("message", function (e) {
    if (e.origin !== origin || !e.data || typeof e.data !== "object") return;
    if (e.data.hourhand === "height" && typeof e.data.height === "number") {
      document.querySelectorAll("[data-hourhand-inline] iframe").forEach(function (f) { if (f.contentWindow === e.source) f.style.height = Math.max(400, Math.min(e.data.height, 6000)) + "px"; });
    }
    if (e.data.hourhand === "redirect" && typeof e.data.url === "string" && /^https:\\/\\//.test(e.data.url)) location.href = e.data.url;
  });
})();`;

export function GET() {
  return new Response(SCRIPT, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" } });
}
