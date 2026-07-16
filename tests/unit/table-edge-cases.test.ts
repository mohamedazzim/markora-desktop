import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addTableColumn,
  addTableRow,
  parseMarkdownTable,
  serializeMarkdownTable,
  type MarkdownTable,
} from '../../src/renderer/markdown/tables';

const fixture = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'markdown', name), 'utf8');

describe('Markdown table edge cases', () => {
  it('parses escaped pipes without splitting their cells', () => {
    const table = parseMarkdownTable(fixture('escaped-pipe-table.md'));

    expect(table).not.toBeNull();
    expect(table?.alignments).toEqual(['left', 'center', 'right']);
    expect(table?.rows[0]).toEqual(['Name', 'Value | note', 'Code']);
    expect(table?.rows[1]).toEqual(['alpha', 'left | right', '`a|b`']);
  });

  it('has a stable parse/serialize semantic round trip', () => {
    const parsed = parseMarkdownTable(fixture('escaped-pipe-table.md'));

    expect(parsed).not.toBeNull();
    expect(parseMarkdownTable(serializeMarkdownTable(parsed!))).toEqual(parsed);
  });

  it('accepts CRLF table input', () => {
    const crlf = fixture('escaped-pipe-table.md').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');

    expect(parseMarkdownTable(crlf)?.rows).toHaveLength(3);
  });

  it('pads short body rows and ignores cells beyond the header width', () => {
    const table = parseMarkdownTable('| A | B |\n| --- | --- |\n| only-a |\n| one | two | ignored |');

    expect(table?.rows).toEqual([
      ['A', 'B'],
      ['only-a', ''],
      ['one', 'two'],
    ]);
  });

  it('rejects malformed dividers and non-table input', () => {
    expect(parseMarkdownTable('ordinary text')).toBeNull();
    expect(parseMarkdownTable('| A | B |\n| -- | --- |')).toBeNull();
    expect(parseMarkdownTable('| A | B |\n| --- | --- | --- |')).toBeNull();
  });

  it('inserts rows only below the header and preserves the input object', () => {
    const table: MarkdownTable = {
      rows: [
        ['A', 'B'],
        ['one', 'two'],
      ],
      alignments: ['left', 'right'],
    };
    const before = structuredClone(table);
    const inserted = addTableRow(table, -100);

    expect(table).toEqual(before);
    expect(inserted.rows).toEqual([
      ['A', 'B'],
      ['', ''],
      ['one', 'two'],
    ]);
    expect(inserted.alignments).toEqual(['left', 'right']);
  });

  it('clamps column insertion and preserves cell/alignment correspondence', () => {
    const table: MarkdownTable = {
      rows: [
        ['A', 'B'],
        ['one', 'two'],
      ],
      alignments: ['left', 'right'],
    };

    expect(addTableColumn(table, -10)).toEqual({
      rows: [
        ['', 'A', 'B'],
        ['', 'one', 'two'],
      ],
      alignments: [null, 'left', 'right'],
    });
    expect(addTableColumn(table, 100)).toEqual({
      rows: [
        ['A', 'B', ''],
        ['one', 'two', ''],
      ],
      alignments: ['left', 'right', null],
    });
  });

  it('serializes embedded newlines and escaped pipes safely', () => {
    const markdown = serializeMarkdownTable({
      rows: [
        ['A', 'B'],
        ['line one\nline two', 'left | right'],
      ],
      alignments: [null, null],
    });

    expect(markdown).toContain('line one<br>line two');
    expect(markdown).toContain('left \\| right');
    expect(parseMarkdownTable(markdown)?.rows[1]).toEqual(['line one<br>line two', 'left | right']);
  });
});
