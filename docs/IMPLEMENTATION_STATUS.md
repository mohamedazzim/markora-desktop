# Implementation status

Status date: 2026-07-15  
Version: 0.2.0 development release

## Summary

The requested 0.2.0 implementation is substantially present in working source: reproducible local Electron
development, canonical two-mode editing, production image workflows, optional Pandoc, spell checking,
document/workspace replacement, commands/shortcuts, writing modes/themes, rendered HTML/PDF export,
checked recovery services, accessibility automation, performance fixtures, real-Electron E2E definitions,
and Windows packaging targets.

The current automated baseline passes 625 unit, 42 integration, 36 real-Electron E2E, 39 accessibility,
and 14 performance tests. The development-host installed upgrade matrix passed, but the phase must not be
called fully complete until clean-machine, real-Pandoc, and explicitly manual verification paths are
closed. The feature matrix is the authoritative concise status table.

## Phase status

### Phase 1 - development environment

Complete and tested. The interrupted Electron extraction was diagnosed; Electron 43.1.0, project
postinstall verification, local development scripts, `dev:clean`, and `doctor` are present. Both `start`
and `dev` were observed launching the local development Electron binary. Rerun after final `npm ci` for the
release record.

The final UI audit also covers the Lucide workspace tree, opaque shared dialogs, and the dedicated
Markora White document surface. Screenshot evidence is recorded in `docs/UI_FIX_AUDIT.md`.

### Phase 2 - canonical editor and Markdown round trips

Complete for the supported Markdown contract and tested with source/structured/save/reopen fixtures,
history/view state, Unicode, empty files, line endings, front matter, fences, raw HTML, tables, reference
links, and footnotes. Structured Mode is intentionally unavailable above 2 MiB, and some preserved syntax
lacks a specialized rich control.

### Phase 3 - images

Complete and tested across syntax utilities, main-process assets/IPC, renderer dialog/workflows, and real
Electron picker/paste/drop flows. Clipboard, drag/drop, picker, URL, asset strategies, conflict/path handling,
remote failure, and image actions have implementation paths. Destination prerequisites remain deliberate
validation, not missing behavior.

### Phase 4 - Pandoc and spell checking

Pandoc implementation and mocked tests are present, but overall status is Partial/Blocked because no real
Pandoc installation was available for an actual import/export smoke test. Spell-check configuration,
language override, dictionary, and native context-menu implementation are present; a manual Windows
underline/suggestion/language pass remains open.

### Phase 5 - search, commands, shortcuts

Search/replace, the baseline command palette, and shortcut manager are tested. Current-document and
background workspace replacement include their specified modes, navigation, preview, selection,
confirmation, cancellation, backup, and failure paths. Registry metadata, palette navigation, shortcut
recording/conflicts/reset/import/export/versioning/chords, and shared handlers for all visible
Structured/table controls are covered. The explicit native menu uses a validated preload event bridge,
omits native accelerators for configurable commands, and excludes reload/developer tools when packaged.
Structured Mode maps its captured selection and visible matches back to deterministic canonical Markdown
offsets, so selection-scoped search remains predictable across mode switches.

### Phase 6 - writing modes and themes

Complete and tested in unit/component and real Electron flows. Settings are versioned and persisted. The
shared Dialog primitive now owns portal stacking, inert background handling, Escape handling, focus trapping,
and focus restoration. Conflict resolution uses the same surface with timestamp metadata, bounded unified
diffing, and aligned side-by-side comparison. The Theme Gallery supports independent interface/document
selections and global, validated custom theme packages. Custom CSS is scoped and allowlisted. High-contrast
and reduced-motion implementation exists, while manual Windows presentation checks remain accessibility
verification work.

### Phase 7 - HTML and PDF export

HTML export is Complete and tested with rich fixtures, sanitizer, dialog, IPC, and real-Electron output.
PDF export controls and real Chromium file creation are Complete and tested. The broader PDF area remains
Partial until bookmarks/tagging/internal-link fidelity and representative visual fixtures are manually
inspected in release artifacts.

### Phase 8 - recovery, accessibility, performance

Recovery services, controller, recovery center, conflict dialog/actions, shell wiring, autosave/session
persistence, and focused real-Electron recovery/relaunch flows are Complete and tested. Accessibility
implementation and its 39-test automated gate are present, but no Narrator/NVDA/Windows Contrast/200%
scaling pass occurred. The 14 performance tests produced the actual measurements in
`PERFORMANCE_REPORT.md`; >2 MiB structured conversion is deliberately deferred to Source Mode.

### Phase 9 - automated testing

The current automated baseline passes **625 unit**, **42 integration**, **39 accessibility**, **14
performance**, and **36 real-Electron Playwright** tests. The E2E run had no failures, skips, or fixmes and
includes recovery/session restoration, multiple-file startup, Chromium PDF output, rendered axe-core,
native-menu dispatch, and a second Electron process forwarding a Markdown file to the responsive primary.

### Phase 10 - Windows release and documentation

Version 0.2.0, NSIS/portable/unpacked targets, file associations, versioned notes, SHA-256/manifest tooling,
and release documentation are present. The real development-host current-user install, 0.1.0-to-0.2.0
upgrade, settings hash, shortcuts/associations, unpacked/portable/installed launch, uninstall, and reinstall
matrix passed. No real clean Windows VM/Windows Sandbox validation, code signing, or update feed is complete.

## Blocking completion conditions

- Run and report every required npm command from the same final source state.
- Run a real Pandoc import/export smoke test when Pandoc is available; otherwise retain Blocked status.
- Inspect representative PDF output manually for the Chromium-dependent properties.
- Perform the clean Windows plan in a real clean environment.
- Perform the manual accessibility matrix.

Until those conditions are met, describe Markora 0.2.0 as a development release and do not state that all
completion criteria are verified.
