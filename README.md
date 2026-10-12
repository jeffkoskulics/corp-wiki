# Company Wiki

A read-only HTML wiki that anyone with edit rights can change in the browser, using Obsidian-flavoured Markdown.

- **Pages** are Markdown files in `content/`. They work as an Obsidian vault too.
- **Reading:** [Quartz](https://quartz.jzhao.xyz/) renders static HTML, with wikilinks, backlinks, graph, search, callouts and tags.
- **Editing:** the `/edit/` page uses CodeMirror, with `[[` autocomplete, preview and edit summaries. Every save is a Git commit attributed to the signed-in user.
- **Renaming** moves the page and rewrites every `[[link]]`, `[[link|alias]]`, `[[link#heading]]` and `![[embed]]` pointing at it in one atomic commit. Links inside code are left alone. If the new title would be ambiguous, links switch to `[[Folder/Title]]`.
- **Hosting:** Azure Static Web Apps, with Entra ID sign-in. The API is Azure Functions in `api/`, and it writes to this repo via the GitHub API.

```
content/            Markdown pages (the vault)
api/                Azure Functions: page read/save, rename, backlinks, roles
  src/lib/wikilinks.mjs   link parsing + rename rewriting (unit tested)
editor/             browser editor, Edit button, "create this page" 404
scripts/            build (Quartz + editor), local dev server
quartz.config.ts    site title, theme, plugins
```

## Local preview

```bash
npm install
npm run build      # clones Quartz v4.5.2 into .quartz/ on first run
npm run dev        # http://localhost:4280. The API runs against content/ on disk, with no auth.
npm test
```

After editing locally, run `npm run build` again to see the rendered pages update.

## Deploying to Azure (one-time setup)

1. **Create a Static Web App** on the **Standard** plan (custom Entra auth and `rolesSource` need Standard). Choose "Other" as the deployment source, then copy its deployment token into the repo secret `AZURE_STATIC_WEB_APPS_API_TOKEN`.
2. **Register an app in Entra ID**:
   - Redirect URI: `https://<your-site>/.auth/login/aad/callback`.
   - Create a client secret.
   - To limit editing to one group, add the **groups** claim under Token configuration.
   - Replace `<TENANT_ID>` in `staticwebapp.config.json` with your tenant ID.
3. **Create a GitHub token** for the API: a fine-grained PAT, or better a GitHub App, with **Contents: read & write** on this repo only.
4. **Set the Static Web App's application settings**:

| Setting | Value |
| --- | --- |
| `AAD_CLIENT_ID`, `AAD_CLIENT_SECRET` | from step 2 |
| `GITHUB_TOKEN` | from step 3 |
| `GITHUB_REPO` | `owner/repo` |
| `GITHUB_BRANCH` | `main` (default) |
| `CONTENT_DIR` | `content` (default) |
| `EDITOR_GROUP_ID` | *optional*: the object ID of the Entra group allowed to edit. If unset, every signed-in employee can edit. |

5. Push to `main`. The workflow builds and deploys. Every save in the web editor is a commit on `main`, which triggers a rebuild, so pages update in about a minute.

**Access model:** the whole site requires a tenant sign-in. Reading is open to any signed-in user. `/edit/`, saving and renaming require the `editor` role, which `api/src/functions/roles.mjs` assigns.

**Surfacing in SharePoint:** add a Quick Link or Embed web part pointing at the site on your intranet home page.

## How conflicts are handled

Saving sends the blob SHA the editor loaded. If someone saved in between, the API returns 409 and the editor shows their version next to yours so you can merge.

A rename commits on top of the exact head it read. If the branch moved meanwhile, it fails cleanly and asks the user to retry.

## Known limits / next steps

- The rename API reads every page, so it is fine up to a few thousand pages. Beyond that, keep a link index.
- Image upload from the editor is not built yet. For now, commit images to `content/` (Obsidian `![[image.png]]` works).
- "Moved" stubs are plain pages linking to the new title, not HTTP redirects.
- No page-history UI yet. Use the repo's GitHub history, or add a `/api/history` endpoint that reads commits for a path.
