import { EditorView, basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { autocompletion } from "@codemirror/autocomplete";
import { marked } from "marked";

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
let path = params.get("path") || "";
let sha = null;
let pages = [];

const api = async (url, opts = {}) => {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 404) throw Object.assign(new Error(body.error || res.statusText), { status: res.status });
  return { status: res.status, body };
};
const status = (msg, kind = "") => { const el = $("#status"); el.textContent = msg; el.className = kind; };
const viewUrl = (p) => {
  const page = pages.find((x) => x.path === p);
  const slug = page ? page.slug : p.replace(/\.md$/i, "").replace(/\s/g, "-");
  return "/" + (slug === "index" ? "" : slug.split("/").map(encodeURIComponent).join("/"));
};

// Autocomplete page titles after "[[" (Obsidian style). Inserts the bare title, or path if ambiguous.
function wikilinkCompletion(ctx) {
  const m = ctx.matchBefore(/!?\[\[[^\[\]|#\n]*/);
  if (!m) return null;
  const from = m.from + m.text.indexOf("[[") + 2;
  const counts = {};
  pages.forEach((p) => (counts[p.title.toLowerCase()] = (counts[p.title.toLowerCase()] || 0) + 1));
  return {
    from,
    options: pages.map((p) => {
      const label = counts[p.title.toLowerCase()] > 1 ? p.path.replace(/\.md$/i, "") : p.title;
      return {
        label, detail: p.path, type: "text",
        // Reuse the "]]" that bracket auto-close may already have inserted.
        apply: (view, _c, from, to) => {
          const close = view.state.sliceDoc(to, to + 2) === "]]" ? 2 : 0;
          view.dispatch({ changes: { from, to: to + close, insert: label + "]]" }, selection: { anchor: from + label.length + 2 } });
        },
      };
    }),
    validFor: /^[^\[\]|#\n]*$/,
  };
}

const view = new EditorView({
  parent: $("#editor"),
  extensions: [
    basicSetup,
    markdown({ codeLanguages: languages }),
    autocompletion({ override: [wikilinkCompletion] }),
    EditorView.lineWrapping,
    EditorView.updateListener.of((u) => { if (u.docChanged) { dirty = true; if (!$("#preview").hidden) renderPreview(); } }),
  ],
});
let dirty = false;
window.addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });

function renderPreview() {
  const src = view.state.doc.toString()
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/!?\[\[([^\[\]|#\n]+)(#[^\[\]|\n]*)?(?:\|([^\[\]\n]*))?\]\]/g, (_, t, h = "", a) => {
      const target = pages.find((p) => p.title.toLowerCase() === t.trim().toLowerCase() || p.path.replace(/\.md$/i, "").toLowerCase() === t.trim().toLowerCase());
      const cls = target ? "" : ' class="redlink"';
      return `<a${cls} href="${target ? viewUrl(target.path) : "/edit/?path=" + encodeURIComponent(t.trim())}">${a || t + h}</a>`;
    });
  $("#preview").innerHTML = marked.parse(src);
}

async function load() {
  $("#title").textContent = path.replace(/\.md$/i, "") || "New page";
  document.title = `Editing ${$("#title").textContent}`;
  try {
    const [pg, list] = await Promise.all([
      path ? api(`/api/page?path=${encodeURIComponent(path)}`) : Promise.resolve({ status: 404, body: {} }),
      api("/api/pages"),
    ]);
    pages = list.body;
    if (pg.status === 404) {
      sha = null;
      status("This page doesn't exist yet. Saving will create it.");
      $("#rename").disabled = true;
      setDoc(`# ${path.split("/").pop().replace(/\.md$/i, "")}\n\n`);
    } else {
      path = pg.body.path;
      sha = pg.body.sha;
      setDoc(pg.body.content);
      $("#view").href = viewUrl(path);
    }
    dirty = false;
  } catch (e) { status(e.message, "error"); }
}
function setDoc(text) { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }); }

$("#togglePreview").onclick = () => {
  const p = $("#preview");
  p.hidden = !p.hidden;
  if (!p.hidden) renderPreview();
};

$("#save").onclick = async () => {
  if (!path) { path = prompt("Page title (use Folder/Title for a sub-folder):") || ""; if (!path) return; }
  $("#save").disabled = true;
  status("Saving…");
  try {
    const { body } = await api("/api/page", {
      method: "PUT",
      body: JSON.stringify({ path, content: view.state.doc.toString(), sha, summary: $("#summary").value }),
    });
    sha = body.sha; path = body.path; dirty = false;
    status("Saved. The published page updates in about a minute.", "ok");
    $("#summary").value = "";
    $("#rename").disabled = false;
    $("#view").href = viewUrl(path);
  } catch (e) {
    status(e.message, "error");
    if (e.status === 409) showConflict();
  } finally { $("#save").disabled = false; }
};

// Someone else saved first: show their version next to ours so the user can merge by hand.
async function showConflict() {
  const { body } = await api(`/api/page?path=${encodeURIComponent(path)}`);
  $("#theirs").textContent = body.content;
  $("#conflict").hidden = false;
  $("#takeTheirs").onclick = () => { setDoc(body.content); sha = body.sha; $("#conflict").hidden = true; status("Loaded the latest version."); };
  $("#keepMine").onclick = () => { sha = body.sha; $("#conflict").hidden = true; status("Your text is kept. Save again to overwrite their changes.", "error"); };
}

$("#rename").onclick = async () => {
  const dlg = $("#renameDialog");
  $("#newName").value = path.replace(/\.md$/i, "");
  $("#backlinks").textContent = "Finding pages that link here…";
  dlg.showModal();
  try {
    const { body } = await api(`/api/backlinks?path=${encodeURIComponent(path)}`);
    $("#backlinks").innerHTML = body.length
      ? `Links in <b>${body.length}</b> page(s) will be updated:<ul>${body.map((p) => `<li>${p.replace(/</g, "&lt;")}</li>`).join("")}</ul>`
      : "No other pages link here.";
  } catch (e) { $("#backlinks").textContent = e.message; }
};
$("#doRename").onclick = async (ev) => {
  ev.preventDefault();
  if (dirty && !confirm("You have unsaved changes that will be lost. Rename anyway?")) return;
  status("Renaming and updating links…");
  try {
    const { body } = await api("/api/rename", {
      method: "POST",
      body: JSON.stringify({ from: path, to: $("#newName").value, redirect: $("#redirect").checked, summary: $("#summary").value }),
    });
    $("#renameDialog").close();
    dirty = false;
    location.href = `/edit/?path=${encodeURIComponent(body.to)}&renamed=${body.updated.length}`;
  } catch (e) { status(e.message, "error"); $("#renameDialog").close(); }
};
$("#cancelRename").onclick = () => $("#renameDialog").close();

await load();
const renamed = params.get("renamed");
if (renamed !== null) status(`Renamed. Updated links in ${renamed} page(s).`, "ok");
