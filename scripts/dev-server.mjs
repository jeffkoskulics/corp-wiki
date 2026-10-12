// Local preview: serves public/ and a file-backed version of the wiki API (no Azure, no GitHub).
// Edits are written straight to content/. Run `npm run build` again to refresh the rendered pages.
//   node scripts/dev-server.mjs [port]
import { createServer } from "node:http";
import { readFile, writeFile, readdir, mkdir, rm, stat } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { createHash } from "node:crypto";
import { cleanPath, rewriteLinks, quartzSlug, extractLinks, basename, stripMd } from "../api/src/lib/wikilinks.mjs";

const PORT = Number(process.argv[2] || 4280);
const CONTENT = "content";
const PUBLIC = "public";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".ico": "image/x-icon", ".xml": "application/xml" };
const sha = (s) => createHash("sha1").update(s).digest("hex");

async function listPages(dir = CONTENT, prefix = "") {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix + e.name;
    if (e.isDirectory()) out.push(...(await listPages(join(dir, e.name), rel + "/")));
    else if (/\.md$/i.test(e.name)) out.push(rel);
  }
  return out;
}
const read = (p) => readFile(join(CONTENT, p), "utf8");
async function write(p, text) { await mkdir(dirname(join(CONTENT, p)), { recursive: true }); await writeFile(join(CONTENT, p), text); }

const routes = {
  "GET /api/pages": async () => (await listPages()).map((p) => ({ path: p, title: basename(p), slug: quartzSlug(p) })),
  "GET /api/page": async (q) => {
    const path = cleanPath(q.get("path"));
    try { const content = await read(path); return { path, content, sha: sha(content) }; }
    catch { return [404, { path, exists: false }]; }
  },
  "PUT /api/page": async (_, body) => {
    const path = cleanPath(body.path);
    let current = null;
    try { current = await read(path); } catch {}
    if ((current === null) !== !body.sha || (current !== null && sha(current) !== body.sha))
      return [409, { error: "Page was changed by someone else. Reload and merge your edits." }];
    await write(path, body.content);
    console.log(`edit ${path}: ${body.summary || ""}`);
    return { path, sha: sha(body.content) };
  },
  "GET /api/backlinks": async (q) => {
    const path = cleanPath(q.get("path"));
    const t = [stripMd(path).toLowerCase(), basename(path).toLowerCase()];
    const hits = [];
    for (const p of await listPages()) if (p !== path && extractLinks(await read(p)).some((l) => t.includes(stripMd(l).toLowerCase()))) hits.push(p);
    return hits;
  },
  "POST /api/rename": async (_, body) => {
    const from = cleanPath(body.from), to = cleanPath(body.to);
    const all = await listPages();
    if (!all.includes(from)) return [404, { error: `Page not found: ${from}` }];
    if (all.some((p) => p.toLowerCase() === to.toLowerCase() && p !== from)) return [409, { error: `A page named ${to} already exists` }];
    const updated = [];
    for (const p of all) {
      const { text, count } = rewriteLinks(await read(p), from, to, all);
      if (p === from) {
        await write(to, text);
        if (body.redirect) await write(from, `> [!info] This page has moved\n> See [[${stripMd(to)}]].\n`);
        else await rm(join(CONTENT, from));
      } else if (count) { await write(p, text); updated.push({ path: p, links: count }); }
    }
    console.log(`rename ${from} -> ${to}, updated ${updated.length} pages`);
    return { from, to, updated };
  },
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const route = routes[`${req.method} ${url.pathname}`];
  try {
    if (route) {
      let body = {};
      if (req.method !== "GET") { let raw = ""; for await (const c of req) raw += c; body = JSON.parse(raw || "{}"); }
      let out = await route(url.searchParams, body);
      const [status, json] = Array.isArray(out) && typeof out[0] === "number" ? out : [200, out];
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(json));
      return;
    }
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith("/")) p += "index.html";
    let file = join(PUBLIC, p);
    const exists = async (f) => (await stat(f).catch(() => null))?.isFile();
    if (!(await exists(file)) && (await exists(file + ".html"))) file += ".html";
    if (!(await exists(file))) { res.writeHead(404, { "Content-Type": "text/html" }).end(await readFile(join(PUBLIC, "missing.html"))); return; }
    res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" }).end(await readFile(file));
  } catch (e) {
    res.writeHead(e.status || 500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: e.message }));
  }
}).listen(PORT, () => console.log(`Wiki preview on http://localhost:${PORT}`));
