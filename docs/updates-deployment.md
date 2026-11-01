# Westron Client updates

The Windows NSIS installer uses `electron-updater` with the public
`Westron-W/Westron-Client` GitHub Releases feed. The launcher only checks for
updates when it is packaged on Windows; update errors do not prevent normal
startup. The Skin API's `/updates/` and `/api/v1/admin/updates/{filename}`
routes are a separate legacy feed and are not used by the launcher.

GitHub Actions publishes tagged releases using the repository's workflow
permissions. Everyone can check for and install published versions.

## Build and publish a release

1. Increment `version` in `package.json`, keep the root version in
   `package-lock.json` and the Fabric mod version in `fabric-mod/gradle.properties`
   in sync, and update the versioned artifact names in both electron-builder
   configs. The installed version must be lower than the version being published.
2. Push the commit and a matching `v<version>` tag. The GitHub Actions workflow
   builds Windows and macOS installers and publishes the release.
3. Confirm that the release includes the Windows installer, its `.blockmap`,
   `latest.yml`, and the Windows/macOS download assets. Do not edit generated
   hashes in `latest.yml`.
4. Verify the public GitHub release and its assets before announcing the update.

The legacy Skin API update endpoints remain available for the API's independent
feed, but changing them does not publish an updater release. GitHub Releases are
the source used by the launcher.

`electron-builder` generates `latest.yml` and the file hashes during packaging;
they are not checked into source control. The updater uses HTTPS and verifies
downloaded artifacts against the SHA-512 values in that metadata. For stronger
publisher identity, sign the Windows installer using a certificate supplied
through the build environment (for example, `CSC_LINK` and `CSC_KEY_PASSWORD`).
Never commit the signing certificate or password to the repository.
