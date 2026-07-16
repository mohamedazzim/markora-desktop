# Typora visual research

Research date: 2026-07-15. This document records observations from official Typora pages only. No
Typora CSS, source code, icons, branding, or assets were copied.

| Official reference | Observed behavior | Markora interpretation | Implementation file |
| --- | --- | --- | --- |
| [Quick Start](https://support.typora.io/Quick-Start/) | Live Preview hides most Markdown punctuation and keeps writing centered on content. | Keep Markora's canonical Source/Structured modes, but make Structured Mode a quiet paper-like surface with generous readable width. | `src/renderer/styles.css` |
| [Markdown Reference](https://support.typora.io/Markdown-Reference/) | Headings, lists, task lists, tables, blockquotes, code fences, math, footnotes, YAML, links, images, and rules receive distinct block styling. | Define explicit selectors for every supported Markdown node rather than relying on browser defaults. | `src/renderer/styles.css` |
| [About Themes](https://support.typora.io/About-Themes/) | Themes are CSS-driven and light/dark variants can be selected independently. | Preserve Markora's token architecture and add a dedicated `white` writing preset without importing external CSS. | `src/renderer/appearance/themes.ts` |
| [Theme Gallery](https://theme.typora.io/) | Gallery themes emphasize restrained typography, paper surfaces, and readable long-form layouts. | Use a warm-white surface, charcoal text, subtle borders, and restrained accent colors. | `src/renderer/appearance/themes.ts` |
| [Code Fences](https://support.typora.io/Code-Fences/) | Fenced code supports language highlighting, wrapping choices, and a visually distinct code surface. | Use a quiet off-white code panel, monospace typography, overflow scrolling, and preserved syntax highlighting. | `src/renderer/styles.css` |
| [Code Block Styles](https://support.typora.io/Code-Block-Styles/) | Code fence styles are separated from the main prose and use CodeMirror-specific classes. | Scope code-fence presentation to Structured Mode and retain CodeMirror Source Mode independently. | `src/renderer/styles.css` |
| [Math](https://support.typora.io/Math/) | Display math has substantial vertical separation; inline math remains part of prose. | Give math nodes a centered, padded surface without changing KaTeX markup. | `src/renderer/styles.css` |
| [Draw Diagrams With Markdown](https://support.typora.io/Draw-Diagrams-With-Markdown/) | Mermaid diagrams are rendered as document content and can follow theme variables. | Provide a neutral diagram panel with overflow handling and theme-aware surface tokens. | `src/renderer/styles.css` |
| [Typesetting with CSS](https://support.typora.io/Typeset/) | Writing width, paragraph spacing, image alignment, and element-specific typography are controlled through CSS. | Keep the content column centered, cap its width, and explicitly style images, lists, quotes, rules, and footnotes. | `src/renderer/styles.css` |
| [Add Custom CSS](https://support.typora.io/Add-Custom-CSS/) | Base and current-theme custom CSS are loaded in a predictable order. | Continue using Markora's sanitized, scoped custom CSS pipeline; never execute arbitrary CSS outside approved roots. | `src/renderer/appearance/custom-css.ts` |

## White-theme decisions

- Content width: 860px maximum with responsive side padding.
- Body typography: Segoe UI/system sans for Windows-native readability, with a calm 16px base and
  approximately 1.75 line height.
- Headings: charcoal, progressively smaller weights, no heavy decorative borders except a subtle H1
  divider.
- Paragraphs: compact but breathable spacing; first-line content remains aligned to the prose column.
- Sidebar: cool neutral gray with compact 28px tree rows and restrained green accent states.
- Dialogs: opaque white panel, neutral scrim, clear border, and a single elevated shadow.
- Links: accent color with underline on hover/focus and visible keyboard focus.
- Tables: subtle grid, lightly tinted header, optional zebra rows, and comfortable cell padding.
- Task lists: native-sized checkboxes with accent checked states.
- Math/diagrams: centered or overflow-safe block surfaces with no forced dark background.
- YAML/front matter: muted metadata panel with monospace content and clear separation from prose.
- Source Mode: separate CodeMirror surface; white theme sets background, text, gutters, selection, and
  focused cursor without changing the canonical source content.
- Dark mode: remains a separate token set; the white preset must not leak shell colors into dark mode.

