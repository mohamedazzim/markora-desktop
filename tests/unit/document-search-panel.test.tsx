import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DocumentSearchPanel,
  type DocumentSearchPanelProps,
} from '../../src/renderer/search/DocumentSearchPanel';

afterEach(cleanup);

function createProps(overrides: Partial<DocumentSearchPanelProps> = {}): DocumentSearchPanelProps {
  return {
    open: true,
    documentText: 'cat Cat scatter cat',
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    onHighlightsChange: vi.fn(),
    onApplyReplacement: vi.fn(),
    ...overrides,
  };
}

describe('document search panel', () => {
  it('does not render while closed and focuses Find when opened', () => {
    const props = createProps({ open: false });
    const { rerender } = render(<DocumentSearchPanel {...props} />);
    expect(screen.queryByRole('search')).not.toBeInTheDocument();

    rerender(<DocumentSearchPanel {...props} open />);
    expect(screen.getByLabelText('Find')).toHaveFocus();
  });

  it('clears editor highlight data when the panel closes', async () => {
    const onHighlightsChange = vi.fn();
    const props = createProps({ onHighlightsChange });
    const { rerender } = render(<DocumentSearchPanel {...props} />);
    fireEvent.change(screen.getByLabelText('Find'), { target: { value: 'cat' } });
    await waitFor(() => expect(onHighlightsChange.mock.calls.at(-1)?.[0].matches).toHaveLength(4));

    rerender(<DocumentSearchPanel {...props} open={false} />);
    expect(onHighlightsChange.mock.calls.at(-1)?.[0]).toMatchObject({
      query: '',
      matches: [],
      activeIndex: -1,
    });
  });

  it('publishes canonical highlight ranges and a live match count', async () => {
    const onHighlightsChange = vi.fn();
    render(<DocumentSearchPanel {...createProps({ onHighlightsChange })} />);
    fireEvent.change(screen.getByLabelText('Find'), { target: { value: 'cat' } });

    await waitFor(() => {
      const last = onHighlightsChange.mock.calls.at(-1)?.[0];
      expect(last.matches.map((match: { start: number }) => match.start)).toEqual([0, 4, 9, 16]);
    });
    expect(screen.getByRole('status')).toHaveTextContent('4 matches');
  });

  it('navigates with Enter, Shift+Enter, buttons, and wrapping metadata', async () => {
    const onNavigate = vi.fn();
    render(<DocumentSearchPanel {...createProps({ documentText: 'cat cat', onNavigate })} />);
    const find = screen.getByLabelText('Find');
    fireEvent.change(find, { target: { value: 'cat' } });
    fireEvent.keyDown(find, { key: 'Enter' });
    fireEvent.keyDown(find, { key: 'Enter' });
    fireEvent.keyDown(find, { key: 'Enter' });

    expect(onNavigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ index: 0, direction: 'next', wrapped: true }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('1 of 2, wrapped');

    fireEvent.keyDown(find, { key: 'Enter', shiftKey: true });
    expect(onNavigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ index: 1, direction: 'previous', wrapped: true }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }));
    expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ index: 0, direction: 'previous' }));
  });

  it('supports case, whole-word, regex, and selection toggles', async () => {
    render(
      <DocumentSearchPanel
        {...createProps({ documentText: 'Cat cat scatter cat', selection: { start: 4, end: 7 } })}
      />,
    );
    fireEvent.change(screen.getByLabelText('Find'), { target: { value: 'cat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Match case' }));
    fireEvent.click(screen.getByRole('button', { name: 'Match whole word' }));
    expect(screen.getByRole('button', { name: 'Match case' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('2 matches');

    fireEvent.click(screen.getByRole('button', { name: 'Search in selection' }));
    expect(screen.getByRole('status')).toHaveTextContent('1 match');

    fireEvent.click(screen.getByRole('button', { name: 'Use regular expression' }));
    fireEvent.change(screen.getByLabelText('Find'), { target: { value: '^cat$' } });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 match'));
  });

  it('shows invalid regular expressions without disabling Escape close', () => {
    const onClose = vi.fn();
    render(<DocumentSearchPanel {...createProps({ onClose })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use regular expression' }));
    fireEvent.change(screen.getByLabelText('Find'), { target: { value: '[' } });

    expect(screen.getByRole('status')).toHaveTextContent(/regular expression|unterminated|invalid/i);
    fireEvent.keyDown(screen.getByRole('search'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('disables selection search until a non-collapsed selection exists', () => {
    const { rerender } = render(<DocumentSearchPanel {...createProps()} />);
    expect(screen.getByRole('button', { name: 'Search in selection' })).toBeDisabled();
    rerender(<DocumentSearchPanel {...createProps({ selection: { start: 0, end: 3 } })} />);
    expect(screen.getByRole('button', { name: 'Search in selection' })).toBeEnabled();
  });

  it('keeps the captured selection scope stable while match navigation changes the editor selection', () => {
    const props = createProps({ documentText: 'cat x cat', selection: { start: 0, end: 9 } });
    const { rerender } = render(<DocumentSearchPanel {...props} />);
    fireEvent.change(screen.getByLabelText('Find'), { target: { value: 'cat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search in selection' }));
    expect(screen.getByRole('status')).toHaveTextContent('2 matches');

    fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
    rerender(<DocumentSearchPanel {...props} selection={{ start: 0, end: 3 }} />);
    expect(screen.getByRole('status')).toHaveTextContent('1 of 2');

    fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
    expect(screen.getByRole('status')).toHaveTextContent('2 of 2');
  });
});

describe('document replacement panel', () => {
  it('emits a one-match replacement transaction', () => {
    const onApplyReplacement = vi.fn();
    render(
      <DocumentSearchPanel
        {...createProps({
          documentText: 'cat cat',
          initialReplaceMode: true,
          onApplyReplacement,
        })}
      />,
    );
    fireEvent.change(screen.getByLabelText('Find'), { target: { value: 'cat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
    fireEvent.change(screen.getByLabelText('Replace'), { target: { value: 'dog' } });
    expect(screen.getByRole('status')).toHaveTextContent('1 of 2');
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));

    expect(onApplyReplacement).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'replace-one', text: 'dog cat', replacedCount: 1 }),
    );
  });

  it('requires an explicit replace-all confirmation and includes metadata', () => {
    const onApplyReplacement = vi.fn();
    render(
      <DocumentSearchPanel
        {...createProps({
          documentText: 'cat cat',
          initialReplaceMode: true,
          onApplyReplacement,
        })}
      />,
    );
    fireEvent.change(screen.getByLabelText('Find'), { target: { value: 'cat' } });
    fireEvent.change(screen.getByLabelText('Replace'), { target: { value: 'dog' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace all' }));

    expect(screen.getByRole('alertdialog', { name: 'Confirm replace all' })).toHaveTextContent(
      'Replace 2 matches?',
    );
    expect(onApplyReplacement).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm replace all' }));
    expect(onApplyReplacement).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'replace-all',
        text: 'dog dog',
        replacedCount: 2,
        confirmation: expect.objectContaining({
          query: 'cat',
          replacement: 'dog',
          matchCount: 2,
        }),
      }),
    );
  });

  it('reports zero-width matches during confirmation', () => {
    render(<DocumentSearchPanel {...createProps({ documentText: 'ab', initialReplaceMode: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use regular expression' }));
    fireEvent.change(screen.getByLabelText('Find'), { target: { value: '^|$' } });
    fireEvent.change(screen.getByLabelText('Replace'), { target: { value: '|' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace all' }));
    expect(screen.getByRole('alertdialog', { name: 'Confirm replace all' })).toHaveTextContent(
      '2 zero-width matches',
    );
  });

  it('uses Escape to cancel confirmation before closing the panel', () => {
    const onClose = vi.fn();
    render(
      <DocumentSearchPanel {...createProps({ documentText: 'cat', initialReplaceMode: true, onClose })} />,
    );
    fireEvent.change(screen.getByLabelText('Find'), { target: { value: 'cat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace all' }));
    const panel = screen.getByRole('search');
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('document search history UI', () => {
  it('records a search and restores its query and options', async () => {
    render(<DocumentSearchPanel {...createProps({ documentText: 'cat Cat' })} />);
    const find = screen.getByLabelText('Find');
    fireEvent.change(find, { target: { value: 'cat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Match case' }));
    fireEvent.keyDown(find, { key: 'Enter' });

    const history = screen.getByLabelText('Search history');
    await waitFor(() => expect(history).toBeEnabled());
    const saved = screen.getByRole('option', { name: 'cat' }) as HTMLOptionElement;
    fireEvent.change(find, { target: { value: 'different' } });
    fireEvent.click(screen.getByRole('button', { name: 'Match case' }));
    fireEvent.change(history, { target: { value: saved.value } });
    expect(find).toHaveValue('cat');
    expect(screen.getByRole('button', { name: 'Match case' })).toHaveAttribute('aria-pressed', 'true');
  });
});
