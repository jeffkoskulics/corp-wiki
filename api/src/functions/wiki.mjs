import { app } from "@azure/functions";
import { readPage, writePage, listPages, readBlob, commitChanges, mapLimit, HttpError } from "../lib/github.mjs";
import { requireEditor } from "../lib/auth.mjs";
import { cleanPath, rewriteLinks, quartzSlug, extractLinks, basename, stripMd } from "../lib/wikilinks.mjs";

const json = (status, body) => ({ status, jsonBody: body });

function handler(fn) {
  return async (request, context) => {
    try {
      return await fn(request, context);
    } catch (e) {
      if (e.status >= 400 && e.status < 500) return json(e.status, { error: e.message });
      context.error(e);
      return json(500, { error: "Internal error" });
    }
  };
}

// GET /api/pages            -> [{ path, title, slug }]   (for autocomplete, resolving URLs)
app.http("pages", {
  methods: ["GET"],
  route: "pages",
  handler: handler(async () => {
    const { pages } = await listPages();
    return json(200, pages.map((p) => ({ path: p.path, title: basename(p.path), slug: quartzSlug(p.path) })));
  }),
});

// GET /api/page?path=X.md   -> { path, content, sha } (404 => { exists: false })
// PUT /api/page {path, content, sha?, summary}
app.http("page", {
  methods: ["GET", "PUT"],
  route: "page",
  handler: handler(async (request) => {
    if (request.method === "GET") {
      const path = cleanPath(request.query.get("path"));
      const page = await readPage(path);
      return page ? json(200, { path, ...page }) : json(404, { path, exists: false });
    }
    const author = requireEditor(request);
    const body = await request.json();
    const path = cleanPath(body.path);
    if (typeof body.content !== "string") throw new HttpError(400, "content required");
    if (body.content.length > 1_000_000) throw new HttpError(413, "Page too large");
    const summary = (body.summary || "").toString().slice(0, 200).trim();
    const verb = body.sha ? "Edit" : "Create";
    const res = await writePage(path, body.content, body.sha, `${verb} ${stripMd(path)}${summary ? `: ${summary}` : ""}`, author);
    return json(200, { path, sha: res.content.sha, commit: res.commit.sha });
  }),
});

// POST /api/rename {from, to, summary} -> moves the page and rewrites every backlink in one commit.
app.http("rename", {
  methods: ["POST"],
  route: "rename",
  handler: handler(async (request) => {
    const author = requireEditor(request);
    const body = await request.json();
    const from = cleanPath(body.from);
    const to = cleanPath(body.to);
    if (from === to) throw new HttpError(400, "New name is the same as the old one");

    const { pages, headSha, treeSha } = await listPages();
    const source = pages.find((p) => p.path === from);
    if (!source) throw new HttpError(404, `Page not found: ${from}`);
    if (pages.some((p) => p.path.toLowerCase() === to.toLowerCase() && p.path !== from))
      throw new HttpError(409, `A page named ${to} already exists`);

    const allPaths = pages.map((p) => p.path);
    const changes = [];
    const touched = [];
    await mapLimit(pages, 8, async (p) => {
      const text = await readBlob(p.sha);
      const { text: updated, count } = rewriteLinks(text, from, to, allPaths);
      if (p.path === from) {
        changes.push({ path: to, content: updated });
        if (!body.redirect) changes.push({ path: from, delete: true });
        else changes.push({ path: from, content: `> [!info] This page has moved\n> See [[${stripMd(to)}]].\n` });
      } else if (count > 0) {
        changes.push({ path: p.path, content: updated });
        touched.push({ path: p.path, links: count });
      }
    });

    const summary = (body.summary || "").toString().slice(0, 200).trim();
    const message =
      `Rename ${stripMd(from)} -> ${stripMd(to)}${summary ? `: ${summary}` : ""}\n\n` +
      (touched.length ? `Updated backlinks in:\n${touched.map((t) => `- ${t.path} (${t.links})`).join("\n")}` : "No backlinks to update.");
    const commit = await commitChanges(headSha, treeSha, changes, message, author);
    return json(200, { from, to, commit: commit.sha, updated: touched });
  }),
});

// GET /api/backlinks?path=X.md -> pages linking to X (shown in the rename dialog).
app.http("backlinks", {
  methods: ["GET"],
  route: "backlinks",
  handler: handler(async (request) => {
    const path = cleanPath(request.query.get("path"));
    const { pages } = await listPages();
    const target = { full: stripMd(path).toLowerCase(), base: basename(path).toLowerCase() };
    const hits = [];
    await mapLimit(pages, 8, async (p) => {
      if (p.path === path) return;
      const links = extractLinks(await readBlob(p.sha)).map((l) => stripMd(l).toLowerCase());
      if (links.some((l) => l === target.full || l === target.base)) hits.push(p.path);
    });
    return json(200, hits.sort());
  }),
});
