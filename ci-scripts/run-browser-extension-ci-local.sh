#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BROWSER_EXTENSION_DIR="${BROWSER_EXTENSION_DIR:-$ROOT_DIR/extensions/browser-extension}"
NODE_VERSION="${NODE_VERSION:-20}"
PNPM_VERSION="${PNPM_VERSION:-}"

if [[ ! -d "$BROWSER_EXTENSION_DIR" ]]; then
  echo "Browser extension path not found: $BROWSER_EXTENSION_DIR" >&2
  exit 1
fi

if [[ -z "$PNPM_VERSION" ]]; then
  PACKAGE_MANAGER="$(jq -r '.packageManager // empty' "$BROWSER_EXTENSION_DIR/package.json" 2>/dev/null || true)"
  if [[ "$PACKAGE_MANAGER" == pnpm@* ]]; then
    PNPM_VERSION="${PACKAGE_MANAGER#pnpm@}"
  else
    PNPM_VERSION="10.4.1"
  fi
fi

echo "==> Local CI emulation setup"
echo "    extension.js root: $ROOT_DIR"
echo "    browser-extension: $BROWSER_EXTENSION_DIR"
echo "    node: $NODE_VERSION, pnpm: $PNPM_VERSION"

echo "==> Building local extension.js packages"
pnpm --dir "$ROOT_DIR" --filter extension-develop compile
pnpm --dir "$ROOT_DIR" --filter extension-create compile
pnpm --dir "$ROOT_DIR" --filter extension-install compile
pnpm --dir "$ROOT_DIR" --filter extension compile

echo "==> Running clean Ubuntu CI mirror in Docker"
docker run --rm -t \
  -e NODE_VERSION="$NODE_VERSION" \
  -e PNPM_VERSION="$PNPM_VERSION" \
  -e DEBIAN_FRONTEND=noninteractive \
  -v "$ROOT_DIR:/mnt/extensionjs:ro" \
  -v "$BROWSER_EXTENSION_DIR:/mnt/browser-extension:ro" \
  ubuntu:24.04 bash -lc '
set -euo pipefail

apt-get update -yq >/dev/null
apt-get install -yq curl git jq ca-certificates >/dev/null

curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - >/dev/null
apt-get install -yq nodejs >/dev/null
npm install -g pnpm@${PNPM_VERSION} >/dev/null

WORKDIR=/tmp/browser-extension-ci
cp -a /mnt/browser-extension "$WORKDIR"
chmod -R u+w "$WORKDIR"
cd "$WORKDIR"

echo "==> Rewiring browser-extension to local extension.js packages"
jq '"'"'
  .devDependencies.extension = "file:/mnt/extensionjs/programs/cli" |
  .pnpm.overrides.extension = "file:/mnt/extensionjs/programs/cli" |
  .pnpm.overrides["extension-create"] = "file:/mnt/extensionjs/programs/create" |
  .pnpm.overrides["extension-develop"] = "file:/mnt/extensionjs/programs/develop" |
  .pnpm.overrides["extension-install"] = "file:/mnt/extensionjs/programs/install"
'"'"' package.json > package.json.tmp
mv package.json.tmp package.json

echo "==> Generating lockfile for local file deps"
pnpm install --lockfile-only --ignore-workspace --no-frozen-lockfile >/dev/null

echo "==> Running CI-equivalent install and build"
rm -rf node_modules dist
export CI=true
export GITHUB_ACTIONS=true
pnpm install --frozen-lockfile
pnpm build:production 2>&1 | tee /tmp/build.log

echo "==> Build signature scan"
grep -nE "postcss-loader could not be resolved|plugin-react-refresh could not be loaded|Optional dependency" /tmp/build.log || true
'

echo "==> Local CI emulation completed successfully"
