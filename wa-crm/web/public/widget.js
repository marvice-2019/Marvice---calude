/* WhatsApp chat button for any website. No cookies, no tracking, no dependencies.
   <script src="https://YOUR-APP/widget.js" data-phone="919876543210" data-text="Hi!" data-label="Chat with us"
           data-greeting="Hi there 👋 How can we help?" data-position="right" data-color="#25D366" async></script> */
(function () {
  var s = document.currentScript;
  if (!s || window.__waWidget) return;
  window.__waWidget = true;
  var phone = (s.getAttribute('data-phone') || '').replace(/\D/g, '');
  if (phone.length < 8 || phone.length > 15) { console.warn('WhatsApp widget: data-phone must be the full number with country code'); return; }
  var text = s.getAttribute('data-text') || '';
  var label = s.getAttribute('data-label') || 'Chat with us';
  var greeting = s.getAttribute('data-greeting') || '';
  var left = s.getAttribute('data-position') === 'left';
  var color = /^#[0-9a-f]{3,8}$/i.test(s.getAttribute('data-color') || '') ? s.getAttribute('data-color') : '#25D366';
  var href = 'https://wa.me/' + phone + (text ? '?text=' + encodeURIComponent(text) : '');

  function el(tag, css) { var e = document.createElement(tag); e.style.cssText = css; return e; }
  var side = left ? 'left:20px;' : 'right:20px;';
  var wrap = el('div', 'position:fixed;bottom:20px;' + side + 'z-index:2147483000;font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;flex-direction:column;align-items:' + (left ? 'flex-start' : 'flex-end') + ';gap:10px');

  if (greeting) {
    var bubble = el('div', 'max-width:260px;background:#fff;color:#111;padding:10px 14px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.15);position:relative;padding-right:30px');
    bubble.textContent = greeting;
    var x = el('button', 'position:absolute;top:4px;right:6px;border:0;background:none;font-size:16px;cursor:pointer;color:#666');
    x.textContent = '×'; x.setAttribute('aria-label', 'Close');
    x.onclick = function () { bubble.remove(); };
    bubble.appendChild(x);
    wrap.appendChild(bubble);
  }

  var a = el('a', 'display:inline-flex;align-items:center;gap:8px;background:' + color + ';color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;box-shadow:0 6px 24px rgba(0,0,0,.2);font-weight:600');
  a.href = href; a.target = '_blank'; a.rel = 'noopener';
  a.setAttribute('aria-label', label + ' on WhatsApp');
  a.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2.1 1-2.4c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1.1c.2-.3.4-.2.7-.1l1.9.9c.3.1.5.2.5.3.1.2.1.7-.1 1.2z"/></svg>';
  var span = document.createElement('span'); span.textContent = label; a.appendChild(span);
  wrap.appendChild(a);

  function mount() { document.body.appendChild(wrap); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
