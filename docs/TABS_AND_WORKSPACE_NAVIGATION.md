# Tabs and workspace navigation

Markora keeps tab operations consistent with common desktop editors. Right-click
any document tab (or press Shift+F10/Context Menu while it is focused) to use:

- Close
- Close Others
- Close All to the Right
- Close All

Bulk operations inspect all selected documents before changing state. If any
selected document is dirty, Markora asks once for confirmation; cancelling that
prompt leaves every tab open. Closing the last tab creates a fresh untitled
document so the editor never has an empty tab strip.

Workspace trees are intentionally collapsed when a workspace is opened. Expand a
folder to inspect its children. Empty folders remain visible for orientation but
do not expose an expand control. The tree includes files of every extension so
the workspace view does not hide project assets. Markora opens Markdown files;
clicking another file type reports that it is unsupported instead of attempting
to parse it.

Markdown links to relative `.md`/`.markdown` files open the target in a new or
existing tab. HTTP(S) and mail links use the validated external-link handler.
