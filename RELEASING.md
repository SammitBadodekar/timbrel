# Releasing Timbrel

Releases come in two independent families, because the app and its AI engine
have very different sizes and cadences:

| Family | Tag | Contents | Cadence |
| --- | --- | --- | --- |
| **App** | `v0.1.0` | Electron installers (dmg / exe / AppImage / deb), ~100 MB | every release |
| **Sidecar** | `sidecar-v0.1.0` | Frozen Python engine (Demucs + torch), ~1 GB per platform | rarely |

The installers stay small because the packaged app **downloads the sidecar on
first run** (`apps/desktop/src/main/sidecar/resolve.ts`) from the release tagged
`sidecar-v<version>`, where `<version>` is pinned in
`apps/desktop/src/main/sidecar/version.ts`.

## Releasing the sidecar (do this first, once per engine change)

1. Bump `__sidecarVersion` in `apps/desktop/src/main/sidecar/version.ts`.
2. Commit, then tag and push:

   ```sh
   git tag sidecar-v0.2.0 && git push origin sidecar-v0.2.0
   ```

3. `release-sidecar.yml` builds PyInstaller binaries for macOS arm64,
   Windows x64 and Linux x64, and **publishes the release immediately**
   (the app downloads assets by direct URL, so it can't be a draft).

The CI checks that the tag matches `version.ts` and fails fast on mismatch.
Users who already installed the sidecar only re-download when the pinned
version changes.

## Releasing the app

1. Make sure a published `sidecar-v*` release exists for the version pinned in
   `version.ts` — a fresh install downloads it on first run.
2. Bump `version` in `apps/desktop/package.json`.
3. Commit, then tag and push:

   ```sh
   git tag v0.2.0 && git push origin v0.2.0
   ```

4. `release-app.yml` builds installers for macOS arm64, Windows x64 and
   Linux x64 into a **draft release** with install notes prefilled.
5. Smoke-test at least one installer, then **publish the draft** on GitHub.
   The website's Download button (timbrel.samz.in → /releases) shows only
   published releases.

The CI checks that the tag matches `apps/desktop/package.json` and fails fast
on mismatch.

## Signing (current state: unsigned)

There is no Apple Developer ID or Windows signing cert yet:

- **macOS**: builds are ad-hoc signed. Downloaded apps hit Gatekeeper
  quarantine — users run `xattr -cr /Applications/Timbrel.app` once (this is in
  the release notes template).
- **Windows**: SmartScreen shows "unrecognized app" until enough reputation
  accrues.

When a cert arrives: set `notarize: true` plus `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/
`APPLE_TEAM_ID` secrets for macOS, and `CSC_LINK`/`CSC_KEY_PASSWORD` for
Windows, then remove `CSC_IDENTITY_AUTO_DISCOVERY: "false"` from the workflow.

## Platforms

CI builds macOS **arm64**, Windows **x64**, Linux **x64**. Intel-Mac and other
combinations build from source (`pnpm --filter desktop run build:mac` etc.);
`resolve.ts` already maps every os/arch pair to an asset name, so adding a
runner to the matrix is all it takes to support one more platform.

## Testing builds locally

```sh
# installers land in apps/desktop/dist
pnpm --filter desktop run build:mac      # or build:win / build:linux

# frozen sidecar lands in sidecar/dist/timbrel-sidecar
cd sidecar && source .venv/bin/activate
pip install -r requirements-dev.txt
pyinstaller timbrel-sidecar.spec --noconfirm
```

To point a packaged app at a locally served sidecar archive, set
`TIMBREL_SIDECAR_URL` to any base URL that serves
`timbrel-sidecar-<os>-<arch>.tar.gz`.
