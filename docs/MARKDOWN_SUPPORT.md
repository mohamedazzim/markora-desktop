# Markdown support

Markora's file format is UTF-8 Markdown. Source Mode is the compatibility surface for arbitrary portable
text; Structured Mode provides rich controls for the syntax described below. "Preserved" means semantic
round-trip fixtures exist, not that every construct has a dedicated visual editor.

| Construct | Source Mode | Structured Mode | Round-trip and UI notes |
|---|---|---|---|
| ATX and Setext headings | Editable | Editable | Stable duplicate-aware heading anchors and outline navigation |
| Paragraphs and hard/soft breaks | Editable | Editable | Whitespace can normalize after a structured edit |
| Bold, italic, strikethrough | Editable | Toolbar/editable | GFM strikethrough supported |
| Underline and highlight | HTML syntax | Toolbar/editable | Serialized as safe `<u>` and `<mark>` HTML because Markdown has no portable syntax |
| Inline code | Editable | Editable | Preserved as inline code |
| Fenced code and language info | Editable | Editable | Fence style can normalize; code content/language is tested |
| Blockquotes and horizontal rules | Editable | Editable | Theme appearance is configurable |
| Ordered and unordered lists | Editable | Editable | List markers/spacing can normalize |
| GFM task lists | Editable | Editable | Checked state and nested list semantics are tested |
| GFM tables | Editable | Visual editing | Insert/delete row/column/table, header toggle, merge/split, alignment, escaped-pipe fixtures |
| Inline links | Editable | Editable | Safe URL conversion and title preservation |
| Reference links and definitions | Editable | Preserved | Semantic targets are tested; no dedicated definition manager |
| URL images | Editable | Editable | Alt/title/dimensions/alignment and localization actions |
| Local images | Editable | Editable | Paste/drop/picker and asset strategies use validated main-process IPC |
| YAML front matter | Editable | Preserved block | Delimiters/body preserved; no schema-specific metadata form |
| Display math (`$$`) | Editable | KaTeX preview/editable fence | Math source is retained; rendering never executes code |
| Fenced `math` blocks | Editable | KaTeX preview/editable fence | Tested with other fences |
| Inline math | Editable | Preserved | Parser/HTML export support; no dedicated rich inline-math control |
| Mermaid fences | Editable | Strict SVG preview/editable fence | Theme selection and safe error state; no pan/zoom/image-export control |
| Footnote references/definitions | Editable | Preserved | Semantic identifiers/content are tested; no dedicated footnote manager |
| Raw HTML blocks and comments | Editable | Preserved/opaque | Safe examples round trip; renderer/export sanitization prevents scripts |
| Escaped characters and pipes | Editable | Preserved | Escaped table-cell pipes have focused fixtures |
| Unicode | Editable | Editable | Multilingual text and emoji fixtures |
| Empty documents | Editable | Editable | Mode visit does not invent semantic content |
| LF and CRLF files | Editable | Editable | Original consistent disk convention is reapplied on save |

## Existing image syntax

The image syntax layer recognizes inline Markdown images and standalone HTML `<img>` tags. HTML is used
when width, height, or alignment cannot be represented by portable Markdown. It validates source schemes,
dimensions, alt/title lengths, and alignment before serialization.

## Raw and provider-specific syntax

Raw HTML is sanitized whenever it is rendered or exported. Preservation does not mean arbitrary HTML is
trusted or made interactive. Provider extensions outside GFM, YAML front matter, and Remark math may be
reformatted or unsupported by Structured Mode; use Source Mode when exact provider-specific text is
required.

Files larger than 2 MiB are deliberately restricted to Source Mode. This does not reduce Markdown syntax
support or truncate the file.

See `MARKDOWN_NORMALIZATION.md` for formatting changes introduced by a structured edit.
