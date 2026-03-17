#!/bin/bash
# ═══════════════════════════════════════════════════════
# build-ios.sh — Build web assets for Capacitor iOS
# Copies web files to www/, bundles capacitor shim,
# and syncs with the Xcode project.
# ═══════════════════════════════════════════════════════

set -e
cd "$(dirname "$0")/.."

echo "══════════════════════════════════════"
echo " RaiNote iOS Build"
echo "══════════════════════════════════════"

# ─── Step 1: Clean and create www/ ──────────────────

echo ""
echo "1. Preparing www/ directory..."

rm -rf www
mkdir -p www/css www/js

# ─── Step 2: Copy web assets ────────────────────────

echo "2. Copying web assets..."

cp index.html www/
cp -r css/* www/css/
cp -r js/* www/js/

# ─── Step 3: Bundle capacitor shim with esbuild ────

echo "3. Bundling capacitor shim..."

npx esbuild src/capacitor-shim.js \
  --bundle \
  --outfile=www/js/capacitor-shim.js \
  --format=iife \
  --platform=browser \
  --target=safari15 \
  --minify

echo "   Shim bundled: www/js/capacitor-shim.js"

# ─── Step 4: Modify index.html for Capacitor ───────

echo "4. Modifying index.html for Capacitor..."

# Add viewport meta tag for iOS (before </head>)
sed -i '' 's|</head>|  <meta name="viewport" content="viewport-fit=cover, width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no">\
  <meta name="apple-mobile-web-app-capable" content="yes">\
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\
  <link rel="stylesheet" href="css/ios.css">\
</head>|' www/index.html

# Inject capacitor shim BEFORE the other scripts
# The shim must load first so window.electron is available
sed -i '' 's|<!-- Scripts -->|<script src="js/capacitor-shim.js"></script>\n<!-- Scripts -->|' www/index.html

echo "   index.html modified"

# ─── Step 5: Sync with Capacitor ───────────────────

echo "5. Syncing with Capacitor iOS..."

npx cap sync ios 2>&1

echo ""
echo "══════════════════════════════════════"
echo " Build complete!"
echo ""
echo " To open in Xcode:"
echo "   npx cap open ios"
echo ""
echo " To live-reload during development:"
echo "   npx cap run ios --livereload"
echo "══════════════════════════════════════"
