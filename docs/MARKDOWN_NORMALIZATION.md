# Markdown normalization

## When normalization occurs

Opening, viewing, editing, and saving exclusively through Source Mode does not run the structured
serializer. Markora stores a canonical LF representation internally and reapplies the file's consistent
LF or CRLF convention when saving.

Entering Structured Mode creates a presentation but does not itself replace the canonical source. Once a
Tiptap transaction changes the structured document, Structured Mode serializes its current semantic tree
back to Markdown; that serialization becomes the canonical text. Formatting normalization is therefore
expected after a structured edit.

## Stable semantics

The normalization contract is semantic and idempotent:

- parsing source, serializing it, and parsing again produces the same tested AST semantics;
- normalizing an already normalized document produces the same string; and
- the full source edit -> Structured Mode -> structured edit -> Source Mode -> save -> reopen journey
  preserves the tested constructs.

Source position metadata is intentionally excluded from semantic AST comparison.

## Formatting that can change

- blank-line placement and terminal newline;
- list marker, indentation, and item spacing;
- emphasis marker choice;
- fenced-code delimiter/style and surrounding whitespace;
- table divider width, padding, and alignment marker formatting;
- link/image destination escaping and angle-bracket use;
- safe HTML attribute quoting/formatting; and
- consistent line endings on disk.

A file containing mixed LF and CRLF is not promised byte-for-byte mixed-ending preservation. It is saved
using the detected document convention. Consistent LF files stay LF and consistent CRLF files stay CRLF.

## Constructs protected across Structured Mode

- YAML front matter;
- Mermaid and math/display-math fences;
- ordinary fenced code and language identifiers;
- reference definitions and reference-link semantics;
- footnote references and definitions;
- HTML comments and tested safe raw HTML blocks;
- table cells with escaped pipes;
- Markdown and HTML images, including tested dimensions;
- Unicode text; and
- empty documents.

Underline and highlight serialize to `<u>` and `<mark>` because CommonMark has no universal equivalent.
Raw HTML is treated as content to preserve and sanitize, never as trusted application markup.

## Exact-text requirements

Use Source Mode and avoid a structured edit when byte-level formatting, a provider-specific extension,
unusual mixed line endings, or unsupported raw syntax must remain unchanged. Files larger than 2 MiB are
kept in Source Mode automatically.
