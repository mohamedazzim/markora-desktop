# Editor engine

## One document, two projections

Markora uses one authoritative Markdown text state per open tab. CodeMirror Source Mode and Tiptap
Structured Mode are editing projections of `CanonicalDocument`; neither projection owns an independent
file copy.

The canonical model stores LF-normalized internal text, the original disk line-ending choice, revisions,
a saved snapshot, stale-save state, bounded undo/redo history, and independent view snapshots for both
modes. A view snapshot includes selection anchor/head and horizontal/vertical scroll position.

## Synchronization sequence

1. Opening a file creates `CanonicalDocument.fromDisk()`. It records LF/CRLF and exposes canonical LF
   text to the editors.
2. Source Mode writes CodeMirror changes directly to the canonical model.
3. Entering Structured Mode converts the current canonical revision to controlled HTML and initializes
   or updates Tiptap.
4. A Tiptap transaction serializes its current structured HTML to Markdown and writes that Markdown to
   the same canonical model.
5. Returning to Source Mode reads the latest canonical Markdown; it does not read a private Tiptap copy.
6. Save creates a revision-bound ticket and applies the recorded disk line ending. If the user edits while
   the ticket is being written, completing that ticket leaves the newer editor revision dirty.
7. Reopening creates a new canonical model from the written disk text.

The round-trip suites model and integration-test this complete source edit -> Structured Mode ->
structured edit -> Source Mode -> save -> reopen journey.

## Mode-specific behavior

Source Mode preserves raw text when no structured edit occurs, including unusual syntax and the original
LF/CRLF disk convention. It provides CodeMirror Markdown language support, folding, bracket handling,
search decorations, image paste/drop insertion, spell-check attributes where Chromium supports them,
word wrap, navigation, and per-tab view restoration.

Structured Mode provides semantic headings, marks, links, images, lists/tasks, blockquotes, code, tables,
front-matter/fence preservation, KaTeX math previews, Mermaid previews, visual table actions, search
decorations, spell-check attributes, active-block focus, and typewriter positioning. Its toolbar and table
toolbar are keyboard navigable.

## History and view state

Canonical cross-mode history is limited to 500 entries and approximately 64 MiB. CodeMirror and
ProseMirror may also use transient native editor transactions for immediate editing behavior, but
application-level undo/redo commands update the canonical state. Mode snapshots are clamped to document
bounds and retained across mode and tab switches. Disk reload resets content history but retains view
snapshots so the renderer can restore a useful location.

## Disk changes and conflict safety

The main process fingerprints files by size, modification time, and SHA-256. A checked save compares the
expected fingerprint with disk, writes atomically, and returns a typed saved/conflict/failure result.
External changes are classified as unchanged, matching the editor, safe to reload, or conflicting.
Deletion and likely same-directory rename are distinct conflict kinds. A newer disk version must not be
silently overwritten; overwrite requires explicit confirmation.

## Large-document policy

Structured Mode is limited to 2 MiB. Larger documents open and remain in Source Mode with an actionable
message because structured conversion would simultaneously materialize multiple large representations.
The Markdown is neither truncated nor made read-only. Performance measurements should report this
deferred structured-mode policy separately from an actual conversion time.

## Serialization contract

Source-only saves preserve text. Once a structured edit is made, formatting can normalize while Markdown
semantics remain stable. Front matter, fenced code, Mermaid/math fences, tables (including escaped pipes),
reference links, footnotes, safe raw HTML blocks, images, empty files, Unicode, and LF/CRLF have dedicated
fixtures. See `MARKDOWN_NORMALIZATION.md` for the exact formatting expectations and
`MARKDOWN_SUPPORT.md` for UI support versus preservation support.

## Unsupported or intentionally limited cases

- Files over 2 MiB do not enter Structured Mode.
- Not every safe raw HTML construct has a rich editor control; raw constructs are primarily preserved.
- Reference definitions and footnotes are preserved, but dedicated structured management dialogs are not
  implemented.
- Provider-specific Markdown extensions outside the enabled Remark/GFM/front-matter/math set should be
  edited in Source Mode and tested before a structured edit.
