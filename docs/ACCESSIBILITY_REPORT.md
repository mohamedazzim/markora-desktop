# Accessibility report

Report date: 2026-07-15  
Application version: 0.2.0  
Target: Windows 10/11, Electron 43, Chromium renderer

## Result summary

Markora now has an automated accessibility gate and reusable interaction patterns for its editors,
toolbars, search surfaces, command UI, settings, and modal dialogs. The automated suite passes **39
of 39 tests**. It includes **14 axe-core WCAG A/AA component test cases** (17 scans across initial,
result, preview, and confirmation states), **10 light/dark built-in theme contrast checks**, one
contrast-calculation reference check, and six keyboard/focus behavior tests.

This is an implementation and automated-test result, not a claim that a complete assistive-technology
certification was performed. A real Windows Narrator/NVDA and Windows High Contrast manual pass still
has to be performed on the release candidate. The exact manual checks are listed below.

## Automated verification

Command:

```powershell
npm run test:accessibility
```

Result on 2026-07-15:

```text
Test Files  1 passed (1)
Tests       39 passed (39)
```

The axe scans use `axe-core` 4.12.1 and the WCAG 2.0/2.1 A and AA rule tags. They cover:

- Image insertion and editing dialog
- Pandoc import and export dialog
- PDF export dialog
- HTML export dialog
- Recovery-center and external-file conflict dialogs, including overwrite confirmation
- Appearance and writing-mode dialog
- Command palette
- Configurable-shortcut settings
- Current-document search and replace
- Workspace search and replace
- CodeMirror Source Mode editing surface
- Tiptap Structured Mode editing surface and formatting toolbar

JSDOM cannot calculate painted color contrast because it has no layout/paint engine, so the axe
`color-contrast` rule is disabled only in this component harness. It is replaced by deterministic WCAG
relative-luminance checks for normal text, muted text, links, and accent-control text across every
built-in light and dark theme. All **50 theme foreground/background pairs** meet the 4.5:1 normal-text
threshold. The final real-Electron baseline also passed its rendered axe-core shell and command-palette
flow as one of 36/36 E2E tests. Multi-theme forced-colors rendering remains in the manual matrix below.

The accessibility project result above was recorded at the time this report was generated. Other feature
areas were still changing concurrently, so it is not a substitute for the final repository-wide
typecheck, lint, unit, integration, Electron E2E, and build results. Use the final command-verification
report for those counts and outcomes; do not infer them from this accessibility-only run.

## Implementation details

### Keyboard operation

- Source Mode and Structured Mode expose named, keyboard-focusable editing surfaces.
- Structured and table toolbars support Left/Right Arrow, Home, and End navigation while skipping
  disabled controls.
- Formatting toggles expose their current state with `aria-pressed`.
- Search supports Enter, Shift+Enter, F3, Shift+F3, and Escape; destructive replace-all confirmation
  receives focus and traps Tab until confirmed or cancelled.
- The command palette supports Arrow keys, Home, End, Enter, Escape, and trapped Tab navigation.
- Workspace replacement and shortcut-conflict confirmations receive focus, trap Tab, close with Escape,
  and restore focus to the invoking control.

### Focus and dialogs

- Image, Pandoc, PDF, appearance, command-palette, and shortcut confirmation dialogs use an accessible
  name, `aria-modal`, initial focus, Tab containment, Escape handling, and focus restoration.
- Global `:focus-visible` styling uses a three-pixel design-token focus ring.
- A reusable skip-link style is provided for the application shell.
- Hidden status text uses a common visually-hidden pattern without `display: none`, so it remains
  available to assistive technology.

### Announcements and state

- Search result counts, workspace progress, conversion progress, shortcut recording, validation errors,
  and operation results use polite or assertive live regions according to urgency.
- Busy workspace and rendered fence states expose `aria-busy`.
- Invalid operations use `role="alert"`; destructive confirmations use `role="alertdialog"`.
- Source/Structured mode toggles, formatting toggles, theme choices, and search options expose selected or
  pressed state independently of color.

### Trees, tabs, outline, tables, palette, and editors

- The workspace tree uses `tree`, `treeitem`, and `group` semantics, levels and expansion state, and an
  Arrow/Home/End keyboard model.
- Document and sidebar tabs use the ARIA tab pattern, roving focus, selected state, associated tab panels,
  and Left/Right/Home/End navigation. Document tabs support pointer close and the announced Delete
  shortcut without nested interactive controls. The final real-Electron axe scan passed for the integrated
  shell and command palette.
- Outline entries use native buttons and remain keyboard reachable. Exact heading focus/announcement in
  both editor modes must be included in the final manual pass.
- Table editing controls are a named toolbar associated with the Structured editor and support toolbar
  arrow navigation.
- Command-palette results use combobox/listbox semantics, announce result count, expose disabled commands,
  and restore focus when closed.
- Chromium spell checking remains local; accessible misspelling suggestions use Electron's native context
  menu.

## High contrast and reduced motion

- A dedicated high-contrast built-in theme is available in light and dark variants.
- `forced-colors: active` preserves system colors and visible borders for dialogs, form fields, selected
  states, tree items, and buttons.
- `prefers-contrast: more` strengthens boundaries and selected-state outlines.
- `prefers-reduced-motion: reduce` removes transitions, reduces animations to one effectively zero-length
  frame, and disables smooth scrolling throughout the renderer.

## Manual release-candidate test plan

Perform these checks in the unpacked build and installed application before calling accessibility
verification complete:

1. Enable Windows Narrator, launch Markora, and traverse the entire shell with Caps Lock+Right Arrow.
   Confirm the app name, document tabs, toolbar, sidebar, active editor, and status information are
   announced in a sensible order.
2. Operate every visible command without a mouse. Exercise tab switching/closing, workspace-tree
   expansion, outline navigation, table editing, command palette, all dialogs, and both search panels.
3. Open and close each modal from a known trigger. Confirm focus enters it, cannot escape with Tab, closes
   with Escape where safe, and returns to the original trigger.
4. Enable a Windows Contrast Theme and restart Markora. Confirm all text, focus indicators, borders,
   selected tabs, toggle states, CodeMirror selection, and Tiptap selection remain visible.
5. Enable **Show animations in Windows: Off**. Confirm dialogs and Focus/Typewriter modes do not animate
   and that cursor navigation does not trigger smooth motion.
6. Test at 200% Windows scaling and with text enlarged. Confirm dialogs remain scrollable and no primary
   action is clipped.
7. With Narrator and NVDA, edit headings, links, lists, tasks, tables, images, math, and Mermaid blocks.
   Confirm meaningful role/state announcements and no duplicate reading caused by hidden mode panes.
8. Run the Electron Playwright axe scan in light, dark, and Windows forced-colors emulation. Save the HTML
   report with the release test artifacts.

## Remaining accessibility limitations

- No real Narrator, NVDA, JAWS, Windows Contrast Theme, or 200% scaling session was performed in this
  environment. These are release-candidate manual checks, not completed verification.
- JSDOM axe cannot validate painted contrast, focus-ring pixels, clipping, reflow, or operating-system
  native menus. Theme token contrast is numerically verified and a rendered Electron shell/palette scan
  passed; manual multi-theme, forced-colors, reflow, and native-menu checks remain necessary.
- Mermaid and KaTeX previews have named wrappers, but complex generated SVG/math does not yet contain a
  user-authored long description. Authors should provide adjacent explanatory text for complex diagrams.
- Chromium/Windows spell-check underlines and native suggestion menus cannot be fully asserted from a
  DOM-only automated test.
