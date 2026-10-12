// Obsidian-style wikilink parsing and rename rewriting.
// Handles [[Page]], [[Page|alias]], [[Page#Heading]], [[Page#^block]], ![[Page]],
// and path-qualified links like [[Folder/Page]]. Links inside code are left alone.

const LINK_RE = /(!?)\[\[([^\[\]|#^\n]+?)((?:#[^\[\]|\n]*)?)((?:\|[^\[\]\n]*)?)\]\]/g;

export const stripMd = (p) => p.replace(/\.md$/i, "");
export const basename = (p) => stripMd(p).split("/").pop();
const norm = (s) => s.trim().replace(/\\/g, "/").toLowerCase();

// Split text into segments, marking fenced code blocks and inline code as protected.
function segments(text) {
  const out = [];
  const re = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?(\n\2[^\n]*(?=\n|$)|$)|`[^`\n]+`/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    out.push({ code: false, s: text.slice(last, m.index) });
    out.push({ code: true, s: m[0] });
    last = m.index + m[0].length;
  }
  out.push({ code: false, s: text.slice(last) });
  return out;
}

export function extractLinks(text) {
  const links = [];
  for (const seg of segments(text)) {
    if (seg.code) continue;
    for (const m of seg.s.matchAll(LINK_RE)) links.push(m[2].trim());
  }
  return links;
}

/**
 * Rewrite links that point at oldPath ("Folder/Old Name.md") so they point at newPath.
 * Bare links ([[Old Name]]) stay bare when the new basename is unambiguous;
 * path-qualified links get the new path.
 * `allPaths` is used to decide whether a bare link to oldPath's basename is ambiguous.
 */
export function rewriteLinks(text, oldPath, newPath, allPaths = []) {
  const oldFull = norm(stripMd(oldPath));
  const oldBase = norm(basename(oldPath));
  const newFull = stripMd(newPath);
  const newBase = basename(newPath);
  const baseClash = allPaths.some(
    (p) => norm(stripMd(p)) !== oldFull && norm(basename(p)) === norm(newBase),
  );
  const oldBaseShared = allPaths.some(
    (p) => norm(stripMd(p)) !== oldFull && norm(basename(p)) === oldBase,
  );
  let count = 0;
  const result = segments(text)
    .map((seg) =>
      seg.code
        ? seg.s
        : seg.s.replace(LINK_RE, (all, bang, target, heading, alias) => {
            const t = norm(stripMd(target));
            const isFull = t === oldFull && t.includes("/");
            const isBare = !t.includes("/") && t === oldBase && !oldBaseShared;
            if (!isFull && !isBare && t !== oldFull) return all;
            count++;
            const dest = isBare && !baseClash ? newBase : newFull;
            return `${bang}[[${dest}${heading}${alias}]]`;
          }),
    )
    .join("");
  return { text: result, count };
}

/** Approximation of Quartz's slugify, used to map a URL back to a source file. */
export function quartzSlug(path) {
  return stripMd(path)
    .split("/")
    .map((s) =>
      s.replace(/\s/g, "-").replace(/&/g, "-and-").replace(/%/g, "-percent").replace(/[?#]/g, ""),
    )
    .join("/")
    .replace(/\/index$/, "");
}

const bad = (m) => Object.assign(new Error(m), { status: 400 });

/** Validate a user-supplied page path. Returns normalized "dir/Name.md" or throws. */
export function cleanPath(p) {
  if (typeof p !== "string") throw bad("path required");
  let s = p.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!s.toLowerCase().endsWith(".md")) s += ".md";
  if (s.split("/").some((part) => part === ".." || part === "." || part === ""))
    throw bad("invalid path");
  if (/[\[\]|#^:*?"<>]/.test(s)) throw bad("path contains characters not allowed in wiki titles");
  return s;
}
