import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PdfExportProgressRecord, PdfExportResult } from '../../src/shared/contracts';
import { defaultPdfExportOptions } from '../../src/shared/pdf-options';
import {
  PdfExportDialog,
  type PdfExportApi,
  type PdfExportDialogProps,
} from '../../src/renderer/export/PdfExportDialog';
import type { PdfPresetStorage } from '../../src/renderer/export/pdf-presets';

afterEach(cleanup);

class MemoryStorage implements PdfPresetStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const documentRecord = {
  html: '<h1 id="hello">Hello</h1><p>World</p>',
  headings: [{ depth: 1 as const, id: 'hello', text: 'Hello' }],
  sourcePath: 'C:\\Docs\\hello.md',
};

const result: PdfExportResult = {
  operationId: 'pdf-test-result',
  outputPath: 'C:\\Exports\\hello.pdf',
  byteLength: 1_024,
  pageCount: 2,
  durationMs: 50,
  generatedTaggedPdf: true,
  generatedDocumentOutline: true,
};

function createApi(overrides: Partial<PdfExportApi> = {}): PdfExportApi {
  return {
    pickPdfOutput: vi.fn(async () => ({ path: result.outputPath, displayName: 'hello.pdf' })),
    previewPdf: vi.fn(async () => ({
      html: '<!doctype html><html><body><h1>Hello</h1></body></html>',
      pageWidthMm: 210,
      pageHeightMm: 297,
    })),
    exportPdf: vi.fn(async (request) => ({ ...result, operationId: request.operationId })),
    cancelPdf: vi.fn(async () => true),
    onPdfExportProgress: vi.fn(() => () => undefined),
    ...overrides,
  };
}

function createProps(overrides: Partial<PdfExportDialogProps> = {}): PdfExportDialogProps {
  return {
    open: true,
    document: documentRecord,
    initialOptions: { ...defaultPdfExportOptions, title: 'Hello' },
    api: createApi(),
    presetStorage: new MemoryStorage(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('PDF export dialog', () => {
  it('does not render when closed', () => {
    render(<PdfExportDialog {...createProps({ open: false })} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('exposes all primary page, metadata, theme, header, footer, and page-break controls', () => {
    render(<PdfExportDialog {...createProps()} />);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Export PDF');
    expect(screen.getByLabelText('Page size')).toHaveValue('A4');
    expect(screen.getByLabelText('Orientation')).toHaveValue('portrait');
    expect(screen.getByLabelText('Top margin (mm)')).toHaveValue(18);
    expect(screen.getByLabelText('Scale')).toHaveValue(1);
    expect(screen.getByLabelText('Title')).toHaveValue('Hello');
    expect(screen.getByLabelText('Print theme')).toHaveValue('document');
    expect(screen.getByLabelText('Page numbers')).toBeChecked();
    expect(screen.getByLabelText('Avoid page breaks inside tables')).toBeChecked();
    expect(screen.getByLabelText(/Generate tagged PDF/)).toBeChecked();
  });

  it('reveals and collects custom page dimensions', () => {
    render(<PdfExportDialog {...createProps()} />);
    fireEvent.change(screen.getByLabelText('Page size'), { target: { value: 'Custom' } });
    fireEvent.change(screen.getByLabelText('Custom width (mm)'), { target: { value: '220' } });
    fireEvent.change(screen.getByLabelText('Custom height (mm)'), { target: { value: '330' } });
    expect(screen.getByLabelText('Custom width (mm)')).toHaveValue(220);
    expect(screen.getByLabelText('Custom height (mm)')).toHaveValue(330);
  });

  it('requests a validated preview and displays it in a sandboxed frame', async () => {
    const api = createApi();
    render(<PdfExportDialog {...createProps({ api })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(api.previewPdf).toHaveBeenCalledWith(expect.objectContaining({
      document: documentRecord,
      options: expect.objectContaining({ title: 'Hello', pageSize: 'A4' }),
    })));
    const frame = screen.getByTitle('PDF preview');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame).toHaveAttribute('srcdoc', expect.stringContaining('<h1>Hello</h1>'));
    expect(screen.getByText('210.0 × 297.0 mm')).toBeInTheDocument();
  });

  it('selects a destination and exports with a typed operation request', async () => {
    const api = createApi();
    const onExported = vi.fn();
    render(<PdfExportDialog {...createProps({ api, onExported })} />);
    fireEvent.change(screen.getByLabelText('Author'), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF…' }));

    await waitFor(() => expect(api.pickPdfOutput).toHaveBeenCalledWith('Hello'));
    await waitFor(() => expect(api.exportPdf).toHaveBeenCalledWith(expect.objectContaining({
      operationId: expect.stringMatching(/^pdf-/),
      outputPath: result.outputPath,
      document: documentRecord,
      options: expect.objectContaining({ title: 'Hello', author: 'Ada' }),
    })));
    await waitFor(() => expect(onExported).toHaveBeenCalled());
    expect(screen.getByText(/Saved 2 pages/)).toHaveTextContent(result.outputPath);
  });

  it('saves, applies, and deletes a user named preset', () => {
    const storage = new MemoryStorage();
    render(<PdfExportDialog {...createProps({ presetStorage: storage })} />);
    fireEvent.change(screen.getByLabelText('Page size'), { target: { value: 'Legal' } });
    fireEvent.change(screen.getByLabelText('New preset name'), { target: { value: 'Legal review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));
    expect(screen.getByRole('option', { name: 'Legal review' })).toBeInTheDocument();
    expect((screen.getByLabelText('Preset') as HTMLSelectElement).value).toMatch(/^user-/);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('option', { name: 'Legal review' })).not.toBeInTheDocument();
  });

  it('announces preview failures without closing or writing a file', async () => {
    const api = createApi({ previewPdf: vi.fn(async () => { throw new Error('UNSAFE_PRINT_CSS: external URL rejected'); }) });
    render(<PdfExportDialog {...createProps({ api })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('external URL rejected');
    expect(api.exportPdf).not.toHaveBeenCalled();
  });

  it('subscribes to operation progress and cancels an active export with Escape', async () => {
    let progressListener: ((progress: PdfExportProgressRecord) => void) | undefined;
    let rejectExport: ((reason: Error) => void) | undefined;
    const api = createApi({
      onPdfExportProgress: vi.fn((listener) => {
        progressListener = listener;
        return () => undefined;
      }),
      exportPdf: vi.fn(() => new Promise<PdfExportResult>((_resolve, reject) => { rejectExport = reject; })),
      cancelPdf: vi.fn(async () => {
        rejectExport?.(new Error('CANCELLED: PDF export was cancelled.'));
        return true;
      }),
    });
    render(<PdfExportDialog {...createProps({ api })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF…' }));
    await screen.findByRole('button', { name: 'Cancel export' });
    const request = vi.mocked(api.exportPdf).mock.calls[0][0];
    progressListener?.({ operationId: request.operationId, stage: 'rendering', message: 'Rendering pages…' });
    await waitFor(() => expect(screen.getByText('Rendering pages…')).toBeInTheDocument());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(api.cancelPdf).toHaveBeenCalledWith(request.operationId));
    expect(await screen.findByRole('alert')).toHaveTextContent('cancelled');
  });

  it('closes with Escape when idle and restores prior focus', async () => {
    const before = document.createElement('button');
    before.textContent = 'Before';
    document.body.append(before);
    before.focus();
    const props = createProps();
    const view = render(<PdfExportDialog {...props} />);
    await waitFor(() => expect(screen.getByLabelText('Preset')).toHaveFocus());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalled();
    view.rerender(<PdfExportDialog {...props} open={false} />);
    expect(before).toHaveFocus();
    before.remove();
  });
});
