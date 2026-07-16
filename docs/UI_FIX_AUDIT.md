# Markora UI fix audit

Audit date: 2026-07-15  
Scope: workspace tree, modal presentation, and a Typora-inspired white document theme.

## Current implementation findings

### Workspace tree

`TreeNode` in `src/renderer/main.tsx` now renders folder state with Lucide `ChevronRight`/`ChevronDown`
and file-category icons. The tree retains semantic `tree`/`treeitem` roles and keyboard navigation,
while `.tree`, `.tree li`, and `.tree button` in `src/renderer/styles.css` provide a reserved chevron
column, 28px rows, file-type coloring, ellipsis, focus, hover, and active states.

Root cause: the previous presentation encoded state as text in the React component instead of an icon
component. This is addressed by a typed icon mapping and a two-column tree-row layout.

### Dialogs

Dialogs now use the shared `Dialog` portal in `src/renderer/components/Dialog.tsx`, which correctly
provides focus trapping, inert background handling, Escape, and restoration. The overlay is now a
high-opacity scrim (`rgb(7 12 18 / 72%)`) with restrained blur, and the panel has an explicit elevated
shadow, radius, and box sizing. Legacy overlay overrides were removed from `styles.css`, leaving the
shared primitive as the presentation source of truth.

Root cause: multiple historical overlay selectors had remained alongside the unified primitive, and the
overlay was translucent enough to preserve too much background detail. The fix retains the portal and
accessibility behavior while using a stronger scrim and a clearly elevated surface.

### Theme and Markdown styling

The theme registry in `src/renderer/appearance/themes.ts` is token-based and now includes a dedicated
`white` paper preset alongside the existing light/dark families. `appearanceDocumentCssVariables` keeps
the document selection isolated from shell chrome. The scoped `.document-container .structured-prosemirror`
rules in `styles.css` cover headings, paragraphs, lists, links, inline code, code fences, tables,
blockquotes, tasks, images, math, Mermaid, YAML/front matter, footnotes, and horizontal rules. Source
Mode continues to consume the same document background, text, code, selection, and typography variables.

Root cause: the document surface previously had no first-class white writing contract and Markdown
styling was distributed across broad legacy selectors. The fix adds the white theme and a scoped document
stylesheet so the projection remains readable without recoloring application chrome.

## Planned files

- `src/renderer/main.tsx` — icon-based TreeNode markup and document theme class.
- `src/renderer/styles.css` — tree-row layout, modal scrim cleanup, and document element styles.
- `src/renderer/components/dialog.css` — unified opaque modal presentation.
- `src/renderer/appearance/themes.ts` — white theme tokens and document variables.
- `src/renderer/appearance/appearance-settings.ts` — white theme selection compatibility.
- `tests/unit/*` and `tests/e2e/*` — tree, modal, theme, and visual behavior regressions.
- `docs/TYPORA_VISUAL_RESEARCH.md` — independent visual decisions and official references.

## Regression risks

- Tree keyboard navigation must continue to target only visible tree buttons.
- Active-file and drag/drop states must not be lost when icon spans are introduced.
- Dialog focus restoration and existing accessible names must remain stable.
- Document-only tokens must not recolor shell chrome or settings controls.
- CodeMirror source colors must remain readable when the white document theme is selected.
- Mermaid, KaTeX, raw HTML, front matter, and task-list node selectors must remain scoped.

## Verification plan

1. Run the existing unit, accessibility, integration, and real-Electron E2E suites. **Passed 15 Jul
   2026: 625 unit, 42 integration, 39 accessibility, 14 performance, and 36 Electron E2E tests.**
2. Add regression assertions for icon semantics, folder expansion, active states, modal contrast, and
   white-theme tokens.
3. Capture baseline and final screenshots for tree states, session restoration, light/dark themes,
   Structured Mode, Source Mode, and Appearance settings.
4. Launch the development application and the unpacked executable. **Passed on the development host.**
5. Run `npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:e2e`, `npm run build`, and
   `npm run package`. **Passed; the only expected warnings are optional Pandoc missing and unsigned
   local artifacts.**

Screenshot evidence is stored at
`C:\Users\abea0\.gemini\antigravity-ide\brain\4295ae05-abea-4bc3-87b4-3cbea7b56a2b\screenshots`:
`tree_expanded.png`, `tree_collapsed.png`, `settings.png`, `conflict_dialog.png`,
`recovery_dialog.png`, `light_theme.png`, `dark_theme.png`, `structured_editing.png`, and
`source_editing.png`.
