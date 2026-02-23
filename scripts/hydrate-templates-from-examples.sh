#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATES_DIR="$ROOT_DIR/templates"
CI_SCRIPTS_DIR="$ROOT_DIR/ci-scripts"
REPO_URL="https://github.com/extension-js/examples"

has_required_templates() {
  local required=("typescript" "react" "svelte" "vue")
  for name in "${required[@]}"; do
    [[ -f "$TEMPLATES_DIR/$name/src/manifest.json" ]] || return 1
    [[ -f "$TEMPLATES_DIR/$name/template.spec.ts" ]] || return 1
    [[ -f "$TEMPLATES_DIR/$name/package.json" ]] || return 1
  done

  [[ -f "$TEMPLATES_DIR/extension-fixtures.ts" ]] || return 1
  [[ -f "$TEMPLATES_DIR/dirname.ts" ]] || return 1
  [[ -f "$CI_SCRIPTS_DIR/build-with-manifest.mjs" ]] || return 1
}

if has_required_templates; then
  echo "Templates already hydrated. Skipping fetch."
  exit 0
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

npx -y -c "node -e \"const goGitIt = require('go-git-it'); const run = goGitIt.default || goGitIt; run('$REPO_URL', '$TMP_DIR', 'Hydrating templates from extension-js/examples').catch((err) => { console.error(err); process.exit(1); });\""

mkdir -p "$TEMPLATES_DIR" "$CI_SCRIPTS_DIR"
cp -R "$TMP_DIR/examples/examples/." "$TEMPLATES_DIR/"
cp "$TMP_DIR/examples/ci-scripts/build-with-manifest.mjs" "$CI_SCRIPTS_DIR/build-with-manifest.mjs"

echo "Templates hydrated from extension-js/examples."
