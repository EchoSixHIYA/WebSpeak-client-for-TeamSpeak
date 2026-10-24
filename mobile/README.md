# Android client

The Android app packages the Vue client with a small local gateway. Capacitor starts the embedded Node.js runtime, the gateway listens on `127.0.0.1:3040`, and the WebView opens that local address. The gateway is loopback-only; it does not expose an HTTP listener to the LAN. Release APKs are debug-signed sideload packages, not Google Play builds.

## Build on Windows

Use a short checkout path such as `C:\src\webspeak`. The Node.js plugin's CMake/Ninja object paths can exceed the Windows toolchain limit in deeply nested workspaces. A clean build in a nested validation directory failed with CMake's 250-character object-path warning and a Ninja `mkdir` error; the same source and dependencies built successfully from a shorter path. Changing application code or the embedded runtime is not required for this build-host issue.

Use Node.js 22.12 or newer on the build host. Install all three dependency sets, then prepare and sync the Android project:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm rebuild @discordjs/opus --foreground-scripts --no-audit --no-fund
npm --prefix web ci --no-audit --no-fund
npm --prefix mobile ci --no-audit --no-fund
npm run android:sync
```

Build the debug APKs with Android Studio's JDK and the checked-in Gradle wrapper:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
Set-Location web\android
.\gradlew.bat assembleDebug
```

Gradle writes one APK per supported CPU architecture under `web/android/app/build/outputs/apk/debug/`: `arm64-v8a`, `armeabi-v7a`, and `x86_64`. Use `arm64-v8a` for most modern Android phones and `x86_64` for the Android emulator. GitHub Releases contains all three APKs with versioned filenames.

## Current scope

- Platform startup is isolated in `web/src/platform/`. Ordinary browser sessions mount directly; the native shell loads the Node.js plugin only while waiting for its loopback gateway. Startup errors, timeouts and page exit release polling and message listeners. Retry repeats the readiness handshake without restarting the embedded Node.js runtime.
- The local gateway serves the join page, public configuration, skin package, join-ticket endpoint, and voice WebSocket bridge.
- The admin console and server-side skin management are not available in the Android package.
- Mobile audio encoding uses the JavaScript/WASM Opus codec. The normal server build continues to use the native Opus codec.
- The embedded runtime supplied by the current Capacitor Node.js plugin is Node.js 18.20.4. The gateway, identity parsing, and Opus encode/decode paths have been smoke-checked on that runtime. The upstream TeamSpeak SDK 1.0 declares Node.js 22.12 or newer, so real TeamSpeak connectivity and two-way audio remain unverified on Android; the APKs are for sideload testing.
- Android WebView on the tested emulator does not expose `getDisplayMedia`; screen sharing needs a native MediaProjection integration. A persistent Android foreground service and real-device background audio behavior also remain to be implemented and verified.
