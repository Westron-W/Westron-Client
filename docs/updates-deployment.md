# Westron Client updates

The Windows NSIS installer uses `electron-updater` with the generic HTTPS feed
`https://westronskin.sytes.net/updates/`. The launcher only checks for updates
when it is packaged on Windows; update errors do not prevent normal startup.
The Skin API serves public update downloads from `/updates/`, while release
uploads use the authenticated `/api/v1/admin/updates/{filename}` route.

Only the verified `ermiscaner78@gmail.com` Westron account can publish. The API
checks the authenticated server-side account; hiding the publisher UI in the
launcher is only a convenience, not the authorization boundary. Everyone can
check for and install published versions.

## Build and publish a release

1. Increment `version` in `package.json` and keep the root version in
   `package-lock.json` in sync. The installed version must be lower than the
   version being published.
2. Build the Windows installer with `npm run package:win` (or `npm run
   package` to build the Fabric client mod as well).
3. Confirm the generated version in the installer filename and `latest.yml`
   matches the package version. Do not edit the generated hashes.
4. Sign in to the launcher with the verified publisher account, open Settings,
   choose **Release dosyalarını seç**, then select exactly the generated
   installer `.exe`, its `.exe.blockmap`, and `latest.yml` from `release/`.
   The launcher validates the generated SHA-512 and uploads the installer and
   blockmap before publishing the manifest last.
5. Verify `https://westronskin.sytes.net/updates/latest.yml` and its installer
   links are reachable over HTTPS before announcing the update.

The update feed is separate from the Skin API's `/api/` routes. On the existing
Nginx Proxy Manager host, add a `/updates/` location pointing at the same
Westron Skin API container/port used for the API routes, preserving the
`/updates/` prefix when proxying. The service handles `GET /updates/*` and
`POST /api/v1/admin/updates/*`. Set `UPDATE_PUBLISHER_EMAIL` in the API
environment to `ermiscaner78@gmail.com`; the release files are stored in the
existing persistent `/data` volume under `/data/updates`. Rebuild/recreate the
API service only after backing up its database/skin volume and reviewing the
proxy configuration. This repository does not change the live VDS or NPM.

`electron-builder` generates `latest.yml` and the file hashes during packaging;
they are not checked into source control. The updater uses HTTPS and verifies
downloaded artifacts against the SHA-512 values in that metadata. For stronger
publisher identity, sign the Windows installer using a certificate supplied
through the build environment (for example, `CSC_LINK` and `CSC_KEY_PASSWORD`).
Never commit the signing certificate or password to the repository.
