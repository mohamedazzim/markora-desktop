import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { ThemeGallery } from '../../src/renderer/appearance/ThemeGallery';
import { createDefaultAppearanceSettings } from '../../src/renderer/appearance/appearance-settings';
import type { CustomThemeRecord } from '../../src/shared/contracts';

afterEach(cleanup);

const customTheme: CustomThemeRecord = {
  version: 1,
  id: 'custom-11111111-1111-4111-8111-111111111111',
  name: 'Writer Blue',
  description: 'A calm blue drafting surface.',
  light: {
    background: '#eef4ff', panel: '#dce8ff', surface: '#ffffff', text: '#102040', mutedText: '#405070',
    border: '#b8c8e8', accent: '#2457c5', accentContrast: '#ffffff', codeBackground: '#e8efff', selection: '#c8d9ff',
    link: '#2457c5', blockquote: '#405070', tableStripe: '#eef4ff',
  },
  dark: {
    background: '#10192b', panel: '#182641', surface: '#132039', text: '#edf3ff', mutedText: '#aabbdc',
    border: '#30476f', accent: '#8db0ff', accentContrast: '#102040', codeBackground: '#182641', selection: '#294b8f',
    link: '#9ab8ff', blockquote: '#aabbdc', tableStripe: '#182641',
  },
  updatedAt: 1,
};

function renderGallery(overrides: Partial<ComponentProps<typeof ThemeGallery>> = {}) {
  const settings = createDefaultAppearanceSettings();
  return render(
    <ThemeGallery
      settings={settings}
      prefersDark={false}
      customThemes={[customTheme]}
      onChange={vi.fn()}
      onImport={vi.fn(async () => null)}
      onDuplicate={vi.fn(async () => customTheme)}
      onDelete={vi.fn(async () => undefined)}
      onExport={vi.fn(async () => true)}
      onSave={vi.fn(async (theme) => ({ ...customTheme, ...theme }))}
      {...overrides}
    />,
  );
}

describe('ThemeGallery', () => {
  it('switches between interface and document scopes and selects a custom theme', () => {
    const onChange = vi.fn();
    renderGallery({ onChange });
    fireEvent.click(screen.getByRole('button', { name: 'Document' }));
    fireEvent.click(screen.getByRole('button', { name: /Writer Blue/ }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      theme: expect.objectContaining({ documentThemeId: customTheme.id, documentTheme: customTheme.id }),
    }));
  });

  it('exposes import, duplicate, export, delete, and edit actions', async () => {
    const onDuplicate = vi.fn(async () => customTheme);
    const onExport = vi.fn(async () => true);
    const onDelete = vi.fn(async () => undefined);
    renderGallery({ onDuplicate, onExport, onDelete });
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(onDuplicate).toHaveBeenCalledWith(customTheme.id));
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(onExport).toHaveBeenCalledWith(customTheme.id));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(customTheme.id));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('heading', { name: 'Edit custom theme' })).toBeInTheDocument();
  });

  it('imports a custom package through the parent-owned operation', () => {
    const onImport = vi.fn(async () => customTheme);
    renderGallery({ onImport });
    fireEvent.click(screen.getByRole('button', { name: /Import custom theme/ }));
    expect(onImport).toHaveBeenCalledOnce();
  });
});
