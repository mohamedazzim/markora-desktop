# Testing

Markora separates fast logic/component tests, Node integration tests, accessibility checks, generated
performance benchmarks, and real-Electron end-to-end flows.

## Final automated baseline

The release-state run on 2026-07-15 produced:

| Project           |               Result |
| ----------------- | -------------------: |
| Unit              |           623 passed |
| Integration       |            42 passed |
| Real-Electron E2E | 36 passed, 0 skipped |
| Accessibility     |            39 passed |
| Performance       |            14 passed |

Machine-readable E2E and performance evidence is retained under `test-results/`. These counts describe
the recorded source state; any subsequent code change requires rerunning the affected suite.

## Unit tests

```powershell
npm run test:unit
```

The default Vitest project uses JSDOM and includes `tests/unit/**/*.test.{ts,tsx}`. It covers:

- parser, serializer, stable semantic round trips, front matter, tables, escaped pipes, math, Mermaid,
  links/references, footnotes, images/raw HTML, anchors, Unicode, line endings, and statistics;
- canonical state, history, view snapshots, dirty state, save tickets, large-document policy;
- document search/replace/history and workspace search/globs/preview/replacement logic;
- commands, native-menu template/allowlist, palette, shortcuts, settings migration, themes, appearance,
  custom CSS, navigation;
- image syntax, asset paths/copies/downloads, path authority, and IPC contracts;
- Pandoc detection/version/arguments/spawn errors/cancellation and dialog behavior;
- spell-check policy;
- checked atomic writes, recovery store/service/controller/IPC/dialogs; and
- HTML/PDF options, sanitization, composition, IPC, dialogs, and presets.

## Integration tests

```powershell
npm run test:integration
```

The Node integration configuration includes `tests/integration/**/*.test.ts`. It exercises canonical
source/structured/save/reopen journeys, preload recovery calls/events, native-menu event validation,
checked filesystem and recovery paths, and HTML/PDF export boundaries/fixtures. Tests use temporary
directories and mocks where Electron UI is not the subject.

## Accessibility tests

```powershell
npm run test:accessibility
```

This dedicated JSDOM project runs axe-core WCAG A/AA component scans, deterministic WCAG contrast checks
for built-in tokens, and keyboard/focus tests. JSDOM cannot paint pixels or exercise Windows native menus,
so the real Electron axe flow and manual Narrator/NVDA/Windows Contrast/reflow plan remain necessary.
See `ACCESSIBILITY_REPORT.md`.

## Performance tests

```powershell
npm run test:performance
```

The performance project uses generated 1/5/10 MiB documents, large workspaces, heading/image/Mermaid/tab
fixtures, repeated lifecycle work, search, conversion policy, typing, and export scenarios. It runs
serially with extended timeouts. Files above 2 MiB should report the Source-Mode/deferred structured policy
rather than attempting an unsafe structured materialization. Machine, runtime, fixture shape, warm-up,
and failed/deferred cases must be recorded with the measurements in `PERFORMANCE_REPORT.md`.

## Electron Playwright E2E

```powershell
npm run test:e2e
```

The script first compiles Electron and then runs Playwright with one worker. The fixture launches the
actual project Electron binary through Playwright's `_electron` support, uses isolated temporary user-data
and workspace directories, and installs deterministic native-dialog plans in the main process. It is not
a renderer-only browser test.

The suite defines flows for development launch, create/edit/mode switch/save/reopen, tables, math,
Mermaid, picker/paste/drop images, workspace open/search/replacement, palette/shortcuts, writing modes, theme,
HTML/PDF export, recovery, external modifications/conflicts, session relaunch, command-line files, and an
axe scan. A focused real-Electron smoke test also invokes `file.new` from the installed native application
menu and observes the renderer action. The final run passed all 36 flows with no skips, including recovery,
session relaunch, multiple-file CLI, second-instance forwarding, menu bridge, Chromium PDF, and rendered
axe-core coverage.

Playwright writes its HTML report to `playwright-report/` and JSON/artifacts to `test-results/`.

## Static and build verification

```powershell
npm run typecheck
npm run lint
npm run build
npm run verify
npm audit --omit=dev --audit-level=high
```

`verify` combines typecheck, lint, unit, integration, accessibility, performance, and the production
build. It deliberately does not nest the interactive real-Electron E2E, package/install, or dependency
audit commands, so release verification must run those explicitly.

## Development launch checks

`npm start` and `npm run dev` are interactive, long-running commands. Verification means observing the
real development window become responsive and confirming the executable is the local Electron dependency,
then intentionally stopping it. A timeout/intentional termination should be reported as such rather than
as an unexplained failure.

## Windows release checks

Repository automation cannot prove clean-machine installation. After packaging, follow
`CLEAN_VM_TEST_PLAN.md` in a real Windows Sandbox or clean VM and retain installer logs/screenshots and
artifact hashes. Do not mark clean-VM or upgrade checks passed because `npm run package` succeeded.

For 0.2.0, the separate development-host verifier did pass the real current-user 0.1.0-to-0.2.0 upgrade,
settings hash, shortcuts/associations, unpacked/portable/installed launch, uninstall, and reinstall
matrix. The clean-machine row remains untested.
