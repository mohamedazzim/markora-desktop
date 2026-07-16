# Development setup

## Supported environment

- Windows 10 or Windows 11 x64
- Node.js 22, 23, or 24 (Node.js 22 LTS or 24 recommended)
- npm 10 or newer
- PowerShell 5.1 or newer
- Git for source-control workflows
- Optional: Pandoc for real import/export smoke tests

The repository currently uses Electron 43.1.0. Do not develop against a globally installed Electron or
point a development script at a packaged Markora executable.

## Reproducible installation

From the repository root:

```powershell
npm ci
npm run doctor
```

`npm ci` uses `package-lock.json`, removes any existing dependency tree, installs exactly the locked
versions, and runs the project postinstall that installs/verifies Electron. Do not run concurrent npm
install/rebuild processes against the same `node_modules` directory.

The doctor checks Node/npm versions, dependency-tree/lock consistency, Electron package and executable,
Electron launchability, TypeScript/Vite/Builder tools, production native add-ons, optional Pandoc,
application-data writability, required directories, and Windows/process architecture. A Pandoc warning
is expected when optional conversion is not needed.

## Launching development

```powershell
npm start
```

`npm start` is an alias for the complete `npm run dev` pipeline. The pipeline:

1. compiles the Electron main/preload TypeScript;
2. starts the Vite renderer server;
3. starts the Electron TypeScript watcher;
4. waits for the renderer port; and
5. starts `node_modules/electron/cli.js`.

Use this when generated Electron output may be stale:

```powershell
npm run dev:clean
```

Use `Ctrl+C` once to stop the concurrently managed development processes.

## Verification commands

```powershell
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run test:accessibility
npm run test:performance
npm run test:e2e
npm run build
npm run verify
npm audit --omit=dev --audit-level=high
```

Notes:

- `test:unit` is the default Vitest JSDOM unit project.
- `test:integration` uses the Node integration configuration.
- `test:accessibility` runs axe/component, contrast, and keyboard/focus checks.
- `test:performance` generates measured local fixtures; results are machine-specific.
- `test:e2e` compiles Electron and launches the real local Electron executable with Playwright. It is
  not a renderer-only browser test.
- `verify` includes typecheck, lint, unit, integration, accessibility, performance, and build. Run E2E,
  packaging/install, and the production dependency audit explicitly for a release candidate.

## Optional Pandoc smoke test

Install Pandoc from its official Windows distribution or select an existing `pandoc.exe` in Markora.
Run `npm run doctor` to confirm discovery, then perform one import and one export in the application.
Mock-executable tests are not a substitute for this smoke test. If Pandoc is absent, record the real test
as Blocked rather than passed.

## Packaging

```powershell
npm run package:dir
npm run package
```

`package:dir` creates the unpacked application. `package` builds NSIS and portable targets and then runs
release finalization. The finalizer requires `docs/RELEASE_NOTES_<version>.md` and all configured
artifacts, then emits checksums and a manifest.

See `WINDOWS_BUILD.md` and `CLEAN_VM_TEST_PLAN.md` before publishing. Packaging on the development
machine does not prove installation, file associations, upgrade behavior, or clean-machine operation.

## Dependency changes

When changing dependencies:

1. update `package.json` and `package-lock.json` in the same change;
2. run the install serially;
3. run `npm ci` from a clean dependency tree;
4. run `npm run doctor` and the complete test matrix; and
5. rerun Electron packaging when Electron, native dependencies, or Builder changes.

Production dependencies currently have no expected native Node add-on requiring an Electron ABI rebuild.
If the doctor finds one later, run Electron Rebuild and exercise the native path in Electron.
