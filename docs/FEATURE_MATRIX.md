# Feature matrix

Status meanings:

- **Complete**: the scoped feature is implemented and its required automated verification is present.
- **Partial**: useful implementation or verification exists, but a required path remains open.
- **Not implemented**: no working implementation is present.
- **Blocked**: verification cannot run until a named external dependency/environment exists.
- **Tested**: the stated verification ran or is covered by focused automated tests.
- **Untested**: the required verification has not been performed.

No row is marked Complete when its required implementation and verification are both not satisfied.

| Area                                                         | Overall status  | Verification status | Evidence or remaining condition                                                                                        |
| ------------------------------------------------------------ | --------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Local Electron development (`npm start`, `dev`, `dev:clean`) | Complete        | Tested              | Uses installed Electron; launch observed in repaired environment                                                       |
| Windows doctor diagnostics                                   | Complete        | Tested              | Version, lock, Electron binary/run, tools, native add-ons, Pandoc, app-data, architecture                              |
| Secure Electron/preload boundary                             | Complete        | Tested              | Sandboxed/context-isolated window, typed bridge, IPC/path tests                                                        |
| Canonical document and save-ticket model                     | Complete        | Tested              | Unit and integration journeys, dirty/stale save/history/view-state tests                                               |
| Source/Structured synchronization                            | Complete        | Tested              | Fixture journeys include edit, switch, save, and reopen                                                                |
| Markdown semantic round trips                                | Complete        | Tested              | Ten core fixture families plus edge-case suites                                                                        |
| Structured rich controls for every preserved syntax          | Partial         | Tested              | References, footnotes, inline math, and raw HTML lack dedicated rich managers                                          |
| Documents over 2 MiB                                         | Partial         | Tested              | Fully editable in Source Mode; Structured Mode intentionally blocked                                                   |
| GFM visual table editing                                     | Complete        | Tested              | Parser/operations/component/E2E coverage                                                                               |
| KaTeX and Mermaid previews                                   | Complete        | Tested              | Mermaid strict mode; math/diagram unit and E2E paths                                                                   |
| Image insertion and asset management                         | Complete        | Tested              | Picker, paste, drop, URL, destinations, conflicts, paths, remote errors, actions                                       |
| Optional Pandoc integration                                  | Partial         | Blocked             | Mocked detection/spawn/import/export tests; no real Pandoc installed for smoke conversion                              |
| Spell-check policy and settings                              | Complete        | Tested              | Validation/persistence and renderer integration tests                                                                  |
| Native misspelling underline/context menu                    | Partial         | Untested            | Requires manual Windows dictionary/context-menu verification                                                           |
| Current-document search and replace                          | Complete        | Tested              | All options, canonical selection scope, mode switching, navigation, history, highlights, and replacement paths         |
| Workspace search and replace                                 | Complete        | Tested              | Worker, globs, `.gitignore`, cancellation, preview/selection/confirmation/backups/results                              |
| Central command registry and palette                         | Complete        | Tested              | Shell, Structured/table controls, palette, toolbar, and shortcut paths share handlers                                  |
| Native application menu command bridge                       | Complete        | Tested              | Shared ID allowlist, preload rejection, no duplicate accelerators, packaged dev-role exclusion, real-Electron dispatch |
| Configurable shortcuts and chords                            | Complete        | Tested              | Record/conflict/reset/import/export/version persistence and E2E dispatch                                               |
| Focus, Typewriter, and Zen modes                             | Complete        | Tested              | Persisted settings, renderer behavior, command/E2E tests                                                               |
| Themes, typography, Theme Gallery, and safe custom CSS        | Complete        | Tested              | Nine families, independent document theme, custom package IPC/gallery, sanitizer and E2E tests                      |
| HTML export                                                  | Complete        | Tested              | Rich fixture, sanitizer, IPC, dialog and real-Electron export coverage                                                 |
| PDF export controls and generated file                       | Complete        | Tested              | Composition/IPC/dialog/preset tests and real Chromium PDF E2E                                                          |
| PDF visual fidelity, bookmarks, tagging, internal links      | Partial         | Untested            | Requires manual artifact validation across representative release fixtures                                             |
| Atomic writes, backup, failure classification                | Complete        | Tested              | Temporary-directory unit/integration coverage                                                                          |
| Recovery snapshots and external conflicts                    | Complete        | Tested              | Checked service, recovery center, comparison/actions, and real-Electron flows                                          |
| Shared dialogs and conflict compare view                      | Complete        | Tested              | Portal/focus/inert primitive, timestamp metadata, bounded unified and side-by-side diff tests                         |
| Session restoration                                          | Complete        | Tested              | Persisted session/snapshots and real-Electron relaunch/restore flow                                                    |
| Accessibility implementation and automated gate              | Complete        | Tested              | Axe components, token contrast, keyboard/focus tests and Electron axe path                                             |
| Narrator/NVDA/Windows Contrast/200% scaling                  | Partial         | Untested            | Manual release-candidate matrix not performed                                                                          |
| Performance fixture/benchmark project                        | Complete        | Tested              | 14/14 performance tests passed; actual measurements are in `PERFORMANCE_REPORT.md`                                     |
| Real-Electron Playwright suite                               | Complete        | Tested              | 36/36 tests passed against the real Electron executable with no skips                                                  |
| Command-line file opening                                    | Complete        | Tested              | Validated existing Markdown operands and real-Electron multiple-file startup                                           |
| Single-instance forwarding/focus                             | Complete        | Tested              | E2E starts a second Electron process and verifies forwarding to the responsive primary                                 |
| NSIS, portable, and unpacked x64 targets                     | Complete        | Tested              | Builder configuration and release-tool tests; artifact results reported separately                                     |
| Fresh install and installed-app smoke                        | Complete        | Tested              | Current-user install/uninstall/reinstall and multi-file launch passed on the development host                          |
| Upgrade from 0.1.0 with settings preserved                   | Complete        | Tested              | Real prior installer upgraded to 0.2.0; settings hash, shortcuts, associations, and launch passed                      |
| Clean Windows VM/Windows Sandbox validation                  | Blocked         | Untested            | Plan exists; no real clean-machine session performed                                                                   |
| Code signing and update feed                                 | Not implemented | Untested            | Development artifacts are unsigned; no updater is configured                                                           |
