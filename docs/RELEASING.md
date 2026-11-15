# Releasing

Packaging uses electron-builder (`electron-builder.yml`). Output goes to `dist/` (git-ignored).

```
npm run dist:dir   # unpacked app for the current platform (quick test): dist/win-unpacked, dist/mac*, dist/linux-unpacked
npm run dist       # installers: Windows NSIS (x64), macOS dmg (x64 + arm64), Linux AppImage (x64)
npm run icons      # regenerate build/icon.png + build/icon.ico from build/icon.svg (uses Electron)
```

Build each platform on its own OS (dmg needs macOS). `npm run build` typechecks first.
Bump `version` in package.json before a release.

What ships: `out/**`, `build/icon.png`, `package.json`, and only `scripts/jira-mock/*.mjs`
(unpacked to `app.asar.unpacked`, because it runs as a child process; see `unpackedAsar` in
`src/main/services/config.ts`). Renderer dependencies are bundled by Vite and live in `devDependencies`,
so only the main process's runtime deps (`cross-spawn`, `zod`) are packaged. Keep it that way: a dependency
the main bundle imports at runtime must go in `dependencies`.

## Signing

Without certificates electron-builder skips signing and the build still succeeds (unsigned installers
trigger SmartScreen / Gatekeeper warnings). Signing is picked up from the environment:

- Windows: `CSC_LINK` (path or base64 of the .pfx) and `CSC_KEY_PASSWORD`. For separate Windows/macOS
  certs use `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`.
- macOS: `CSC_LINK` / `CSC_KEY_PASSWORD` with a "Developer ID Application" certificate. Hardened runtime
  is on in the config.
- macOS notarization (needs the `notarize` option, or `mac.notarize: true` in the yml, once a certificate
  exists): `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`; or an App Store Connect API key via
  `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.
- Linux AppImage is unsigned.

## Auto-update (not implemented)

There is no update code. Recommended follow-up: `electron-updater` with GitHub Releases. Publish with
`electron-builder --publish always` from CI (`GH_TOKEN`), add a `publish: { provider: github }` block to
`electron-builder.yml`, and call `autoUpdater.checkForUpdatesAndNotify()` from the main process in packaged
builds only. Auto-update requires signed builds on macOS (and strongly recommended on Windows).
