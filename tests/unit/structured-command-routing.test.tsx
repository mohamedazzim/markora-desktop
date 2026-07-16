import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  StructuredEditor,
  type StructuredEditorCommandId,
  type StructuredEditorHandle,
} from '../../src/renderer/editor/StructuredEditor';

afterEach(cleanup);

const viewState = { anchor: 1, head: 1, scrollTop: 0, scrollLeft: 0 };

describe('StructuredEditor command routing', () => {
  it('routes every formatting and insertion toolbar control through the command registry boundary', async () => {
    const onCommand = vi.fn<(id: StructuredEditorCommandId) => void>();
    let handle: StructuredEditorHandle | null = null;
    render(
      <StructuredEditor
        documentId="command-routing"
        source="Editable text"
        viewState={viewState}
        onChange={vi.fn()}
        onViewStateChange={vi.fn()}
        onCommand={onCommand}
        onHandle={(value) => {
          handle = value;
        }}
      />,
    );
    await screen.findByLabelText('Structured Markdown editor');
    await waitFor(() => expect(handle).not.toBeNull());

    const blockCommands = [
      'editor.setHeading1',
      'editor.setHeading2',
      'editor.setHeading3',
      'editor.setHeading4',
      'editor.setHeading5',
      'editor.setHeading6',
      'editor.setParagraph',
    ] as const;

    const commands = [
      'editor.undo',
      'editor.redo',
      'editor.toggleBold',
      'editor.toggleItalic',
      'editor.toggleStrike',
      'editor.toggleUnderline',
      'editor.toggleHighlight',
      'editor.editLink',
      'editor.insertImage',
      'editor.toggleBulletList',
      'editor.toggleOrderedList',
      'editor.toggleTaskList',
      'editor.toggleBlockquote',
      'editor.toggleCodeBlock',
      'editor.insertTable',
      'editor.insertMath',
      'editor.insertMermaid',
    ] as const;

    act(() => {
      blockCommands.forEach((id) => handle!.executeCommand(id));
      commands.forEach((id) => handle!.executeCommand(id));
    });

    expect(onCommand.mock.calls.map(([id]) => id)).toEqual([
      ...blockCommands,
      ...commands,
    ]);
  });

  it('maps a duplicate marked-text selection to deterministic canonical Markdown offsets', async () => {
    const source = 'first **repeat** and repeat';
    let handle: StructuredEditorHandle | null = null;
    render(
      <StructuredEditor
        documentId="selection-mapping"
        source={source}
        viewState={viewState}
        onChange={vi.fn()}
        onViewStateChange={vi.fn()}
        onHandle={(value) => {
          handle = value;
        }}
      />,
    );
    await waitFor(() => expect(handle).not.toBeNull());

    act(() => {
      handle!.setTextSelection(18, 24);
    });
    expect(handle!.getMarkdownSelection(source)).toEqual({ start: 21, end: 27 });

    act(() => {
      handle!.setTextSelection(7, 13);
    });
    expect(handle!.getMarkdownSelection(source)).toEqual({ start: 8, end: 14 });
  });

  it('executes every paragraph-style handler when no parent registry boundary is supplied', async () => {
    let handle: StructuredEditorHandle | null = null;
    const { container } = render(
      <StructuredEditor
        documentId="block-style-handlers"
        source="Paragraph"
        viewState={viewState}
        onChange={vi.fn()}
        onViewStateChange={vi.fn()}
        onHandle={(value) => {
          handle = value;
        }}
      />,
    );
    await waitFor(() => expect(handle).not.toBeNull());

    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      act(() => {
        void handle!.executeCommand(`editor.setHeading${level}` as StructuredEditorCommandId);
      });
      expect(container.querySelector(`h${level}`)).not.toBeNull();
    }
    act(() => {
      void handle!.executeCommand('editor.setParagraph');
    });
    expect(container.querySelector('.ProseMirror > p')).not.toBeNull();
  });

  it('restores and captures both structured scroll axes', async () => {
    const onViewStateChange = vi.fn();
    render(
      <StructuredEditor
        documentId="scroll-state"
        source="Wide structured content"
        viewState={{ anchor: 1, head: 1, scrollTop: 37, scrollLeft: 19 }}
        onChange={vi.fn()}
        onViewStateChange={onViewStateChange}
      />,
    );
    const workspace = await screen.findByLabelText('Structured editor workspace');
    await waitFor(() => {
      expect(workspace.scrollTop).toBe(37);
      expect(workspace.scrollLeft).toBe(19);
    });

    workspace.scrollTop = 81;
    workspace.scrollLeft = 42;
    fireEvent.scroll(workspace);
    expect(onViewStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ scrollTop: 81, scrollLeft: 42 }),
    );
  });

  it('maps canonical Markdown search ranges across invisible formatting delimiters', async () => {
    const source = '**needle** and needle';
    const { container } = render(
      <StructuredEditor
        documentId="search-range-mapping"
        source={source}
        viewState={viewState}
        onChange={vi.fn()}
        onViewStateChange={vi.fn()}
        searchHighlights={{
          query: 'needle',
          matches: [
            { start: 0, end: 10, text: '**needle**', captures: [], zeroWidth: false },
            { start: 15, end: 21, text: 'needle', captures: [], zeroWidth: false },
          ],
          activeIndex: 1,
          activeMatch: { start: 15, end: 21, text: 'needle', captures: [], zeroWidth: false },
          scope: { start: 0, end: source.length },
          truncated: false,
        }}
      />,
    );

    await waitFor(() => expect(container.querySelectorAll('.structured-search-match')).toHaveLength(2));
    expect(container.querySelector('strong .structured-search-match')).toHaveTextContent('needle');
    expect(container.querySelector('.structured-search-match.active')).toHaveTextContent('needle');
  });

  it('routes contextual table controls through the same boundary and reports table availability', async () => {
    const onCommand = vi.fn<(id: StructuredEditorCommandId) => void>();
    const tableActive = vi.fn<(active: boolean) => void>();
    let handle: StructuredEditorHandle | null = null;
    render(
      <StructuredEditor
        documentId="table-command-routing"
        source="Table host"
        viewState={viewState}
        onChange={vi.fn()}
        onViewStateChange={vi.fn()}
        onCommand={onCommand}
        onHandle={(value) => {
          handle = value;
        }}
        onTableActiveChange={tableActive}
      />,
    );
    await waitFor(() => expect(handle).not.toBeNull());
    await act(async () => {
      await handle!.executeCommand('editor.insertTable');
    });
    await screen.findByRole('toolbar', { name: 'Table tools' });
    onCommand.mockClear();

    const commands = [
      ['Row above', 'table.addRowBefore'],
      ['Row below', 'table.addRowAfter'],
      ['Column before', 'table.addColumnBefore'],
      ['Column after', 'table.addColumnAfter'],
      ['Delete row', 'table.deleteRow'],
      ['Delete column', 'table.deleteColumn'],
      ['Copy Markdown', 'table.copyMarkdown'],
      ['Copy TSV', 'table.copyTsv'],
      ['Delete table', 'table.delete'],
    ] as const;
    commands.forEach(([label]) => fireEvent.click(screen.getByRole('button', { name: label })));

    expect(onCommand.mock.calls.map(([id]) => id)).toEqual(commands.map(([, id]) => id));
    expect(tableActive).toHaveBeenCalledWith(true);
  });
});
