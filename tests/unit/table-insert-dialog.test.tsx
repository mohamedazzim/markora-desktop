import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TableInsertDialog } from '../../src/renderer/editor/TableInsertDialog';

afterEach(cleanup);

describe('TableInsertDialog', () => {
  it('submits validated row and column counts', () => {
    const insert = vi.fn();
    render(<TableInsertDialog open onInsert={insert} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Rows'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Columns'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert table' }));
    expect(insert).toHaveBeenCalledWith(4, 2);
  });

  it('reports invalid dimensions without submitting', () => {
    const insert = vi.fn();
    render(<TableInsertDialog open onInsert={insert} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Rows'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert table' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Rows must be a whole number from 2 to 50.');
    expect(insert).not.toHaveBeenCalled();
  });

  it('closes with Escape and exposes modal dialog semantics', () => {
    const close = vi.fn();
    render(<TableInsertDialog open onInsert={vi.fn()} onClose={close} />);
    const dialog = screen.getByRole('dialog', { name: 'Insert table' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });
});
