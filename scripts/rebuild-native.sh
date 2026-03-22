#!/usr/bin/env bash
set -euo pipefail

# Find better-sqlite3 (Bun may hoist to different paths)
BETTER_SQLITE3_DIR=$(find node_modules -path '*/better-sqlite3/binding.gyp' -exec dirname {} \; 2>/dev/null | head -1)

if [ -z "$BETTER_SQLITE3_DIR" ]; then
  echo "[rebuild-native] better-sqlite3 not found, skipping"
  exit 0
fi

# electron may be nested under apps/desktop/node_modules (not hoisted to root)
ELECTRON_PKG=$(find . -path '*/node_modules/electron/package.json' ! -path '*/node_modules/.cache/*' 2>/dev/null | head -1)
if [ -z "$ELECTRON_PKG" ]; then
  echo "[rebuild-native] electron not found, skipping"
  exit 0
fi
ELECTRON_VERSION=$(node -e "console.log(require('$PWD/$ELECTRON_PKG').version)")
ARCH=$(uname -m | sed 's/arm64/arm64/;s/x86_64/x64/')

echo "[rebuild-native] Rebuilding better-sqlite3 for Electron $ELECTRON_VERSION ($ARCH)..."
cd "$BETTER_SQLITE3_DIR"
npx --yes node-gyp rebuild \
  --target="$ELECTRON_VERSION" \
  --arch="$ARCH" \
  --dist-url=https://electronjs.org/headers
echo "[rebuild-native] Done"
