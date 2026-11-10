# Westron Client updates

The packaged Windows NSIS installer uses `electron-updater` with the public
GitHub Releases feed for `Westron-W/Westron-Client`. The launcher only checks
for updates when it is packaged on Windows; update errors do not prevent
normal startup. Each release includes the Windows `.exe`, its `.blockmap` and
`latest.yml` updater metadata, plus the macOS `.dmg`.

GitHub Actions publishes tagged releases using the repository's workflow
permissions. Everyone can check for and install published versions.

## Build and publish a release

1. Increment `version` in `package.json`, keep the root version in
   `package-lock.json` and the Fabric mod version in `fabric-mod/gradle.properties`
   in sync, and update the versioned artifact names in both electron-builder
   configs. The installed version must be lower than the version being published.
2. Push the commit and a matching `v<version>` tag. GitHub Actions builds
   Windows and macOS installers and publishes the release for direct downloads.
3. Confirm the new release contains the Windows installer, matching
   `.blockmap`, `latest.yml`, and macOS `.dmg`. The workflow verifies the
   manifest version and installer filename before publishing, then verifies
   the complete asset list.
4. Confirm the new version is available from the packaged Windows launcher's
   update check. `electron-updater` verifies the downloaded installer against
   the SHA-512 hash in `latest.yml`.

The launcher's Settings page still supports publishing Windows update files to
the Skin API for deployments that consume that separate service. It is not
used by the public GitHub updater. macOS packages are available through GitHub
Releases and are not automatically updated by the Windows updater.

`electron-builder` generates `latest.yml` and the file hashes during packaging;
they are not checked into source control. The updater uses HTTPS and verifies
downloaded artifacts against the SHA-512 values in that metadata. For stronger
publisher identity, sign the Windows installer using a certificate supplied
through the build environment (for example, `CSC_LINK` and `CSC_KEY_PASSWORD`).
Never commit the signing certificate or password to the repository.
