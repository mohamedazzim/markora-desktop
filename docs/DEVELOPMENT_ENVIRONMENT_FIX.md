# Development environment fix

## Symptom

`npm start` failed with `Electron failed to install correctly`. The npm package metadata existed under
`node_modules/electron`, but `path.txt`, `dist/version`, and `dist/electron.exe` were absent. Packaged
builds happened to launch, but that did not provide a valid local development environment.

## Root cause

The Electron 35 download in the local cache was valid: its SHA-256 matched the published checksum.
Extraction had been interrupted after its first entry, leaving a partially installed package directory.
Because the old project installation path did not perform an explicit project-level Electron binary
verification, npm could finish with metadata present and no runnable binary.

The investigation also checked the dependency declaration and lockfile, Electron dependency placement,
Builder/Vite configuration, development scripts, npm registry/proxy configuration, relevant environment
variables, cache contents, filesystem permissions, available disk space, Windows x64 architecture, and
Node/Electron compatibility. None of those was the underlying missing-file cause. Antivirus quarantine
was not evidenced; if a future security product removes `electron.exe`, its logs/quarantine should be
reviewed rather than adding a packaged-executable workaround.

## Fix

- Electron is a locked development dependency and was upgraded to Electron 43.1.0, compatible with the
  project's Node 22-24 development range.
- Project `postinstall` runs the installed Electron installer/verification script during `npm ci`.
- `npm start` delegates to `npm run dev`.
- `npm run dev` compiles Electron TypeScript, starts Vite and the Electron TypeScript watcher, waits for
  the renderer, and launches the project's installed Electron CLI.
- `npm run dev:clean` removes generated Electron output before starting the same local pipeline.
- `scripts/doctor.ps1` diagnoses versions, lock/install consistency, package/binary presence, executable
  launch, native modules, build tools, optional Pandoc, writable application-data paths, architecture,
  and required directories with targeted remediation messages.

Development scripts do not reference a packaged Markora executable.

## Verified reproduction

The repaired environment was established with:

```powershell
npm ci
npm run doctor
npm start
```

`npm start` and `npm run dev` were each observed launching the responsive development application through
`node_modules\electron\dist\electron.exe`; each was then intentionally stopped. Final release reporting
must still include the command result from the final clean verification run.

For a generated-output reset:

```powershell
npm run dev:clean
```

## Repairing a future missing binary

First stop every npm, Electron, Vite, and TypeScript watcher using this workspace. Dependency-changing
npm processes must not overlap because they can race on `node_modules`.

```powershell
npm rebuild electron --foreground-scripts
npm run doctor
```

If the dependency tree or lock consistency check also fails, use:

```powershell
npm ci --foreground-scripts
npm run doctor
```

If Electron download fails rather than extraction, inspect `ELECTRON_MIRROR`, `ELECTRON_CUSTOM_DIR`,
`HTTPS_PROXY`, `HTTP_PROXY`, npm `proxy`/`https-proxy`, npm registry settings, certificate interception,
and the Electron download cache before deleting caches. The doctor message and npm foreground-script
output should be retained with the issue.
