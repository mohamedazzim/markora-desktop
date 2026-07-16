# Clean Windows verification plan

Status: **Not performed for Markora 0.2.0 as of 2026-07-15.** This is an executable test plan, not evidence of a clean-machine result. Record every result and attach screenshots/logs before changing that status.

## Test matrix and evidence

Run the matrix once in Windows Sandbox and once in a persistent Windows 11 VM for the upgrade test. Record:

- Windows edition, version, OS build, locale, display scaling, and x64 architecture.
- Hypervisor/Sandbox version and snapshot identifier.
- Markora version, Electron version, artifact SHA-256 values, and Authenticode status.
- Pass/fail/not-tested for each numbered step, with screenshot or log path and tester/date.
- Exact unexpected dialogs, Event Viewer entries, crash dumps, and reproduction steps.

Windows Sandbox is clean on every launch and is suitable for fresh install, uninstall, and portable tests. A persistent VM snapshot is required to prove a real 0.1.0-to-0.2.0 upgrade across reboots.

## 1. Build and verify on the host

Open 64-bit PowerShell in the repository and run:

```powershell
Set-Location C:\Markdown_Project
npm ci
npm run doctor
npm run verify
npm run make
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-clean-install.ps1 -Mode Artifacts
```

All commands must exit `0`. Confirm these files exist:

```text
C:\Markdown_Project\release\Markora-0.2.0-Setup-x64.exe
C:\Markdown_Project\release\Markora-0.2.0-Portable-x64.exe
C:\Markdown_Project\release\win-unpacked\Markora.exe
C:\Markdown_Project\release\SHA256SUMS-<version>.txt
C:\Markdown_Project\release\release-manifest-<version>.json
C:\Markdown_Project\release\verify-clean-install.ps1
```

The development build is unsigned, so signature warnings are expected. Do not use `-RequireSignature` until release signing is configured. Keep the 0.1.0 installer at `C:\Markdown_Project\release\prior\Markora-0.1.0-Setup.exe` for step 9; if that exact prior artifact is unavailable, record upgrade testing as **Not tested**, not passed.

## 2. Start Windows Sandbox

Enable Windows Sandbox from **Turn Windows features on or off**, reboot the host, and double-click:

```text
C:\Markdown_Project\scripts\Markora-Clean-Test.wsb
```

The configuration disables networking and maps only `C:\Markdown_Project\release` read-only as `C:\MarkoraRelease`. If the repository is elsewhere, edit only the `<HostFolder>` value before launch.

Inside Sandbox, open PowerShell and run:

```powershell
Get-ComputerInfo | Select-Object WindowsProductName,WindowsVersion,OsBuildNumber,OsArchitecture
Set-ExecutionPolicy -Scope Process Bypass -Force
& C:\MarkoraRelease\verify-clean-install.ps1 -ReleaseDirectory C:\MarkoraRelease -Mode Artifacts
```

Save the complete output. Independently compare one hash:

```powershell
Get-FileHash C:\MarkoraRelease\Markora-0.2.0-Setup-x64.exe -Algorithm SHA256
Get-Content C:\MarkoraRelease\SHA256SUMS-<version>.txt
```

## 3. Fresh NSIS install and shortcuts

1. Double-click `C:\MarkoraRelease\Markora-0.2.0-Setup-x64.exe`.
2. If SmartScreen appears, record it; use **More info > Run anyway** only after matching SHA-256.
3. Choose the default current-user install and default directory. Do not silently install for this UI pass.
4. Leave **Run Markora** enabled and finish.
5. Confirm Markora opens without a blank window or renderer error.
6. Confirm **Markora** exists in the Start Menu and launches the same installed executable.
7. Confirm `Markora.lnk` exists on the desktop. Then uninstall and reinstall from PowerShell with the supported `--no-desktop-shortcut` flag to verify the desktop-shortcut choice:

```powershell
& "$env:LOCALAPPDATA\Programs\Markora\Uninstall Markora.exe"
Start-Process C:\MarkoraRelease\Markora-0.2.0-Setup-x64.exe -ArgumentList '/S','/currentuser','--no-desktop-shortcut' -Wait
Test-Path "$env:USERPROFILE\Desktop\Markora.lnk"  # expected: False
```

8. Run the installed-state automation:

```powershell
& C:\MarkoraRelease\verify-clean-install.ps1 -ReleaseDirectory C:\MarkoraRelease -Mode Installed
```

## 4. File associations, Open With, and command-line files

Create fixtures:

```powershell
$fixtures = Join-Path $env:USERPROFILE 'Desktop\Markora fixtures'
New-Item $fixtures -ItemType Directory -Force
Set-Content (Join-Path $fixtures 'alpha.md') '# Alpha' -Encoding UTF8
Set-Content (Join-Path $fixtures 'beta.markdown') '# Beta' -Encoding UTF8
Set-Content (Join-Path $fixtures 'नोट.md') '# Unicode' -Encoding UTF8
```

Then verify:

1. Double-click `alpha.md`; it opens in Markora at the correct file path.
2. Right-click `beta.markdown` > **Open with**; Markora is listed and opens it.
3. With Markora running, double-click `नोट.md`; the existing instance focuses and adds one tab.
4. Run multiple arguments and verify both tabs appear, without a second long-lived process:

```powershell
& "$env:LOCALAPPDATA\Programs\Markora\Markora.exe" (Join-Path $fixtures 'alpha.md') (Join-Path $fixtures 'beta.markdown')
Get-Process Markora
```

5. Run a relative path from its directory and verify it resolves correctly:

```powershell
Push-Location $fixtures
& "$env:LOCALAPPDATA\Programs\Markora\Markora.exe" '.\alpha.md'
Pop-Location
```

6. Pass `image.png`, a missing `.md`, and an HTTP URL; none may be opened or granted file authority.

## 5. Core installed-application smoke test

In the installed app:

1. Create, edit, save, close, and reopen a Markdown file.
2. Switch Structured > Source > Structured and verify content remains semantic-equivalent.
3. Insert/modify a table, math block, Mermaid block, and local image.
4. Paste a clipboard image and drag an image and Markdown file from File Explorer.
5. Open a workspace and search/replace only after preview and explicit confirmation.
6. Exercise command palette, shortcut change/conflict, Focus, Typewriter, Zen, and themes.
7. Export HTML and PDF; open both outputs and inspect Unicode, table, image, KaTeX, and Mermaid content.
8. Force an external edit and resolve with reload, keep, compare, save copy, and confirmed overwrite paths.
9. Close with unsaved content, relaunch, and verify recovery/session behavior.

Record each item separately. A single successful launch is not sufficient.

## 6. Drag/drop and single-instance forwarding

1. Drag `alpha.md` from File Explorer onto the app and confirm it opens once.
2. Drag `alpha.md` and `beta.markdown` together and confirm two tabs.
3. Drag an image into Source and Structured modes; verify the selected asset destination and relative reference.
4. Start Markora from Start Menu, then invoke the executable with both Markdown arguments. Task Manager must show only one application instance and the original window must focus.

## 7. Portable and unpacked applications

Run each independently with a dedicated profile so they cannot reuse installer state:

```powershell
Start-Process C:\MarkoraRelease\Markora-0.2.0-Portable-x64.exe -ArgumentList "--user-data-dir=$env:TEMP\MarkoraPortable",(Join-Path $fixtures 'alpha.md')
Start-Process C:\MarkoraRelease\win-unpacked\Markora.exe -ArgumentList "--user-data-dir=$env:TEMP\MarkoraUnpacked",(Join-Path $fixtures 'beta.markdown')
```

Verify each opens the requested file, saves, exports, exits, and relaunches. Neither may depend on the installed executable. Run the automated unpacked launch check only after closing all Markora processes:

```powershell
& C:\MarkoraRelease\verify-clean-install.ps1 -ReleaseDirectory C:\MarkoraRelease -Mode Unpacked -LaunchSmokeTest
```

## 8. Uninstall and reinstall

1. In Apps > Installed apps, uninstall Markora.
2. Confirm the program directory, Start Menu shortcut, desktop shortcut, and `.md`/`.markdown` Markora class registrations are removed.
3. Confirm the user-data directory remains, because `deleteAppDataOnUninstall` is deliberately false.
4. Reinstall 0.2.0 and verify retained settings/recovery are offered correctly.
5. Uninstall again. Only after recording evidence, remove test user data manually.

Never delete a real user's application data as part of automated verification.

## 9. Upgrade from 0.1.0 in a persistent clean VM

Before the manual reboot checks, run the automated installed lifecycle subset from an elevated-free,
current-user PowerShell session:

```powershell
& C:\MarkoraRelease\verify-clean-install.ps1 `
  -ReleaseDirectory C:\MarkoraRelease `
  -Mode All `
  -UpgradeFrom C:\MarkoraRelease\prior\Markora-0.1.0-Setup.exe `
  -ExerciseLifecycle `
  -LaunchSmokeTest
```

This installs the prior release, launch-smokes it, upgrades in place, verifies the installed version and
byte-for-byte settings preservation, checks shortcuts and associations, launch-smokes the upgraded app,
then uninstalls and reinstalls 0.2.0. It does not replace the reboot/manual document checks below.

1. Revert a persistent x64 Windows 11 VM to a clean snapshot and disconnect networking.
2. Copy the verified 0.1.0 and 0.2.0 installers into the VM.
3. Install 0.1.0 with default options; record its installed version and paths.
4. Create two documents, change theme/editor settings, create a shortcut preference, and close normally.
5. Reboot and reopen 0.1.0 to prove the baseline persisted.
6. Run `Markora-0.2.0-Setup-x64.exe` over the same install scope/path. Do not uninstall first.
7. Confirm Apps reports 0.2.0, only one uninstall entry exists, and shortcuts/file associations target the 0.2.0 executable.
8. Open both baseline documents and confirm user settings survived. Exercise save and export.
9. Reboot, repeat the checks, uninstall 0.2.0, and confirm user documents/settings were not deleted.
10. Reinstall 0.2.0 and confirm launch and file associations again.

Record the old installer SHA-256. If the precise previously released installer was not available, mark this entire phase **Not tested**.

## 10. Completion record

Create a dated result under `test-results/windows-clean/` containing the matrix, logs, hashes, screenshots, and failures. Update the release manifest/report only after the run. Use exactly one overall conclusion: **Passed**, **Failed**, or **Not performed**. Any skipped required step makes the conclusion **Not performed** or **Failed**, never Passed.
