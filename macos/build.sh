#!/bin/bash
set -euo pipefail

source_dir="$(cd "$(dirname "$0")/.." && pwd)"
build_dir="$(mktemp -d)"
trap 'rm -rf "$build_dir"' EXIT
export CLANG_MODULE_CACHE_PATH="${TMPDIR:-/tmp}/pixel-arcade-module-cache"

app_name='Tic Tac Toe.app'
app="$build_dir/$app_name"
resources="$app/Contents/Resources"
mkdir -p "$app/Contents/MacOS" "$resources/Game"
cp "$source_dir/macos/Info.plist" "$app/Contents/Info.plist"
cp "$source_dir/package.json" "$source_dir/server.js" "$resources/Game/"
cp -R "$source_dir/public" "$resources/Game/"

swiftc -swift-version 5 -O "$source_dir/macos/Launcher.swift" -o "$app/Contents/MacOS/TicTacToe"
swift "$source_dir/macos/DrawIcon.swift" "$resources/Arcade.icns"
codesign --force --sign - "$app"
codesign --verify --strict "$app"
ditto "$app" "$source_dir/$app_name"
