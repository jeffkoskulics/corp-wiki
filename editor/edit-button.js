// Injected into every published page. Adds an "Edit" button that resolves the URL back to its Markdown file.
(() => {
  if (document.getElementById("wiki-edit")) return;
  const a = document.createElement("a");
  a.id = "wiki-edit";
  a.href = "#";
  a.textContent = "Edit";
  a.style.cssText = "position:fixed;right:1rem;bottom:1rem;z-index:50;padding:.5rem 1rem;border-radius:6px;background:#0066cc;color:#fff;font:600 14px system-ui;text-decoration:none;box-shadow:0 2px 8px #0003";
  a.onclick = async (e) => {
    e.preventDefault();
    const slug = decodeURIComponent(location.pathname.replace(/^\/+|\/+$/g, "").replace(/\.html$/, "")) || "index";
    try {
      const pages = await (await fetch("/api/pages")).json();
      const page = pages.find((p) => p.slug.toLowerCase() === slug.toLowerCase());
      location.href = "/edit/?path=" + encodeURIComponent(page ? page.path : slug.replace(/-/g, " ") + ".md");
    } catch {
      location.href = "/edit/?path=" + encodeURIComponent(slug + ".md");
    }
  };
  document.body.appendChild(a);
  // Quartz uses client-side navigation; keep the button across page swaps.
  document.addEventListener("nav", () => document.body.contains(a) || document.body.appendChild(a));
})();
