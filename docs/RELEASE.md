# Brick Keeper Release Guide

This guide covers the first easy-install Windows release path. The public
installer should use the Tauri desktop app with local SQLite storage. WAMP,
MySQL and MariaDB remain advanced LAN/server modes and are not required for a
normal user installation.

## Release Scope

The Windows installer MVP includes:

- the Tauri desktop shell;
- bundled HTML, CSS, JavaScript, icons and generated CSV reference data;
- local SQLite persistence created on first launch;
- catalog lookup, set lookup and buildable-set discovery through SQLite;
- JSON import/export for migration and backups.

The Windows installer MVP does not include:

- WAMP, Apache, MySQL or MariaDB;
- MySQL reference-data import automation;
- automatic desktop updates;
- Windows code signing.

Unsigned installers are expected to show Windows SmartScreen warnings. Code
signing should be added before recommending the installer to non-technical
users at scale.

## Local Windows Build

Prerequisites:

1. Node.js 22 LTS.
2. Rust stable toolchain with `cargo`.
3. Tauri 2 Windows prerequisites.

Build and validate:

```powershell
npm ci
npm test
npm run tauri:build
```

The installer is written under:

```text
src-tauri/target/release/bundle/
```

The primary public artifact is the NSIS `.exe` installer.

## GitHub Release Build

The workflow `.github/workflows/release-windows.yml` builds the installer on
`windows-latest`.

To create a public release from the command line:

```powershell
git tag v1.0rc
git push origin v1.0rc
```

The workflow will:

1. install Node dependencies with `npm ci`;
2. install/use Rust stable;
3. run `npm test`;
4. run `npm run tauri:build`;
5. upload the generated Windows installer as a workflow artifact;
6. attach the installer to the GitHub Release for the tag.

You can also run the workflow manually. Leave `release_tag` empty for a test
build that only uploads workflow artifacts. Provide a tag such as `v1.0rc` to
publish or update a GitHub Release.

## Clean-Machine Smoke Test

Before announcing a release, test the installer on a Windows machine that does
not have Node.js, Rust, WAMP or MySQL installed.

Required checks:

1. Install Brick Keeper from the generated `.exe`.
2. Launch the app from the Start menu.
3. Confirm the first launch creates the local SQLite database.
4. Add a brick manually.
5. Add a brick photo.
6. Search by part number.
7. Open `Sets` and search for a set.
8. Use `Show buildable sets`.
9. Close and reopen the app.
10. Confirm the inventory is still present.
11. Export JSON.
12. Uninstall the app.

If any step fails, fix the issue before publishing the GitHub Release.
