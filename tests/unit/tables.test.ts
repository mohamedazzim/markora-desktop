import { describe, expect, it } from 'vitest';
import { addTableColumn, addTableRow, parseMarkdownTable, serializeMarkdownTable } from '../../src/renderer/markdown/tables';
describe('GFM table transformations', () => {
  it('preserves escaped pipes and column alignment', () => { const table = parseMarkdownTable('| A | B |\n| :--- | ---: |\n| one \\| two | 3 |'); expect(table).not.toBeNull(); expect(serializeMarkdownTable(table!)).toContain('one \\| two'); expect(serializeMarkdownTable(table!)).toContain(':---'); expect(serializeMarkdownTable(table!)).toContain('---:'); });
  it('adds table rows and columns without changing existing cells', () => { const table = parseMarkdownTable('| A | B |\n| --- | --- |\n| one | two |')!; const grown = addTableColumn(addTableRow(table, 2), 1); expect(grown.rows).toHaveLength(3); expect(grown.rows[0]).toEqual(['A', '', 'B']); });
});
