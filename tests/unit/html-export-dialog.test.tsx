import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { HtmlExportDialog } from '../../src/renderer/export/HtmlExportDialog';
import type { HtmlExportFileResult, HtmlExportOptions, HtmlExportResult } from '../../src/shared/html-export';

const previewResult: HtmlExportResult = {
  html: '<!doctype html><html><body><h1>Preview</h1></body></html>',
  warnings: [],
  embeddedImageCount: 2,
  headingCount: 4,
  hasMath: true,
  hasMermaid: false,
};

const fileResult: HtmlExportFileResult = {
  path: 'C:\\Exports\\document.html',
  warnings: [],
  embeddedImageCount: 2,
  headingCount: 4,
  hasMath: true,
  hasMermaid: false,
  byteLength: 500,
};

afterEach(cleanup);

function renderDialog(overrides: Partial<ComponentProps<typeof HtmlExportDialog>> = {}) {
  const props = {
    open: true,
    defaultTitle: 'Document',
    onClose: vi.fn(),
    onPreview: vi.fn<(_: HtmlExportOptions) => Promise<HtmlExportResult>>().mockResolvedValue(previewResult),
    onExport: vi
      .fn<(_: HtmlExportOptions) => Promise<HtmlExportFileResult | null>>()
      .mockResolvedValue(fileResult),
    ...overrides,
  };
  return { ...render(<HtmlExportDialog {...props} />), props };
}

describe('HTML export dialog', () => {
  it('does not render while closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('exposes all required export controls with accessible labels', () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: 'Export HTML' })).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Document');
    expect(screen.getByLabelText('Output')).toHaveValue('standalone');
    expect(screen.getByLabelText('Styling')).toHaveValue('styled');
    expect(screen.getByLabelText('Theme')).toHaveValue('markora-light');
    expect(screen.getByLabelText('Embed CSS')).toBeChecked();
    expect(screen.getByLabelText('Embed local images')).not.toBeChecked();
    expect(screen.getByLabelText('Table of contents')).not.toBeChecked();
    expect(screen.getByLabelText('Syntax highlighting')).toBeChecked();
    expect(screen.getByLabelText('Render KaTeX math')).toBeChecked();
    expect(screen.getByLabelText('Render Mermaid diagrams')).toBeChecked();
  });

  it('passes edited metadata and options to preview', async () => {
    const { props } = renderDialog();
    fireEvent.change(screen.getByLabelText('Author'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'github-dark' } });
    fireEvent.click(screen.getByLabelText('Embed local images'));
    fireEvent.click(screen.getByLabelText('Table of contents'));
    fireEvent.click(screen.getByRole('button', { name: 'Generate preview' }));

    await waitFor(() => expect(props.onPreview).toHaveBeenCalledTimes(1));
    expect(props.onPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: 'github-dark',
        embedLocalImages: true,
        includeTableOfContents: true,
        metadata: expect.objectContaining({ title: 'Document', author: 'Ada' }),
      }),
    );
    expect(screen.getByTitle('HTML export preview')).toHaveAttribute('sandbox', 'allow-scripts');
    expect(screen.getByTitle('HTML export preview')).toHaveAttribute('srcdoc', previewResult.html);
    expect(screen.getByText(/4 headings/)).toBeInTheDocument();
  });

  it('invalidates a preview when an option changes', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Generate preview' }));
    await screen.findByTitle('HTML export preview');
    fireEvent.click(screen.getByLabelText('Embed local images'));
    expect(screen.queryByTitle('HTML export preview')).not.toBeInTheDocument();
  });

  it('exports with the selected settings and announces the destination', async () => {
    const { props } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Export HTML…' }));
    await waitFor(() => expect(props.onExport).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Exported to/)).toHaveTextContent('C:\\Exports\\document.html');
  });

  it('displays preview warnings without hiding the preview', async () => {
    renderDialog({
      onPreview: vi.fn().mockResolvedValue({
        ...previewResult,
        warnings: [{ code: 'IMAGE_NOT_FOUND', message: 'Image missing', source: 'missing.png' }],
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate preview' }));
    expect(await screen.findByText('Export warnings')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Export warnings'));
    expect(screen.getByText('Image missing (missing.png)')).toBeInTheDocument();
  });

  it('announces generation errors', async () => {
    renderDialog({ onPreview: vi.fn().mockRejectedValue(new Error('Preview failed safely')) });
    fireEvent.click(screen.getByRole('button', { name: 'Generate preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Preview failed safely');
  });

  it('closes with Escape and restores focus responsibility to its caller', () => {
    const { props } = renderDialog();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
