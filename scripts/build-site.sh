#!/usr/bin/env bash
# Builds the read-only site with Quartz, then adds the editor and Edit button.
# Output: public/  (deployed to Azure Static Web Apps together with api/)
set -euo pipefail
cd "$(dirname "$0")/.."
QUARTZ_REF="${QUARTZ_REF:-v4.5.2}"

if [ ! -d .quartz ]; then
  git clone --depth 1 --branch "$QUARTZ_REF" https://github.com/jackyzha0/quartz.git .quartz
fi
cp quartz.config.ts .quartz/quartz.config.ts
rm -rf .quartz/content && cp -r content .quartz/content
(cd .quartz && npm ci --no-audit --no-fund && npx quartz build --output ../public)

# Editor bundle
mkdir -p public/edit
npx esbuild editor/src/editor.js --bundle --minify --format=esm --target=es2022 --splitting --chunk-names=chunks/[name]-[hash] --outdir=public/edit
cp editor/index.html editor/editor.css public/edit/
cp editor/missing.html public/missing.html
cp editor/edit-button.js public/edit-button.js
cp staticwebapp.config.json public/

# Inject the Edit button into every generated page.
node scripts/inject-edit-button.mjs public
echo "Built site in public/"
