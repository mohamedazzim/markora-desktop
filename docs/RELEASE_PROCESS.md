# Release process

## 1. Prepare the version

1. Choose the version according to the actual compatibility/feature change.
2. Update `package.json` and the lockfile together.
3. Add `docs/RELEASE_NOTES_<version>.md` and update `CHANGELOG.md`.
4. Review `FEATURE_MATRIX.md`, `KNOWN_LIMITATIONS.md`, privacy/security notes, and all user-visible docs
   against source rather than intent.

Do not reuse 0.1.0 for a major development increment.

## 2. Clean verification

From a clean dependency tree, run and retain summaries for every command:

```powershell
npm ci
npm run doctor
npm start
npm run dev
npm run typecheck
npm run lint
npm run test
npm run test:unit
npm run test:integration
npm run test:accessibility
npm run test:performance
npm run test:e2e
npm run build
npm run verify
npm audit --omit=dev --audit-level=high
```

For `start` and `dev`, observe a responsive development window launched from the local Electron dependency,
then stop it intentionally. Record skipped/fixme tests and failed/deferred benchmark scenarios explicitly.

When Pandoc is installed, perform one real import and export smoke test. When absent, report that check as
Blocked; mocked tests do not turn it into a pass.

## 3. Package once after feature verification

```powershell
npm run package:dir
npm run package
npm run make
```

If `make` is an alias of `package`, state that the same path was rerun rather than implying a distinct
packager. Confirm the NSIS installer, portable executable, unpacked application, versioned release notes,
copied clean-install verifier/VM plan, SHA-256 file, and release manifest are non-empty and match the
version.

Launch the unpacked executable manually and record its path/result. Do not modify development scripts to
use it.

## 4. Sign production artifacts

Configure and apply Authenticode signing, verify the certificate chain/timestamp on installer, portable,
and installed executables, and update release metadata only after verification. Current 0.2.0 development
artifacts are unsigned.

## 5. Clean Windows and upgrade matrix

Use `CLEAN_VM_TEST_PLAN.md` in a real Windows Sandbox/clean VM. The repository includes
`scripts/Markora-Clean-Test.wsb` for a network-disabled read-only release mapping and
`scripts/verify-clean-install.ps1` for artifact/installed-state checks. Test:

- fresh install and shortcuts;
- `.md`/`.markdown`, Open With, one/multiple CLI files, and single-instance forwarding;
- Explorer drag/drop;
- installed launch, close, restart, and session/recovery behavior;
- upgrade from the exact prior installer with user settings/documents retained;
- uninstall, documented application-data retention, and reinstall.

Save the OS build, installer/hash, settings, logs/screenshots, and pass/fail for each step. Preparing the
plan, running a script outside a clean environment, or launching an unpacked executable is not clean-VM
validation.

For the automated installed subset, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-clean-install.ps1 `
  -Mode All -UpgradeFrom release\prior\Markora-0.1.0-Setup.exe `
  -ExerciseLifecycle -LaunchSmokeTest
```

## 6. Publish

Review the production dependency audit and third-party licenses. Attach only the verified artifacts,
checksums, manifest, release notes, known limitations, and test reports. Ensure public release text clearly
states signing, Pandoc, accessibility, PDF visual, performance, clean-VM, and upgrade status.

If any required completion criterion remains open, publish only as a development/pre-release artifact and
do not describe the implementation phase as complete.
