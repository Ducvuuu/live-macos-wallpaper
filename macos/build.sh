#!/bin/zsh
# Builds SolarWallpaper.app with swiftc — no Xcode project, no Xcode.app needed.
#
# Usage:  ./build.sh          build and install to /Applications
#         ./build.sh --run    build, install, then relaunch
#         ./build.sh --dmg    build and package SolarWallpaper.dmg, no install
#
# The app installs to /Applications rather than living in this workspace, so
# there is exactly one copy and "Start at Login" has a stable path to point at.
# This folder holds the source; /Applications holds the app.
#
# The build stages into a temporary directory and only swaps into place once
# the compile succeeds, so a failed build always leaves the working app intact.
set -e

ROOT="${0:A:h}"
WEB="${ROOT:h}"
APP="/Applications/SolarWallpaper.app"
STAGE="$ROOT/.build-stage/SolarWallpaper.app"
DMG="$ROOT/.build-stage/SolarWallpaper.dmg"

echo "==> compiling"
rm -rf "$ROOT/.build-stage"
mkdir -p "$STAGE/Contents/MacOS" "$STAGE/Contents/Resources"

# Universal binary: Apple Silicon plus Intel, so the same build runs anywhere.
swiftc \
  -swift-version 5 \
  -O \
  -target arm64-apple-macos13.0 \
  -framework Cocoa -framework WebKit -framework ServiceManagement \
  -o "$STAGE/Contents/MacOS/SolarWallpaper-arm64" \
  "$ROOT"/Sources/*.swift

swiftc \
  -swift-version 5 \
  -O \
  -target x86_64-apple-macos13.0 \
  -framework Cocoa -framework WebKit -framework ServiceManagement \
  -o "$STAGE/Contents/MacOS/SolarWallpaper-x86_64" \
  "$ROOT"/Sources/*.swift

lipo -create \
  "$STAGE/Contents/MacOS/SolarWallpaper-arm64" \
  "$STAGE/Contents/MacOS/SolarWallpaper-x86_64" \
  -output "$STAGE/Contents/MacOS/SolarWallpaper"
rm -f "$STAGE/Contents/MacOS/SolarWallpaper-arm64" "$STAGE/Contents/MacOS/SolarWallpaper-x86_64"

cp "$ROOT/Resources/Info.plist" "$STAGE/Contents/Info.plist"
cp "$ROOT/Resources/AppIcon.icns" "$STAGE/Contents/Resources/AppIcon.icns"
cp "$ROOT/Resources/MenuBarIconTemplate.pdf" "$STAGE/Contents/Resources/MenuBarIconTemplate.pdf"

# The page itself, so a downloaded .app runs on a machine with no checkout.
# On this machine the checkout still wins at runtime — see resolveWebDirectory
# in AppDelegate.swift — so live reload while editing app.js is unaffected.
echo "==> staging web app"
mkdir -p "$STAGE/Contents/Resources/web"
for item in index.html app.js styles.css assets vendor LICENSES.md; do
  cp -R "$WEB/$item" "$STAGE/Contents/Resources/web/$item"
done

echo "==> signing (ad-hoc)"
# --deep so the staged web payload is covered too; without it the bundle seal
# does not include Resources/web and the signature verifies against an app
# whose contents can be swapped.
codesign --force --deep --sign - "$STAGE" 2>/dev/null

if [[ "$1" == "--dmg" ]]; then
  echo "==> packaging dmg"
  rm -f "$DMG"
  STAGE_DIR="$ROOT/.build-stage/dmg"
  rm -rf "$STAGE_DIR"
  mkdir -p "$STAGE_DIR"
  cp -R "$STAGE" "$STAGE_DIR/SolarWallpaper.app"
  ln -s /Applications "$STAGE_DIR/Applications"
  hdiutil create \
    -volname "Solar Wallpaper" \
    -srcfolder "$STAGE_DIR" \
    -ov -format UDZO \
    "$DMG"
  rm -rf "$STAGE_DIR"
  echo "==> built $DMG"
  exit 0
fi

echo "==> installing to /Applications"
pkill -x SolarWallpaper 2>/dev/null || true
sleep 1
rm -rf "$APP"
mv "$STAGE" "$APP"
rm -rf "$ROOT/.build-stage"
# Old builds lived here; leaving a stale copy behind invites confusion about
# which one is actually running.
rm -rf "$ROOT/SolarWallpaper.app"

echo "==> installed $APP"

if [[ "$1" == "--run" ]]; then
  open "$APP"
  echo "==> running. log: ~/Library/Logs/SolarWallpaper.log"
fi
