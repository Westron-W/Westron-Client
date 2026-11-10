# Westron Client updates

The Windows NSIS installer uses `electron-updater` with the public Skin API
feed at `https://westronskin.sytes.net/updates/`. The launcher only checks for
updates when it is packaged on Windows; update errors do not prevent normal
startup. GitHub Releases provide only the Windows `.exe` and macOS `.dmg`
downloads, while the verified publisher uploads the Windows updater assets to
the Skin API feed from the launcher's Settings page.

GitHub Actions publishes tagged releases using the repository's workflow
permissions. Everyone can check for and install published versions.

## Build and publish a release

1. Increment `version` in `package.json`, keep the root version in
   `package-lock.json` and the Fabric mod version in `fabric-mod/gradle.properties`
   in sync, and update the versioned artifact names in both electron-builder
   configs. The installed version must be lower than the version being published.
2. Push the commit and a matching `v<version>` tag. GitHub Actions builds
   Windows and macOS installers and publishes the release for direct downloads.
3. Sign in to the packaged Windows launcher with the verified
   `ermiscaner78@gmail.com` Westron account, open Settings, and publish the
   release folder containing the Windows installer, `.blockmap`, and
   `latest.yml`. The launcher checks the installer against the current app
   version and upload size limit. If `latest.yml` is stale, it creates fresh
   metadata from the selected installer's SHA-512 hash; keep the installer and
   `.blockmap` from the same build. It uploads the manifest last, and large
   upload requests have no client-side timeout.
4. Confirm the new version is available from the launcher's update check. The
   API accepts only the configured publisher account and checks the manifest
   SHA-512 against the uploaded installer.

The API feed includes `latest.yml`, the versioned Windows installer, and its
blockmap. macOS packages remain available through GitHub Releases and are not
automatically updated by the Windows updater.

`electron-builder` generates `latest.yml` and the file hashes during packaging;
they are not checked into source control. The updater uses HTTPS and verifies
downloaded artifacts against the SHA-512 values in that metadata. For stronger
publisher identity, sign the Windows installer using a certificate supplied
through the build environment (for example, `CSC_LINK` and `CSC_KEY_PASSWORD`).
Never commit the signing certificate or password to the repository.
