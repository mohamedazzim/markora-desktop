import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppearancePanel, type AppearancePanelProps } from '../../src/renderer/appearance/AppearancePanel';
import {
  createDefaultAppearanceSettings,
  exportAppearanceSettings,
} from '../../src/renderer/appearance/appearance-settings';

afterEach(cleanup);

function createProps(overrides: Partial<AppearancePanelProps> = {}): AppearancePanelProps {
  return {
    open: true,
    settings: createDefaultAppearanceSettings(),
    prefersDark: false,
    onChange: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('appearance panel accessibility', () => {
  it('does not render while closed, focuses the first setting, and restores focus', async () => {
    const before = document.createElement('button');
    before.textContent = 'Before';
    document.body.append(before);
    before.focus();
    const props = createProps({ open: false });
    const { rerender } = render(<AppearancePanel {...props} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(<AppearancePanel {...props} open />);
    await waitFor(() => expect(screen.getByLabelText('Color mode')).toHaveFocus());
    rerender(<AppearancePanel {...props} open={false} />);
    expect(before).toHaveFocus();
    before.remove();
  });

  it('traps visible Tab navigation and closes with Escape', () => {
    const onClose = vi.fn();
    render(<AppearancePanel {...createProps({ onClose })} />);
    const dialog = screen.getByRole('dialog');
    const close = screen.getByRole('button', { name: 'Close appearance settings' });
    const lastVisible = screen.getByText('Custom CSS and portability');
    lastVisible.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('provides nine accessible theme preview choices', () => {
    render(<AppearancePanel {...createProps()} />);
    expect(
      screen.getAllByRole('radio', { name: /Markora/ }),
    ).toHaveLength(9);
  });
});

describe('writing mode controls', () => {
  it('emits Focus, Typewriter, Zen, wrap, and scroll settings', () => {
    const onChange = vi.fn();
    render(<AppearancePanel {...createProps({ onChange })} />);

    fireEvent.click(screen.getByRole('checkbox', { name: /Focus Mode/ }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ writing: expect.objectContaining({ focusMode: true }) }),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Typewriter Mode/ }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ writing: expect.objectContaining({ typewriterMode: true }) }),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Zen Mode/ }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ writing: expect.objectContaining({ zenMode: true }) }),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Scroll past end' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ writing: expect.objectContaining({ scrollPastEnd: true }) }),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Word wrap' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ writing: expect.objectContaining({ wordWrap: false }) }),
    );
  });

  it('requests native fullscreen through a typed parent callback', () => {
    const onChange = vi.fn();
    const onFullscreenChange = vi.fn();
    render(<AppearancePanel {...createProps({ onChange, onFullscreenChange })} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Full screen/ }));
    expect(onFullscreenChange).toHaveBeenCalledWith(true);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ writing: expect.objectContaining({ fullscreen: true }) }),
    );
  });

  it('configures every Zen visibility flag when Zen Mode is enabled', () => {
    const defaults = createDefaultAppearanceSettings();
    const settings = {
      ...defaults,
      writing: { ...defaults.writing, zenMode: true },
    };
    const onChange = vi.fn();
    render(<AppearancePanel {...createProps({ settings, onChange })} />);
    const labels = ['Workspace sidebar', 'Outline sidebar', 'Toolbar', 'Tab bar', 'Status bar'];
    for (const label of labels) expect(screen.getByRole('checkbox', { name: label })).toBeEnabled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Toolbar' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        writing: expect.objectContaining({
          zenHidden: expect.objectContaining({ toolbar: false }),
        }),
      }),
    );
  });

  it('updates editor and content width controls', () => {
    const onChange = vi.fn();
    render(<AppearancePanel {...createProps({ onChange })} />);
    fireEvent.change(screen.getByLabelText('Editor width (px)'), { target: { value: '1440' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ writing: expect.objectContaining({ editorWidth: 1440 }) }),
    );
    fireEvent.change(screen.getByLabelText('Content width (px)'), { target: { value: '900' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ writing: expect.objectContaining({ contentWidth: 900 }) }),
    );
  });
});

describe('theme and typography controls', () => {
  it('changes color, built-in, source, code, and Mermaid themes', () => {
    const onChange = vi.fn();
    render(<AppearancePanel {...createProps({ onChange })} />);
    fireEvent.change(screen.getByLabelText('Color mode'), { target: { value: 'dark' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: expect.objectContaining({ colorMode: 'dark' }) }),
    );
    fireEvent.click(screen.getByRole('radio', { name: /Forest/ }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: expect.objectContaining({ builtInTheme: 'forest' }) }),
    );
    fireEvent.change(screen.getByLabelText('Source editor theme'), {
      target: { value: 'dracula' },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: expect.objectContaining({ sourceTheme: 'dracula' }) }),
    );
    fireEvent.change(screen.getByLabelText('Code-block theme'), {
      target: { value: 'monokai' },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: expect.objectContaining({ codeTheme: 'monokai' }) }),
    );
    fireEvent.change(screen.getByLabelText('Mermaid theme'), { target: { value: 'forest' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: expect.objectContaining({ mermaidTheme: 'forest' }) }),
    );
  });

  it('exposes typography, spacing, padding, and element appearance controls', () => {
    const onChange = vi.fn();
    render(<AppearancePanel {...createProps({ onChange })} />);
    fireEvent.click(screen.getByText('Typography and elements'));

    fireEvent.change(screen.getByLabelText('Editor font'), { target: { value: 'Aptos' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ typography: expect.objectContaining({ editorFont: 'Aptos' }) }),
    );
    fireEvent.change(screen.getByLabelText('Font size (px)'), { target: { value: '20' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ typography: expect.objectContaining({ fontSize: 20 }) }),
    );
    fireEvent.change(screen.getByLabelText('Paragraph spacing (px)'), { target: { value: '24' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ typography: expect.objectContaining({ paragraphSpacing: 24 }) }),
    );
    fireEvent.change(screen.getByLabelText('Table appearance'), { target: { value: 'striped' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ elements: expect.objectContaining({ tables: 'striped' }) }),
    );
    fireEvent.change(screen.getByLabelText('Code-block appearance'), {
      target: { value: 'elevated' },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ elements: expect.objectContaining({ codeBlocks: 'elevated' }) }),
    );
  });
});

describe('custom CSS and portable themes', () => {
  it('scopes safe CSS before emitting it', () => {
    const onChange = vi.fn();
    render(<AppearancePanel {...createProps({ onChange })} />);
    fireEvent.click(screen.getByText('Custom CSS and portability'));
    fireEvent.change(screen.getByLabelText('Editor custom CSS'), {
      target: { value: 'p { color: rebeccapurple; }' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validate and apply CSS' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: expect.objectContaining({
          customCss: expect.stringContaining('.structured-prosemirror p'),
        }),
      }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('validated, scoped, and applied');
  });

  it('rejects unsafe CSS without updating appearance state', () => {
    const onChange = vi.fn();
    render(<AppearancePanel {...createProps({ onChange })} />);
    fireEvent.click(screen.getByText('Custom CSS and portability'));
    fireEvent.change(screen.getByLabelText('Editor custom CSS'), {
      target: { value: 'p { background: url(https://example.com/track); }' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validate and apply CSS' }));
    expect(screen.getByRole('alert')).toHaveTextContent('forbidden');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('imports through validation and exports versioned serialized settings', async () => {
    const defaults = createDefaultAppearanceSettings();
    const imported = {
      ...defaults,
      theme: { ...defaults.theme, builtInTheme: 'paper' as const },
    };
    const onChange = vi.fn();
    const onRequestImport = vi.fn(async () => exportAppearanceSettings(imported));
    const onRequestExport = vi.fn(async (serializedSettings: string) => {
      void serializedSettings;
    });
    render(
      <AppearancePanel
        {...createProps({ settings: imported, onChange, onRequestImport, onRequestExport })}
      />,
    );
    fireEvent.click(screen.getByText('Custom CSS and portability'));
    fireEvent.click(screen.getByRole('button', { name: 'Import theme…' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(imported));
    expect(screen.getByRole('status')).toHaveTextContent('imported');

    fireEvent.click(screen.getByRole('button', { name: 'Export theme…' }));
    await waitFor(() => expect(onRequestExport).toHaveBeenCalledOnce());
    const serialized = onRequestExport.mock.calls[0][0];
    expect(JSON.parse(serialized)).toMatchObject({ version: 2, theme: { builtInTheme: 'paper' } });
  });

  it('reports picker failures and resets all appearance settings', async () => {
    const defaults = createDefaultAppearanceSettings();
    const settings = {
      ...defaults,
      writing: { ...defaults.writing, focusMode: true, fullscreen: true },
    };
    const onChange = vi.fn();
    const onFullscreenChange = vi.fn();
    render(
      <AppearancePanel
        {...createProps({
          settings,
          onChange,
          onFullscreenChange,
          onRequestImport: vi.fn(async () => {
            throw new Error('Theme picker failed');
          }),
        })}
      />,
    );
    fireEvent.click(screen.getByText('Custom CSS and portability'));
    fireEvent.click(screen.getByRole('button', { name: 'Import theme…' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Theme picker failed');

    fireEvent.click(screen.getByRole('button', { name: 'Reset appearance' }));
    expect(onChange).toHaveBeenLastCalledWith(defaults);
    expect(onFullscreenChange).toHaveBeenLastCalledWith(false);
  });
});
