# Windows build and packaging

## Prerequisites

- Windows 10/11 x64
- Node.js 22-24 and npm 10+
- A clean lockfile install (`npm ci`)
- Versioned release notes at `docs/RELEASE_NOTES_<version>.md`
- Optional production code-signing credentials (not configured for current development artifacts)

Run diagnostics and verification first:

```powershell
npm ci
npm run doctor
npm run verify
npm run test:integration
npm run test:accessibility
npm run test:e2e
npm audit --omit=dev --audit-level=high
```

## Build outputs

Renderer and Electron JavaScript only:

```powershell
npm run build
```

Unpacked x64 application:

```powershell
npm run package:dir
```

Configured installer, portable build, unpacked directory, and release metadata:

```powershell
npm run package
```

For version 0.2.0, Electron Builder is configured to emit:

- `release\Markora-0.2.0-Setup-x64.exe`
- `release\Markora-0.2.0-Portable-x64.exe`
- `release\win-unpacked\Markora.exe`

The release finalizer requires those non-empty artifacts and
`docs\RELEASE_NOTES_0.2.0.md`, copies the notes into `release`, and creates:

- `release\SHA256SUMS-<version>.txt`
- `release\release-manifest-<version>.json`
- `release\Markora-0.2.0-Release-Notes.md`
- `release\verify-clean-install.ps1`
- `release\CLEAN_VM_TEST_PLAN.md`

The verification script and clean-VM plan are copied into the release directory and included in the
versioned manifest/checksum records. The manifest records platform, architecture, byte lengths, SHA-256 hashes, and
that the current artifacts are unsigned. Exact emitted paths/hashes must come from the actual packaging
run.

`npm run make`, `npm run dist`, and `npm run package` currently run the same packaging path.

## Installer configuration

The NSIS target is an assisted x64 installer that allows changing the installation directory and is
configured for Start Menu and desktop shortcuts while preserving application data on uninstall. Builder
registers `.md` and `.markdown` as editor associations for `Markora.Markdown`.

Configuration is not verification. The following must be checked in the installed application:

- fresh install and ordinary launch;
- Start Menu shortcut and desktop-shortcut behavior;
- `.md` and `.markdown` association/Open With behavior;
- command-line one/multiple-file opening and single-instance forwarding;
- File Explorer drag/drop;
- upgrade from the prior installer with settings retained;
- uninstall, preserved settings policy, and reinstall.

## Clean-machine validation

Follow `CLEAN_VM_TEST_PLAN.md` in a real Windows Sandbox or clean Windows virtual machine.
`scripts/Markora-Clean-Test.wsb` provides a network-disabled Sandbox mapping of the release directory;
review its host path before launch. Retain the exact OS build, installer hash, installation choices,
screenshots/logs, and result for every check.

The verifier accepts `-UpgradeFrom <prior-installer> -ExerciseLifecycle -LaunchSmokeTest` to automate the
current-user prior install, in-place upgrade, settings hash, shortcuts/associations, unpacked/portable/
installed launch, uninstall, and reinstall checks. These switches mutate the current user's installation
state and must be used only on the intended test machine. Reboot and visual checks remain manual.

The development-host 0.1.0-to-0.2.0 current-user upgrade and lifecycle matrix passed: both versions
launched, the settings file hash was preserved, Start Menu and redirected Desktop shortcuts and both file
associations passed, and the final installer survived uninstall/reinstall and launched with multiple files.
No clean Windows VM/Windows Sandbox validation was performed. `scripts/verify-clean-install.ps1` can
automate only what its final source actually checks; running it on the development machine is not a
clean-machine test.

## Signing

Development artifacts are unsigned. A production release should configure Authenticode signing in the
Builder environment, verify the signature and timestamp on every executable, and rerun install/upgrade
tests with the signed artifacts. Do not publish a manifest that claims `signed: true` unless signature
verification actually passed.
