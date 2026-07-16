# Link dialog fix audit

## Reproduction

1. Start Markora in the development build.
2. Open a Markdown document and switch to Structured mode.
3. Select text and choose **Link** (or use the link command).
4. Observe the Edit link dialog in a dark application theme, then repeat with a
   light or white document theme.

Before this fix, the dialog surface could be transparent or washed out, with
low-contrast labels, URL text, placeholder text, and actions. The same failure
mode was visible in other portal-mounted dialogs when they used the legacy
surface variables.

## Root cause

`Dialog` renders its portal directly under `document.body`, while application
theme variables were previously assigned as inline styles on the `.app` main
element. A portal therefore had no active `--surface`, `--ink`, `--muted`,
`--line`, or `--accent` values. `TextInputDialog` also used the old broad
`.table-dialog` rules, which had no modal-specific fallbacks. The missing
variables caused browser defaults and inherited document styles to determine
the visual result. The old overlay compounded the problem with 72% opacity,
8px blur, and saturation filtering.

The document theme and custom Markdown CSS were not the intended source of
truth for application controls, but the unscoped portal made that boundary
fragile.

## Shared modal changes

- `Dialog` remains the single portal, stacking, inert-background, Escape, and
  focus-trap implementation.
- Application-only appearance variables are mirrored onto `document.body` for
  the lifetime of the mounted renderer. Document variables are deliberately
  excluded.
- `dialog.css` now uses an opaque, token-driven surface, a restrained overlay,
  explicit input and focus styles, responsive sizing, reduced-motion behavior,
  and forced-colors support.
- Table and text-input dialogs use the shared form/action classes instead of
  the legacy broad selectors.

## Link dialog behavior

The link action preserves existing relative paths, heading anchors, email
addresses, and local links. New links keep the existing `https://` suggestion.
Destinations are trimmed and validated without rewriting the user value;
`javascript:`, `data:`, `vbscript:`, control characters, malformed web URLs,
and unknown URI schemes are rejected. Empty values remain supported for link
removal. The input receives initial focus, Enter submits, Escape closes, and
focus is restored by the shared Dialog component.

## Components and themes affected

The affected shared components are `Dialog`, `TextInputDialog`, and
`TableInsertDialog`; all other Dialog consumers benefit from the portal token
fix and the new overlay. The regression was most visible in dark, Midnight,
Classic White, Paper, and High Contrast combinations, but the missing portal
inheritance could affect every application theme. Document-only themes and
custom document CSS must not change modal tokens.

## Files changed

- `src/renderer/components/dialog.css`
- `src/renderer/appearance/themes.ts`
- `src/renderer/main.tsx`
- `src/renderer/editor/TextInputDialog.tsx`
- `src/renderer/editor/TableInsertDialog.tsx`
- `src/renderer/editor/StructuredEditor.tsx`
- `src/renderer/editor-modes.css`
- `tests/unit/text-input-dialog.test.tsx`
- `tests/unit/themes.test.ts`
- `tests/accessibility/renderer-accessibility.test.tsx`
- `tests/e2e/link-dialog.e2e.spec.ts`
- `package.json`

## Regression risks

- Body token cleanup must not remove values owned by another renderer mount.
- Dialog consumers with custom headers still need their labels to reference
  the IDs passed to `Dialog`.
- Legacy dialog CSS may continue to reference application aliases; those
  aliases are intentionally mirrored to the body, while document variables
  remain excluded.
- Focus restoration and `#root.inert` behavior must continue to work when a
  dialog opens from a CodeMirror or ProseMirror control.

## Verification plan

- Unit-test link validation, modal naming, Escape handling, initial focus, and
  application/document token isolation.
- Run the renderer axe suite with the Edit link dialog open.
- Run focused Electron Playwright coverage for new and existing links,
  keyboard-only interaction, and light/dark theme token resolution.
- Capture visual references at desktop and narrow viewports, including
  Classic White, Paper, Sepia, Midnight, and High Contrast.
- Run the complete typecheck, lint, format, unit, integration, accessibility,
  E2E, build, packaging, and audit commands. Results are recorded only after
  the commands actually run.

The focused Electron run currently captures Classic White and Midnight
screenshots under `test-results/visual/dialogs/link/`; these are generated
verification artifacts rather than committed baselines.

## Verification recorded for this fix

- Unit suite: 628 tests passed; the Link dialog component file contains five
  focused tests covering submit, validation, focus, Escape, and removal.
- Renderer accessibility suite: 40 tests passed, including the Edit link
  dialog axe audit (zero WCAG A/AA violations).
- Electron Playwright link suite: 2 tests passed (toolbar apply/edit/remove
  flow and application/document theme isolation).
- Visual capture: Classic White and Midnight screenshots were inspected at
  the 1440x900 Electron viewport. The same focused visual flow passed against
  `release/win-unpacked/Markora.exe`.
- Production packaging completed with the patch desktop version (`0.2.1`),
  producing the installer, portable executable, and unpacked application under
  `release/`.

- The `0.2.1` NSIS installer was installed silently into the per-user Windows
  installation and the focused visual flow passed against the installed
  executable as well.

The full E2E suite completed 38 of 38 tests. The full repository format check
still reports pre-existing formatting drift in legacy files; all files changed
by this fix pass the formatter check.
