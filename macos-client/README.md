# Westron Client for macOS

This directory contains the macOS-only packaging configuration, app icon, and release output. The launcher source remains shared with the Windows build so features and fixes stay in sync.

From the repository root on macOS, with Node.js 22.12+ and JDK 25+ installed:

```sh
npm install
npm run package:macos
```

The `.dmg` and `.zip` are written to `macos-client/release/`; Windows builds remain in the root `release/` directory. The app uses the normal macOS Minecraft directory under `~/Library/Application Support/minecraft`. Apple signing and notarization require the publisher's own Developer ID credentials and are intentionally not embedded in the project.
