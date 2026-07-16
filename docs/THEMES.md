# Themes and writing appearance

Appearance settings use versioned JSON and CSS design tokens. They are stored locally and applied to both
editor projections without changing Markdown content.

## Color and built-in themes

Color mode can be Light, Dark, or Follow system. System mode observes
`prefers-color-scheme` changes while the application is running.

Built-in theme families:

- Markora
- Markora White
- Paper
- Forest
- Midnight
- High contrast
- Academic
- Sepia
- Graphite

Fresh installations use **Markora White** in Light mode by default. It follows the
Typora-style document surface shown in the product reference: a true white canvas,
centered prose column, charcoal body text, blue links, subtle gray rules, and pale
code/table surfaces. Existing installations that still have the former
`system`/`markora`/`adaptive` defaults are migrated to this Classic White profile
once at startup; an explicitly selected theme is never replaced.

Each family resolves through light/dark design-token variants where applicable. The appearance dialog
provides a live preview and Reset restores version-2 defaults.

Independent selections are available for:

- Interface and document-only themes. `Adaptive` follows the interface theme while an explicit document
  selection changes only the editor surface.
- Theme Gallery previews for both scopes, with active-state indicators.

- Source editor: Adaptive, GitHub Light, GitHub Dark, Dracula
- Code blocks: Adaptive, GitHub, Atom One Dark, Monokai
- Mermaid: Default, Neutral, Dark, Forest, Base

## Typography and layout

The appearance dialog controls:

- editor font and code font;
- font size and line height;
- paragraph and heading spacing;
- editor and content widths;
- editor padding;
- link appearance (underline, subtle, accent);
- table appearance (grid, minimal, striped);
- blockquote appearance (bar, boxed, italic); and
- code-block appearance (flat, rounded, elevated).

Writing settings in the same profile include Focus, Typewriter, Zen, full screen, word wrap,
scroll-past-end, and which shell regions Zen Mode hides.

## Import and export

Appearance Export downloads a versioned JSON profile. Import accepts JSON up to 1 MB, migrates supported
version-1 profiles, normalizes invalid/out-of-range values, and reports warnings. Unsupported versions or
invalid JSON fall back to defaults instead of applying partial unsafe data.

The imported `customCss` field is re-sanitized; serialized data is never trusted merely because it was
previously exported.

Custom theme packages are stored globally in the Electron user-data directory under `themes/` (the exact
location is platform-specific and is not inside a workspace). This avoids modifying a workspace just by
opening Settings and lets a theme be reused across workspaces. Import, duplicate, edit, export, and delete
are typed preload operations. Versioned JSON is the portable package; optional CSS is stored beside it and
revalidated before application.

## Custom CSS

Custom CSS is deliberately narrower than browser CSS. It accepts non-nested selector/declaration blocks
up to 50 KB, scopes them to editor roots, and permits only presentation properties. For example:

```css
h1 {
  color: #365b47;
  letter-spacing: 0.02em;
}

.structured-prosemirror blockquote {
  border-left: 4px solid #6c8f78;
}
```

The sanitizer rejects unsafe/global selectors, `@import`, `@font-face`, `@namespace`, URLs, JavaScript,
legacy executable CSS, nested/incomplete rules, control constructs, and non-allowlisted properties. A
rejected stylesheet is not partially installed.

Custom CSS cannot execute a script, call Electron/preload APIs, or intentionally target the application
shell outside the editor-safe scope. Theme-package CSS is applied only to editor/document roots
(`.document-container`, `.markora-editor`, `.structured-prosemirror`, `.cm-editor`, and the reading
surface); it cannot style the dialog overlay or application chrome.

## Accessibility behavior

The high-contrast family is complemented by `forced-colors`, `prefers-contrast`, and
`prefers-reduced-motion` rules. Automated token checks cover normal/muted/link/control contrast in built-in
light and dark variants. Real Windows Contrast Theme and assistive-technology validation remains a manual
release-candidate check.
