import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.argv[2] || "public";
const tag = '<script src="/edit-button.js" defer></script>';
let n = 0;
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "edit") await walk(p); continue; }
    if (!e.name.endsWith(".html") || e.name === "missing.html") continue;
    const html = await readFile(p, "utf8");
    if (html.includes(tag) || !html.includes("</body>")) continue;
    await writeFile(p, html.replace("</body>", `${tag}</body>`));
    n++;
  }
}
await walk(root);
console.log(`Injected Edit button into ${n} pages`);
