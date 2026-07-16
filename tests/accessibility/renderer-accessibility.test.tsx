import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe, { type Result as AxeViolation } from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_THEMES } from '../../src/renderer/appearance/themes';
import { AppearancePanel } from '../../src/renderer/appearance/AppearancePanel';
import { createDefaultAppearanceSettings } from '../../src/renderer/appearance/appearance-settings';
import { contrastRatio, meetsWcagAA } from '../../src/renderer/accessibility/contrast';
import {
  CommandPalette,
  CommandRegistry,
  MemoryShortcutPersistence,
  ShortcutManager,
  ShortcutSettingsPanel,
} from '../../src/renderer/commands';
import { SourceEditor } from '../../src/renderer/editor/SourceEditor';
import { StructuredEditor, type StructuredEditorHandle } from '../../src/renderer/editor/StructuredEditor';
import { TextInputDialog, validateLinkDestination } from '../../src/renderer/editor/TextInputDialog';
import { HtmlExportDialog } from '../../src/renderer/export/HtmlExportDialog';
import { PdfExportDialog, type PdfExportApi } from '../../src/renderer/export/PdfExportDialog';
import type { PdfPresetStorage } from '../../src/renderer/export/pdf-presets';
import { ImageDialog } from '../../src/renderer/images/ImageDialog';
import { PandocDialog } from '../../src/renderer/pandoc/PandocDialog';
import { ConflictDialog } from '../../src/renderer/recovery/ConflictDialog';
import { RecoveryCenterDialog } from '../../src/renderer/recovery/RecoveryCenterDialog';
import { DocumentSearchPanel } from '../../src/renderer/search/DocumentSearchPanel';
import { WorkspaceSearchPanel } from '../../src/renderer/search/WorkspaceSearchPanel';
import type { PdfExportResult } from '../../src/shared/contracts';
import { defaultPdfExportOptions } from '../../src/shared/pdf-options';

function violationSummary(violations: AxeViolation[]): string {
  return violations
    .map(
      (violation) =>
        `${violation.id}: ${violation.help}\n${violation.nodes
          .map((node) => `  ${node.target.join(' ')}: ${node.failureSummary ?? ''}`)
          .join('\n')}`,
    )
    .join('\n\n');
}

async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  const result = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: {
      // JSDOM has no layout/paint engine. Theme contrast is validated numerically below.
      'color-contrast': { enabled: false },
    },
  });
  expect(result.violations, violationSummary(result.violations)).toEqual([]);
}

class MemoryStorage implements PdfPresetStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const pdfResult: PdfExportResult = {
  operationId: 'accessibility-pdf',
  outputPath: 'C:\\Exports\\accessible.pdf',
  byteLength: 100,
  durationMs: 10,
  pageCount: 1,
  generatedTaggedPdf: true,
  generatedDocumentOutline: true,
};

const pdfApi: PdfExportApi = {
  pickPdfOutput: vi.fn(async () => ({ path: pdfResult.outputPath, displayName: 'accessible.pdf' })),
  previewPdf: vi.fn(async () => ({ html: '<p>Preview</p>', pageWidthMm: 210, pageHeightMm: 297 })),
  exportPdf: vi.fn(async () => pdfResult),
  cancelPdf: vi.fn(async () => true),
  onPdfExportProgress: vi.fn(() => () => undefined),
};

beforeEach(() => {
  Range.prototype.getClientRects = vi.fn(() => [] as unknown as DOMRectList);
  Range.prototype.getBoundingClientRect = vi.fn(() => new DOMRect());
  Object.defineProperty(window, 'markora', {
    configurable: true,
    value: {
      onWorkspaceSearchProgress: vi.fn(() => () => undefined),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('automated axe-core component audit', () => {
  it('has no WCAG A/AA violations in the image workflow dialog', async () => {
    const { container } = render(
      <ImageDialog
        open
        documentSaved
        workspaceAvailable
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        onChooseFile={vi.fn(async () => null)}
      />,
    );
    await expectNoAxeViolations(container);
  });

  it('has no WCAG A/AA violations in the Edit link dialog', async () => {
    const { container } = render(
      <TextInputDialog
        open
        title="Edit link"
        description="Enter a URL, relative path, email address, or heading anchor."
        label="Link destination"
        initialValue="#introduction"
        submitLabel="Apply link"
        allowEmpty
        validate={validateLinkDestination}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Edit link' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('Link destination')).toHaveValue('#introduction');
    await expectNoAxeViolations(container);
  });

  it('has no WCAG A/AA violations in Pandoc import/export controls', async () => {
    const { container } = render(
      <PandocDialog
        open
        status={{
          availability: 'available',
          executablePath: 'C:\\Program Files\\Pandoc\\pandoc.exe',
          version: '3.7',
          detection: 'path',
        }}
        conversion={{ state: 'idle' }}
        onChooseExecutable={vi.fn(async () => null)}
        onChooseInput={vi.fn(async () => null)}
        onChooseOutput={vi.fn(async () => null)}
        onRequestImportPreview={vi.fn(async () => ({ ok: true as const, markdown: '# Preview' }))}
        onConvert={vi.fn()}
        onCancelConversion={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await expectNoAxeViolations(container);
  });

  it('has no WCAG A/AA violations in PDF export controls', async () => {
    const { container } = render(
      <PdfExportDialog
        open
        document={{ html: '<h1 id="hello">Hello</h1>', headings: [{ depth: 1, id: 'hello', text: 'Hello' }] }}
        initialOptions={{ ...defaultPdfExportOptions, title: 'Accessible document' }}
        api={pdfApi}
        presetStorage={new MemoryStorage()}
        onClose={vi.fn()}
      />,
    );
    await expectNoAxeViolations(container);
  });

  it('has no WCAG A/AA violations in HTML export controls', async () => {
    const { container } = render(
      <HtmlExportDialog
        open
        defaultTitle="Accessible document"
        onClose={vi.fn()}
        onPreview={vi.fn(async () => ({
          html: '<!doctype html><html lang="en"><body><h1>Preview</h1></body></html>',
          warnings: [],
          embeddedImageCount: 0,
          headingCount: 1,
          hasMath: false,
          hasMermaid: false,
        }))}
        onExport={vi.fn(async () => null)}
      />,
    );
    await expectNoAxeViolations(container);
  });

  it('has no WCAG A/AA violations in appearance settings', async () => {
    const { container } = render(
      <AppearancePanel
        open
        settings={createDefaultAppearanceSettings()}
        prefersDark={false}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await expectNoAxeViolations(container);
  });

  it('has no WCAG A/AA violations in the command palette', async () => {
    const registry = new CommandRegistry<Record<string, never>>();
    registry.register({
      id: 'file.save',
      label: 'Save',
      category: 'File',
      handler: vi.fn(),
      enabled: true,
      defaultShortcut: 'Ctrl+S',
    });
    const manager = new ShortcutManager(registry, new MemoryShortcutPersistence());
    const { container } = render(
      <CommandPalette open registry={registry} context={{}} shortcuts={manager} onClose={vi.fn()} />,
    );
    await expectNoAxeViolations(container);
  });

  it('has no WCAG A/AA violations in keyboard shortcut settings', async () => {
    const registry = new CommandRegistry<Record<string, never>>();
    registry.register({
      id: 'file.save',
      label: 'Save',
      category: 'File',
      handler: vi.fn(),
      enabled: true,
      defaultShortcut: 'Ctrl+S',
    });
    const manager = new ShortcutManager(registry, new MemoryShortcutPersistence());
    const { container } = render(<ShortcutSettingsPanel manager={manager} />);
    await expectNoAxeViolations(container);
  });

  it('has no WCAG A/AA violations in current-document search', async () => {
    const { container } = render(
      <DocumentSearchPanel
        open
        documentText="alpha beta alpha"
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        onHighlightsChange={vi.fn()}
        onApplyReplacement={vi.fn()}
      />,
    );
    await expectNoAxeViolations(container);
  });

  it('has no WCAG A/AA violations in workspace search controls', async () => {
    const { container } = render(<WorkspaceSearchPanel workspaceRoot="C:\\Notes" onOpenResult={vi.fn()} />);
    await expectNoAxeViolations(container);
  });

  it('has no WCAG A/AA violations in recovery selection controls', async () => {
    const { container } = render(
      <RecoveryCenterDialog
        open
        items={[
          {
            id: 'recovery-1',
            path: 'C:\\Notes\\draft.md',
            name: 'draft.md',
            mode: 'source',
            active: true,
            source: 'snapshot',
            snapshot: {
              version: 1,
              snapshotId: 'snapshot-1',
              id: 'recovery-1',
              path: 'C:\\Notes\\draft.md',
              name: 'draft.md',
              content: '# Draft',
              createdAt: 1,
              updatedAt: 2,
            },
          },
        ]}
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await expectNoAxeViolations(container);
  });

  it('has no WCAG A/AA violations in disk conflict and overwrite confirmation states', async () => {
    const conflict = {
      document: {
        id: 'document-1',
        path: 'C:\\Notes\\draft.md',
        name: 'draft.md',
        content: '# Editor version',
        lineEnding: 'LF' as const,
        mode: 'source' as const,
        active: true,
        dirty: true,
      },
      result: {
        status: 'conflict' as const,
        conflict: {
          kind: 'modified' as const,
          path: 'C:\\Notes\\draft.md',
          expected: { modifiedAt: 1, size: 10, sha256: 'expected' },
          actual: { modifiedAt: 2, size: 11, sha256: 'actual' },
          disk: {
            path: 'C:\\Notes\\draft.md',
            name: 'draft.md',
            content: '# Disk version',
            lineEnding: 'LF' as const,
            modifiedAt: 2,
          },
        },
      },
    };
    const { container } = render(
      <ConflictDialog open conflict={conflict} onResolve={vi.fn()} onClose={vi.fn()} />,
    );
    await expectNoAxeViolations(container);
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite disk version…' }));
    const confirmation = await screen.findByRole('alertdialog', { name: 'Confirm overwrite' });
    await expectNoAxeViolations(confirmation);
  });

  it('keeps grouped workspace results, preview, and destructive confirmation accessible', async () => {
    const match = {
      id: 'match-1',
      fingerprint: 'match-fingerprint',
      kind: 'content' as const,
      line: 2,
      column: 3,
      endColumn: 8,
      startOffset: 10,
      endOffset: 15,
      matchedText: 'alpha',
      preview: 'An alpha line',
      previewStartColumn: 1,
      previewMatchStart: 3,
      previewMatchLength: 5,
    };
    const file = {
      id: 'file-1',
      path: 'C:\\Notes\\note.md',
      relativePath: 'note.md',
      filename: 'note.md',
      fingerprint: 'file-fingerprint',
      matches: [match],
    };
    const searchResult = {
      workspaceRoot: 'C:\\Notes',
      files: [file],
      matchCount: 1,
      matchedFileCount: 1,
      searchedFileCount: 1,
      discoveredFileCount: 1,
      truncated: false,
      durationMs: 4,
      failures: [],
    };
    const preview = {
      previewToken: 'preview-token',
      confirmationToken: 'confirmation-token',
      expiresAt: Date.now() + 60_000,
      workspaceRoot: 'C:\\Notes',
      files: [
        {
          ...file,
          matches: [{ ...match, replacementText: 'beta', selected: true }],
          selectedMatchCount: 1,
        },
      ],
      selectedFileCount: 1,
      selectedMatchCount: 1,
      totalContentMatchCount: 1,
      failures: [],
    };
    Object.defineProperty(window, 'markora', {
      configurable: true,
      value: {
        onWorkspaceSearchProgress: vi.fn(() => () => undefined),
        searchWorkspaceAdvanced: vi.fn(async () => searchResult),
        previewWorkspaceReplace: vi.fn(async () => preview),
        discardWorkspaceReplace: vi.fn(async () => true),
        cancelWorkspaceOperation: vi.fn(async () => undefined),
      },
    });
    const { container } = render(<WorkspaceSearchPanel workspaceRoot="C:\\Notes" onOpenResult={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Search workspace'), { target: { value: 'alpha' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('An alpha line');
    await expectNoAxeViolations(container);
    fireEvent.click(screen.getByRole('button', { name: 'Preview selected replacements' }));
    await screen.findByRole('heading', { name: 'Replace preview' });
    await expectNoAxeViolations(container);
    const trigger = screen.getByRole('button', { name: 'Apply preview…' });
    trigger.focus();
    fireEvent.click(trigger);
    const confirmation = await screen.findByRole('alertdialog', {
      name: 'Confirm workspace replacement',
    });
    expect(screen.getByRole('button', { name: 'Confirm, back up, and replace' })).toHaveFocus();
    await expectNoAxeViolations(confirmation);
  });

  it('labels the CodeMirror source editing surface', async () => {
    const { container } = render(
      <SourceEditor
        source="# Accessible"
        viewState={{ anchor: 0, head: 0, scrollTop: 0, scrollLeft: 0 }}
        onChange={vi.fn()}
        onViewStateChange={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Markdown source editor')).toBeInTheDocument());
    await expectNoAxeViolations(container);
  });

  it('labels the Tiptap surface and formatting toolbar', async () => {
    let handle: StructuredEditorHandle | null = null;
    const { container } = render(
      <StructuredEditor
        documentId="accessibility-document"
        source="Accessible text selection"
        viewState={{ anchor: 1, head: 1, scrollTop: 0, scrollLeft: 0 }}
        onChange={vi.fn()}
        onViewStateChange={vi.fn()}
        onHandle={(value) => {
          handle = value;
        }}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Structured Markdown editor')).toBeInTheDocument());
    await waitFor(() => expect(handle).not.toBeNull());
    act(() => {
      handle!.setTextSelection(1, 10);
    });
    expect(screen.getByRole('toolbar', { name: 'Structured editor formatting' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});

describe('built-in theme color contrast', () => {
  it.each(
    BUILT_IN_THEMES.flatMap((theme) => (['light', 'dark'] as const).map((mode) => [theme.id, mode] as const)),
  )('%s %s meets WCAG AA for normal text, muted text, links, and accent controls', (themeId, mode) => {
    const theme = BUILT_IN_THEMES.find((candidate) => candidate.id === themeId)!;
    const tokens = theme[mode];
    expect(meetsWcagAA(tokens.text, tokens.surface)).toBe(true);
    expect(meetsWcagAA(tokens.text, tokens.background)).toBe(true);
    expect(meetsWcagAA(tokens.mutedText, tokens.surface)).toBe(true);
    expect(meetsWcagAA(tokens.link, tokens.surface)).toBe(true);
    expect(meetsWcagAA(tokens.accentContrast, tokens.accent)).toBe(true);
  });

  it('calculates known WCAG reference ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 4);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.478, 2);
  });
});

describe('keyboard focus behavior', () => {
  it('traps recovery-center focus and restores the invoking control', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Restore session';
    document.body.append(trigger);
    trigger.focus();
    const props = {
      items: [],
      onRestore: vi.fn(),
      onDiscard: vi.fn(),
      onClose: vi.fn(),
    };
    const { rerender } = render(<RecoveryCenterDialog {...props} open />);
    const dialog = screen.getByRole('dialog', { name: 'Restore previous session' });
    const close = screen.getByRole('button', { name: 'Not now' });
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(close).toHaveFocus();
    rerender(<RecoveryCenterDialog {...props} open={false} />);
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('focuses and traps overwrite confirmation, then Escape returns to its trigger', async () => {
    const onClose = vi.fn();
    render(
      <ConflictDialog
        open
        conflict={{
          document: {
            id: 'document-1',
            path: 'C:\\Notes\\draft.md',
            name: 'draft.md',
            content: '# Editor',
            lineEnding: 'LF',
            mode: 'source',
            active: true,
            dirty: true,
          },
          result: {
            status: 'conflict',
            conflict: {
              kind: 'modified',
              path: 'C:\\Notes\\draft.md',
              expected: null,
              actual: null,
              disk: {
                path: 'C:\\Notes\\draft.md',
                name: 'draft.md',
                content: '# Disk',
                lineEnding: 'LF',
                modifiedAt: 2,
              },
            },
          },
        }}
        onResolve={vi.fn()}
        onClose={onClose}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Overwrite disk version…' });
    trigger.focus();
    fireEvent.click(trigger);
    const confirmation = screen.getByRole('alertdialog', { name: 'Confirm overwrite' });
    const confirm = screen.getByRole('button', { name: 'Confirm overwrite' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(confirm).toHaveFocus());
    cancel.focus();
    fireEvent.keyDown(confirmation, { key: 'Tab' });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirmation, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Overwrite disk version…' })).toHaveFocus(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('moves focus into HTML export and restores the invoking control when closed', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open HTML export';
    document.body.append(trigger);
    trigger.focus();
    const common = {
      defaultTitle: 'Accessible document',
      onClose: vi.fn(),
      onPreview: vi.fn(async () => ({
        html: '<p>Preview</p>',
        warnings: [],
        embeddedImageCount: 0,
        headingCount: 0,
        hasMath: false,
        hasMermaid: false,
      })),
      onExport: vi.fn(async () => null),
    };
    const { rerender } = render(<HtmlExportDialog {...common} open />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close HTML export' })).toHaveFocus());
    rerender(<HtmlExportDialog {...common} open={false} />);
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('moves focus into replace-all confirmation, traps Tab, and restores the trigger', async () => {
    render(
      <DocumentSearchPanel
        open
        initialReplaceMode
        documentText="alpha beta alpha"
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        onHighlightsChange={vi.fn()}
        onApplyReplacement={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('Find'), { target: { value: 'alpha' } });
    const trigger = screen.getByRole('button', { name: 'Replace all' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('alertdialog', { name: 'Confirm replace all' });
    const confirm = screen.getByRole('button', { name: 'Confirm replace all' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(confirm).toHaveFocus());
    cancel.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(trigger).toHaveFocus();
  });

  it('treats reset confirmation as a modal, traps focus, closes with Escape, and restores focus', async () => {
    const registry = new CommandRegistry<Record<string, never>>();
    registry.register({
      id: 'file.save',
      label: 'Save',
      category: 'File',
      handler: vi.fn(),
      enabled: true,
      defaultShortcut: 'Ctrl+S',
    });
    const manager = new ShortcutManager(registry, new MemoryShortcutPersistence());
    render(<ShortcutSettingsPanel manager={manager} />);
    const trigger = screen.getByRole('button', { name: 'Reset all' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('alertdialog', { name: 'Reset every shortcut?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancel).toHaveFocus());
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('supports arrow, Home, and End navigation within the structured formatting toolbar', async () => {
    let handle: StructuredEditorHandle | null = null;
    render(
      <StructuredEditor
        documentId="toolbar-navigation"
        source="Plain text"
        viewState={{ anchor: 1, head: 1, scrollTop: 0, scrollLeft: 0 }}
        onChange={vi.fn()}
        onViewStateChange={vi.fn()}
        onHandle={(value) => {
          handle = value;
        }}
      />,
    );
    await screen.findByLabelText('Structured Markdown editor');
    await waitFor(() => expect(handle).not.toBeNull());

    act(() => {
      handle!.setTextSelection(1, 5);
    });

    const toolbar = await screen.findByRole('toolbar', { name: 'Structured editor formatting' });
    const bold = screen.getByRole('button', { name: 'Bold' });
    bold.focus();
    expect(bold).toHaveFocus();

    fireEvent.keyDown(toolbar, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'Italic' })).toHaveFocus();

    fireEvent.keyDown(toolbar, { key: 'End' });
    expect(screen.getByRole('button', { name: 'Clear formatting' })).toHaveFocus();

    fireEvent.keyDown(toolbar, { key: 'Home' });
    expect(bold).toHaveFocus();
  });
});
