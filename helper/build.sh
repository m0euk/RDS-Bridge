#!/usr/bin/env bash
# build.sh — cross-compile rds-bridge-helper for all release targets.
#
# Run on macOS (the .app wrap and universal binary need `lipo`; Go cross-compiles the
# Windows/Linux targets from there). Produces, under ./dist:
#   rds-bridge-helper-<TAG>-windows-amd64.exe   (no console window: -H=windowsgui)
#   rds-bridge-helper-<TAG>-linux-amd64
#   rds-bridge-helper-<TAG>-darwin-arm64
#   rds-bridge-helper-<TAG>-darwin-amd64
#   RDS Bridge Helper.app                        (universal arm64+amd64, background agent)
#   RDS-Bridge-Helper-<TAG>-macos-app.zip        (the .app, zipped for distribution)
#   SHA256SUMS.txt                               (over every asset above)
#
# TAG defaults to the helperBuild string in main.go so candidate builds are labelled
# consistently; override for the release, e.g.  ./build.sh 0.8.2-beta
set -euo pipefail

# TAG comes from helperBuild in main.go. An explicit argument is allowed only if it AGREES
# with helperBuild: passing a different one used to rename the FILES while leaving the string
# compiled into the binary untouched, so `-version` disagreed with the filename. That is exactly
# how 0.8.2-beta shipped with helperBuild="0.8.2-cand.2" inside binaries named 0.8.2-beta.
# To release: edit helperBuild in main.go, then run ./build.sh with no argument.
SRC_TAG="$(sed -n 's/^var helperBuild = "\(.*\)"/\1/p' main.go)"
TAG="${1:-$SRC_TAG}"
if [ "$TAG" != "$SRC_TAG" ]; then
  echo "ERROR: requested tag '$TAG' != helperBuild '$SRC_TAG' in main.go." >&2
  echo "       Edit helperBuild in main.go and re-run with no argument." >&2
  exit 1
fi
APP_ID="com.m0euk.rds-bridge-helper"
OUT="dist"
BIN="rds-bridge-helper-${TAG}"

echo "Building rds-bridge-helper ${TAG}"
rm -rf "$OUT"; mkdir -p "$OUT"

# CGO stays off for a single static binary on every target.
export CGO_ENABLED=0

# Windows: -H=windowsgui drops the console window (the served page's Stop button is the quit).
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w -H=windowsgui" -o "$OUT/${BIN}-windows-amd64.exe" .
GOOS=linux   GOARCH=amd64 go build -trimpath -ldflags "-s -w"             -o "$OUT/${BIN}-linux-amd64"      .
GOOS=darwin  GOARCH=arm64 go build -trimpath -ldflags "-s -w"             -o "$OUT/${BIN}-darwin-arm64"     .
GOOS=darwin  GOARCH=amd64 go build -trimpath -ldflags "-s -w"             -o "$OUT/${BIN}-darwin-amd64"     .

# macOS .app — a universal (arm64+amd64) background agent (LSUIElement: no Dock icon).
APP="$OUT/RDS Bridge Helper.app"
mkdir -p "$APP/Contents/MacOS"
lipo -create -output "$APP/Contents/MacOS/rds-bridge-helper" \
     "$OUT/${BIN}-darwin-arm64" "$OUT/${BIN}-darwin-amd64"
chmod +x "$APP/Contents/MacOS/rds-bridge-helper"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key>            <string>RDS Bridge Helper</string>
	<key>CFBundleDisplayName</key>     <string>RDS Bridge Helper</string>
	<key>CFBundleIdentifier</key>      <string>${APP_ID}</string>
	<key>CFBundleVersion</key>         <string>${TAG}</string>
	<key>CFBundleShortVersionString</key><string>${TAG}</string>
	<key>CFBundleExecutable</key>      <string>rds-bridge-helper</string>
	<key>CFBundlePackageType</key>     <string>APPL</string>
	<key>LSMinimumSystemVersion</key>  <string>10.15</string>
	<key>LSUIElement</key>             <true/>
</dict>
</plist>
PLIST
( cd "$OUT" && ditto -c -k --keepParent "RDS Bridge Helper.app" "RDS-Bridge-Helper-${TAG}-macos-app.zip" )

# Checksums over every asset (self-check with `shasum -a 256 -c SHA256SUMS.txt`).
( cd "$OUT" && shasum -a 256 \
    "${BIN}-windows-amd64.exe" "${BIN}-linux-amd64" \
    "${BIN}-darwin-arm64" "${BIN}-darwin-amd64" \
    "RDS-Bridge-Helper-${TAG}-macos-app.zip" > SHA256SUMS.txt )

echo "Done. Assets in ./$OUT:"
ls -1 "$OUT"
echo
echo "NOTE: macOS binaries are unsigned/un-notarized (deliberate). To run the raw CLI binary:"
echo "  chmod +x ${BIN}-darwin-arm64 && xattr -d com.apple.quarantine ${BIN}-darwin-arm64 && ./${BIN}-darwin-arm64"
echo "For the .app, clear quarantine on the bundle:  xattr -dr com.apple.quarantine 'RDS Bridge Helper.app'"
