#!/usr/bin/env bash
# Generates the Android project from app/ and adds bitrecipe's native bits:
# share-sheet intent filter, BitNative plugin, icons and splash.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d node_modules ] || npm install --no-audit --no-fund

# Version shown in Settings (and used by the update check). CI sets these.
if [ -n "${BITRECIPE_VERSION:-}" ]; then
  printf "export const VERSION = '%s';\n" "$BITRECIPE_VERSION" > app/js/version.js
fi
[ -d android ] || npx cap add android

PKG_DIR=android/app/src/main/java/com/bit128/bitrecipe
mkdir -p "$PKG_DIR"
cp native/android/*.java "$PKG_DIR/"
cp -r native/android/res/. android/app/src/main/res/

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

if ! grep -q 'RECORD_AUDIO' "$MANIFEST"; then
  # Timer alarms: notification permission, exact alarms, DND access, vibration, and the receiver.
  python3 - "$MANIFEST" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
perms = '''
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.USE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" android:maxSdkVersion="32" />
    <uses-permission android:name="android.permission.ACCESS_NOTIFICATION_POLICY" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <queries>
        <intent><action android:name="android.speech.RecognitionService" /></intent>
        <intent><action android:name="android.intent.action.TTS_SERVICE" /></intent>
    </queries>
'''
receiver = '''
        <receiver android:name=".TimerReceiver" android:exported="false" />
'''
s = s.replace('</manifest>', perms + '</manifest>')
s = s.replace('</application>', receiver + '    </application>')
open(p, 'w').write(s)
PY
fi

# Resize (not cover) the app when the keyboard opens; MainActivity pads for it.
if ! grep -q 'windowSoftInputMode' "$MANIFEST"; then
  sed -i 's|android:name=".MainActivity"|android:name=".MainActivity"\n            android:windowSoftInputMode="adjustResize"|' "$MANIFEST"
fi

npx capacitor-assets generate --android \
  --iconBackgroundColor '#0b0b16' --iconBackgroundColorDark '#0b0b16' \
  --splashBackgroundColor '#0b0b16' --splashBackgroundColorDark '#0b0b16'
GRADLE=android/app/build.gradle
# Sign every build with the same key (native/android/debug.keystore) so new
# versions install over old ones and keep your recipes.
if ! grep -q 'bitrecipe-signing' "$GRADLE"; then
  python3 - "$GRADLE" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
block = '''
    // bitrecipe-signing: one fixed key for every build
    signingConfigs {
        debug {
            storeFile file("${rootDir}/../native/android/debug.keystore")
            storePassword "android"
            keyAlias "androiddebugkey"
            keyPassword "android"
        }
    }
'''
s = s.replace('android {\n', 'android {\n' + block, 1)
s = s.replace('buildTypes {', 'buildTypes {\n        debug {\n            signingConfig signingConfigs.debug\n        }', 1)
open(p, 'w').write(s)
PY
fi
# Installed app ID. ".app" so this installs next to the very first test builds,
# which were signed with throwaway keys and can never be updated.
sed -i 's/applicationId "com.bit128.bitrecipe"$/applicationId "com.bit128.bitrecipe.app"/' "$GRADLE"

if [ -n "${BITRECIPE_BUILD:-}" ]; then
  sed -i -E "s/versionCode [0-9]+/versionCode ${BITRECIPE_BUILD}/; s/versionName \"[^\"]*\"/versionName \"${BITRECIPE_VERSION}\"/" android/app/build.gradle
fi
npx cap sync android
echo "Android project ready. Build with: cd android && ./gradlew assembleDebug"
