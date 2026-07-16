import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PandocDialog,
  type PandocDialogProps,
  type PandocStatus,
} from '../../src/renderer/pandoc/PandocDialog';

afterEach(cleanup);

const availableStatus: PandocStatus = {
  availability: 'available',
  executablePath: 'C:\\Program Files\\Pandoc\\pandoc.exe',
  version: '3.7.0',
  detection: 'path',
};

function createProps(overrides: Partial<PandocDialogProps> = {}): PandocDialogProps {
  return {
    open: true,
    status: availableStatus,
    conversion: { state: 'idle' },
    onChooseExecutable: vi.fn(async () => null),
    onChooseInput: vi.fn(async () => null),
    onChooseOutput: vi.fn(async () => null),
    onRequestImportPreview: vi.fn(async () => ({ ok: true as const, markdown: '# Preview\n' })),
    onConvert: vi.fn(),
    onCancelConversion: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('Pandoc status and configuration', () => {
  it('does not render dialog content while closed', () => {
    render(<PandocDialog {...createProps({ open: false })} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows detected version, executable, presets, and all export formats', () => {
    render(<PandocDialog {...createProps()} />);

    expect(screen.getByText('Pandoc 3.7.0 is available')).toBeInTheDocument();
    expect(screen.getByText('C:\\Program Files\\Pandoc\\pandoc.exe')).toBeInTheDocument();
    expect(screen.getByLabelText('Export preset')).toHaveDisplayValue('Custom settings');
    expect(screen.getByLabelText('Export format').querySelectorAll('option')).toHaveLength(7);
    expect(screen.getByRole('option', { name: 'Standard Word document' })).toBeInTheDocument();
  });

  it('accepts a manually selected and validated executable through the typed callback', async () => {
    const manualStatus: PandocStatus = {
      availability: 'available',
      executablePath: 'D:\\Tools\\pandoc.exe',
      version: '3.6.4',
      detection: 'manual',
    };
    const onChooseExecutable = vi.fn(async () => manualStatus);
    const onExecutableSelected = vi.fn();
    render(
      <PandocDialog
        {...createProps({
          status: { availability: 'missing', detection: 'none', message: 'Not on PATH.' },
          onChooseExecutable,
          onExecutableSelected,
        })}
      />,
    );

    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Select executable…' }));

    await waitFor(() => expect(screen.getByText('Pandoc 3.6.4 is available')).toBeInTheDocument());
    expect(screen.getByText('D:\\Tools\\pandoc.exe')).toBeInTheDocument();
    expect(onExecutableSelected).toHaveBeenCalledWith(manualStatus);
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
  });

  it('surfaces executable-picker failures without losing dialog state', async () => {
    render(
      <PandocDialog
        {...createProps({
          onChooseExecutable: vi.fn(async () => {
            throw new Error('Executable picker unavailable');
          }),
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select executable…' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Executable picker unavailable');
    expect(screen.getByText('Pandoc 3.7.0 is available')).toBeInTheDocument();
  });
});

describe('Pandoc export', () => {
  it('collects an export format, output path, and preset into a typed request', async () => {
    const onChooseOutput = vi.fn(async () => ({
      path: 'C:\\Exports\\book.epub',
      displayName: 'book.epub',
    }));
    const onConvert = vi.fn();
    render(<PandocDialog {...createProps({ onChooseOutput, onConvert })} />);

    fireEvent.change(screen.getByLabelText('Export preset'), { target: { value: 'ebook-epub' } });
    expect(screen.getByLabelText('Export format')).toHaveValue('epub');
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }));
    await waitFor(() => expect(screen.getByLabelText('Output file')).toHaveValue('book.epub'));
    expect(onChooseOutput).toHaveBeenCalledWith('epub');

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(onConvert).toHaveBeenCalledWith({
      operation: 'export',
      executablePath: 'C:\\Program Files\\Pandoc\\pandoc.exe',
      format: 'epub',
      outputPath: 'C:\\Exports\\book.epub',
      presetId: 'ebook-epub',
    });
  });

  it('requires an output selection before emitting an export request', () => {
    const onConvert = vi.fn();
    render(<PandocDialog {...createProps({ onConvert })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Choose an output file');
    expect(onConvert).not.toHaveBeenCalled();
  });
});

describe('Pandoc import and preview', () => {
  it('selects input, renders a Markdown preview, and emits an import request', async () => {
    const onChooseInput = vi.fn(async () => ({
      path: 'C:\\Documents\\source.html',
      displayName: 'source.html',
    }));
    const onRequestImportPreview = vi.fn(async () => ({
      ok: true as const,
      markdown: '# Imported\n\nContent.\n',
      warnings: ['One unsupported style was omitted.'],
      stderr: '',
    }));
    const onConvert = vi.fn();
    render(<PandocDialog {...createProps({ onChooseInput, onRequestImportPreview, onConvert })} />);

    fireEvent.click(screen.getByLabelText('Import document'));
    fireEvent.change(screen.getByLabelText('Import format'), { target: { value: 'html' } });
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }));
    await waitFor(() => expect(screen.getByLabelText('Input file')).toHaveValue('source.html'));
    expect(onChooseInput).toHaveBeenCalledWith('html');

    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Imported Markdown preview')).toHaveValue('# Imported\n\nContent.\n'),
    );
    expect(screen.getByLabelText('Import warnings')).toHaveTextContent('unsupported style');
    expect(onRequestImportPreview).toHaveBeenCalledWith({
      operation: 'import',
      executablePath: 'C:\\Program Files\\Pandoc\\pandoc.exe',
      format: 'html',
      inputPath: 'C:\\Documents\\source.html',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onConvert).toHaveBeenCalledWith({
      operation: 'import',
      executablePath: 'C:\\Program Files\\Pandoc\\pandoc.exe',
      format: 'html',
      inputPath: 'C:\\Documents\\source.html',
    });
  });

  it('renders detailed preview conversion failures', async () => {
    const onChooseInput = vi.fn(async () => ({ path: 'bad.docx', displayName: 'bad.docx' }));
    const onRequestImportPreview = vi.fn(async () => ({
      ok: false as const,
      error: {
        message: 'Preview conversion failed',
        exitCode: 7,
        stderr: 'Could not parse document',
        stdout: 'Pandoc diagnostic header',
      },
    }));
    render(
      <PandocDialog
        {...createProps({ onChooseInput, onRequestImportPreview, initialOperation: 'import' })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }));
    await waitFor(() => expect(screen.getByLabelText('Input file')).toHaveValue('bad.docx'));
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));

    expect(await screen.findByText('Preview conversion failed')).toBeInTheDocument();
    expect(screen.getByText('Could not parse document')).toBeInTheDocument();
    expect(screen.getByText('Pandoc diagnostic header')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });
});

describe('Pandoc progress and diagnostics', () => {
  it('announces progress and supports button and Escape cancellation', () => {
    const onCancelConversion = vi.fn();
    const onClose = vi.fn();
    render(
      <PandocDialog
        {...createProps({
          conversion: {
            state: 'running',
            phase: 'converting',
            message: 'Converting document…',
            percent: 42,
            cancellable: true,
          },
          onCancelConversion,
          onClose,
        })}
      />,
    );

    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '42');
    expect(screen.getByText('Converting document…')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel conversion' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancelConversion).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows captured stderr, stdout, exit code, and timeout state', () => {
    render(
      <PandocDialog
        {...createProps({
          conversion: {
            state: 'failed',
            error: {
              message: 'Pandoc exited unsuccessfully',
              exitCode: 23,
              timedOut: true,
              stderr: 'fatal conversion error',
              stdout: 'partial output',
            },
          },
        })}
      />,
    );

    expect(screen.getByText('Pandoc exited unsuccessfully')).toBeInTheDocument();
    expect(screen.getByText('23')).toBeInTheDocument();
    expect(screen.getByText(/exceeded its configured time limit/)).toBeInTheDocument();
    expect(screen.getByText('fatal conversion error')).toBeInTheDocument();
    expect(screen.getByText('partial output')).toBeInTheDocument();
  });
});

describe('Pandoc dialog keyboard accessibility', () => {
  it('moves initial focus into the dialog and restores it when closed', async () => {
    const before = document.createElement('button');
    before.textContent = 'Before dialog';
    document.body.append(before);
    before.focus();
    const props = createProps();
    const { rerender } = render(<PandocDialog {...props} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Select executable…' })).toHaveFocus());
    rerender(<PandocDialog {...props} open={false} />);
    expect(before).toHaveFocus();
    before.remove();
  });

  it('traps Tab navigation and closes with Escape while idle', () => {
    const onClose = vi.fn();
    render(<PandocDialog {...createProps({ onClose })} />);
    const dialog = screen.getByRole('dialog');
    const close = screen.getByRole('button', { name: 'Close Pandoc dialog' });
    const submit = screen.getByRole('button', { name: 'Export' });

    submit.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
