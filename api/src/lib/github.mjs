// Minimal GitHub REST client for a wiki stored as Markdown in a repo.
// Config (Azure app settings): GITHUB_TOKEN, GITHUB_REPO ("owner/name"),
// GITHUB_BRANCH (default "main"), CONTENT_DIR (default "content").

const API = "https://api.github.com";

export const config = () => ({
  token: process.env.GITHUB_TOKEN,
  repo: process.env.GITHUB_REPO,
  branch: process.env.GITHUB_BRANCH || "main",
  dir: (process.env.CONTENT_DIR || "content").replace(/\/+$/, ""),
});

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function gh(method, path, body) {
  const { token } = config();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new HttpError(res.status, `GitHub ${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

const enc = (p) => p.split("/").map(encodeURIComponent).join("/");
const b64decode = (s) => Buffer.from(s, "base64").toString("utf8");

/** Read a page. Returns { content, sha } or null if it doesn't exist. */
export async function readPage(path) {
  const { repo, branch, dir } = config();
  try {
    const f = await gh("GET", `/repos/${repo}/contents/${enc(`${dir}/${path}`)}?ref=${branch}`);
    return { content: b64decode(f.content), sha: f.sha };
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

/** Create or update a page. `sha` must match the current blob (optimistic concurrency). */
export async function writePage(path, content, sha, message, author) {
  const { repo, branch, dir } = config();
  try {
    return await gh("PUT", `/repos/${repo}/contents/${enc(`${dir}/${path}`)}`, {
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
      ...(sha ? { sha } : {}),
      ...(author ? { author, committer: author } : {}),
    });
  } catch (e) {
    // 409 = sha mismatch; 422 = sha missing for an existing file. Both mean "someone else saved first".
    if (e.status === 409 || e.status === 422) throw new HttpError(409, "Page was changed by someone else. Reload and merge your edits.");
    throw e;
  }
}

/** List all Markdown pages (paths relative to CONTENT_DIR) with their blob shas. */
export async function listPages() {
  const { repo, branch, dir } = config();
  const ref = await gh("GET", `/repos/${repo}/git/ref/heads/${branch}`);
  const commit = await gh("GET", `/repos/${repo}/git/commits/${ref.object.sha}`);
  const tree = await gh("GET", `/repos/${repo}/git/trees/${commit.tree.sha}?recursive=1`);
  const prefix = `${dir}/`;
  const pages = tree.tree
    .filter((t) => t.type === "blob" && t.path.startsWith(prefix) && /\.md$/i.test(t.path))
    .map((t) => ({ path: t.path.slice(prefix.length), sha: t.sha }));
  return { pages, headSha: ref.object.sha, treeSha: commit.tree.sha };
}

export async function readBlob(sha) {
  const { repo } = config();
  const b = await gh("GET", `/repos/${repo}/git/blobs/${sha}`);
  return b64decode(b.content);
}

/**
 * Commit several file changes atomically on top of `parentSha`.
 * changes: [{ path, content }] to write, [{ path, delete: true }] to remove (paths relative to CONTENT_DIR).
 * Fails with 409 if the branch moved since parentSha.
 */
export async function commitChanges(parentSha, baseTreeSha, changes, message, author) {
  const { repo, branch, dir } = config();
  const tree = await gh("POST", `/repos/${repo}/git/trees`, {
    base_tree: baseTreeSha,
    tree: changes.map((c) =>
      c.delete
        ? { path: `${dir}/${c.path}`, mode: "100644", type: "blob", sha: null }
        : { path: `${dir}/${c.path}`, mode: "100644", type: "blob", content: c.content },
    ),
  });
  const commit = await gh("POST", `/repos/${repo}/git/commits`, {
    message,
    tree: tree.sha,
    parents: [parentSha],
    ...(author ? { author, committer: author } : {}),
  });
  try {
    await gh("PATCH", `/repos/${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
  } catch (e) {
    if (e.status === 422) throw new HttpError(409, "The wiki changed during the rename. Please try again.");
    throw e;
  }
  return commit;
}

/** Run async fn over items with limited concurrency. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}
