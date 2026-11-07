#!/usr/bin/env bash
# Generates the Android project from app/ and adds bitrecipe's native bits:
# share-sheet intent filter, BitNative plugin, icons and splash.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d node_modules ] || npm install --no-audit --no-fund
[ -d android ] || npx cap add android

PKG_DIR=android/app/src/main/java/com/bit128/bitrecipe
mkdir -p "$PKG_DIR"
cp native/android/MainActivity.java native/android/BitNativePlugin.java "$PKG_DIR/"

MANIFEST=android/app/src/main/AndroidManifest.xml
if ! grep -q 'android.intent.action.SEND' "$MANIFEST"; then
  # Show bitrecipe in the Android share sheet for links and text.
  python3 - "$MANIFEST" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
share = '''
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>
'''
marker = '</activity>'
i = s.index(marker)
s = s[:i] + share + '        ' + s[i:]
open(p, 'w').write(s)
PY
fi

npx capacitor-assets generate --android \
  --iconBackgroundColor '#0b0b16' --iconBackgroundColorDark '#0b0b16' \
  --splashBackgroundColor '#0b0b16' --splashBackgroundColorDark '#0b0b16'
npx cap sync android
echo "Android project ready. Build with: cd android && ./gradlew assembleDebug"
