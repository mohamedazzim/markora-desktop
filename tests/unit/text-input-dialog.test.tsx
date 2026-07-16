import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextInputDialog, validateLinkDestination } from '../../src/renderer/editor/TextInputDialog';

afterEach(cleanup);

const renderDialog = (overrides: Partial<ComponentProps<typeof TextInputDialog>> = {}) => {
  const submit = vi.fn();
  const close = vi.fn();
  render(
    <TextInputDialog
      open
      title="Edit value"
      description="Enter a value."
      label="Value"
      submitLabel="Apply"
      onSubmit={submit}
      onClose={close}
      {...overrides}
    />,
  );
  return { close, submit };
};

describe('TextInputDialog', () => {
  it('trims and submits a non-empty value', () => {
    const { submit } = renderDialog({ initialValue: ' old ' });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '  updated  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(submit).toHaveBeenCalledWith('updated');
  });

  it('announces validation errors and supports explicitly empty values', () => {
    const first = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Value is required.');
    expect(first.submit).not.toHaveBeenCalled();
    cleanup();
    const second = renderDialog({ allowEmpty: true });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(second.submit).toHaveBeenCalledWith('');
  });

  it('is modal and closes with Escape', () => {
    const { close } = renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Edit value' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('focuses the destination field and validates unsafe link schemes', async () => {
    renderDialog({
      title: 'Edit link',
      label: 'Link destination',
      validate: validateLinkDestination,
      allowEmpty: true,
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(document.activeElement).toBe(screen.getByLabelText('Link destination'));
    fireEvent.change(screen.getByLabelText('Link destination'), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert')).toHaveTextContent('This link scheme is not allowed.');
    expect(validateLinkDestination('#heading')).toBeUndefined();
    expect(validateLinkDestination('mailto:writer@example.com')).toBeUndefined();
    expect(validateLinkDestination('data:text/html,unsafe')).toMatch(/not allowed/i);
  });

  it('offers an explicit remove action for existing links', () => {
    const remove = vi.fn();
    renderDialog({ title: 'Edit link', onRemove: remove });
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    expect(remove).toHaveBeenCalledOnce();
  });
});
