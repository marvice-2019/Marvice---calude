// Marvice: put the logo where the HyperFrames wordmark was and hide HeyGen's Framey promo.
(() => {
  const apply = () => {
    const wordmark = document.querySelector('svg[aria-label="Hyperframes"]');
    if (wordmark && !wordmark.previousElementSibling?.classList.contains("marvice-brand")) {
      const brand = document.createElement("a");
      brand.className = "marvice-brand";
      brand.href = "/";
      brand.title = "Marvice Studio";
      brand.innerHTML = '<i role="img" aria-label="Marvice"></i><span>Editor Studio</span>';
      wordmark.before(brand);
    }
    for (const b of document.querySelectorAll("button")) {
      if (b.style.display !== "none" && /Framey/.test(b.textContent)) b.style.display = "none";
    }
    if (document.title !== "Marvice Editor Studio") document.title = "Marvice Editor Studio";
  };
  new MutationObserver(apply).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", apply);
})();
