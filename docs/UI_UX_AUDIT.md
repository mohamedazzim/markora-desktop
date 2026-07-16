# Markora UI/UX Audit

**Audit Date:** 2026-07-15  
**Auditor:** Principal Desktop UI/UX Architect  
**Scope:** Renderer UI Refactoring for Markora v0.2.0

---

## 1. Visual Hierarchy & Clutter Analysis

The current interface places too much emphasis on utility elements, distracting from the central writing canvas. The core areas of friction identified during the visual audit are:

*   **Excessive Permanent Controls:** The formatting toolbar (`.format-toolbar` and `.table-toolbar`) is always visible in Structured Mode, introducing cognitive load and reducing the vertical writing space.
*   **Competing Navigation Rows:** The application layout stacks a native/custom top titlebar with branding, window actions, and tabs directly on top of a formatting toolbar, leading to three rows of header controls.
*   **Outlined Elements & Density:** Too many buttons have visible borders and background shapes even in their resting state, making the UI look noisy and developer-oriented.
*   **Aesthetic Tone:** Saturated greens (`--accent`) and bright blues are used for UI highlights, rather than warm or muted tones that facilitate calm writing.
*   **Heavy Borders:** The main editor shell, sidebar tabs, and status bar are bounded by rigid `1px solid var(--line)` dividers, making the application feel boxed-in.

---

## 2. Component Audits & Friction Points

### 2.1 Window Chrome & Tab Strip
*   **Issue:** The topbar contains window controls, product branding, document tabs, and document utilities (New, Open, Save) crammed together.
*   **Friction:** The topbar height (46px) is tall, and the unsaved indicator is a text bullet (`•`) prepend rather than a sleek visual dot. Tabs have strong underlines on active states.
*   **Recommendation:** Move general document tools (New, Open, Save) into the native application menu and command palette. Create a subtle tab layout (height 32–38px) where document titles are visual focuses, and tab close buttons only show on hover.

### 2.2 Formatting Toolbars
*   **Issue:** Structured mode uses two separate toolbars: `.format-toolbar` at the top of the editor and `.table-toolbar` stacked below it when editing tables.
*   **Friction:** These controls occupy critical vertical pixels and are present even when the user is reading or typing simple prose.
*   **Recommendation:** Remove the permanent formatting toolbar. Replace it with a **Contextual Floating Toolbar** that appears only when text is selected, and **Block Context Controls** that attach to relevant blocks (e.g., Code Language selector inside a code block, row/col operations attached to tables).

### 2.3 Sidebar & File Tree
*   **Issue:** The sidebar has visible vertical tabs ("Files", "Outline", "Search", "Settings") permanently aligned in a header row.
*   **Friction:** "Open Workspace" is a large button. When no workspace is loaded, it shows a plain text error instead of a polished welcoming state.
*   **Recommendation:** Implement an elegant collapsible sidebar with a single icon-based switcher. Redesign the outline view to use subtle hierarchical indentations and highlight the active heading without borders.

### 2.4 Editor Canvas & Typography
*   **Issue:** The editor renders inside a standard container without visual margins. Typography defaults are standard Segoe UI/Georgia without strict hierarchical spacing.
*   **Friction:** In Structured Mode, tables, blockquotes, and code fences have heavy outlines that clash with Typora’s seamless layout.
*   **Recommendation:** Use a centered document column with a width of 760–860 px, top padding of 48–72 px, and bottom padding of 120–180 px. Create a typography system that supports customizable fonts (UI, Body, Heading, Code).

### 2.5 Dialog Styling & Conflict Resolution
*   **Issue:** Dialogs (e.g., conflict, recovery, Settings, Pandoc) use inconsistent layout structures, heavy border treatments, and bright green/red backgrounds.
*   **Friction:** The conflict dialog has a heavy metadata display block and makes comparison difficult.
*   **Recommendation:** Redesign all dialogs under a unified system (neutral surfaces, soft drop shadows, consistent widths). Implement a side-by-side or inline comparison diff for the conflict dialog.

---

## 3. Detailed Refactoring Plan

The visual audit leads to the following target layout:

| Component | Current Implementation | Target Design (Refined UX) |
| :--- | :--- | :--- |
| **Topbar & Window Chrome** | Combined titlebar with tabs, branding, and document actions. | Refined titlebar (30-36px). Subtly styled tabs (32-38px) with hover-only close. |
| **Toolbar** | Always-visible formatting row. | Removed from view. Replaced with contextual select-to-show float toolbar. |
| **Slash Menu** | Standard formatting buttons. | Refined `/` command popup with search, categories, and keyboard support. |
| **Sidebar** | Permanent tab bar and dense tree. | Collapsible sidebar with minimal tree icons and an empty-state action guide. |
| **Status Bar** | Full layout with long text. | Ultra-minimal status bar (22-26px) that can be hidden in Zen Mode. |
| **Dialogs** | Heavily boxed borders. | Unified popover style with neutral card backdrops and clear layout hierarchy. |

## 4. Implemented dialog and theme architecture

The redesign now has a single renderer-owned `Dialog` primitive. It renders through a body portal,
inerts the application root while open, restores the invoking focus target, traps Tab navigation,
handles Escape/backdrop policy, and honors reduced-motion and forced-colors preferences. Existing
appearance, recovery, export, image, Pandoc, command-palette, table, text-input, and shortcut
confirmation surfaces use this primitive.

Conflict resolution uses a calm neutral surface with editor/disk metadata, last-known/disk/detected
timestamps, explicit reload/keep/save-copy/replace actions, a bounded unified diff, and an aligned
side-by-side view. Destructive replacement remains a second explicit action.

The Theme Gallery separates interface and document selections. Built-in previews and custom packages
use shared design tokens; custom packages are validated through typed preload IPC and persisted globally
under Electron user data. Document tokens are applied to `.document-container` only, keeping shell chrome
stable when the document theme changes.
