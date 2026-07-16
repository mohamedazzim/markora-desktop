export type TableAlignment = 'left' | 'center' | 'right' | null;
export interface MarkdownTable { rows: string[][]; alignments: TableAlignment[]; }
const splitRow = (row: string) => row.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
const escapeCell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
export function parseMarkdownTable(source: string): MarkdownTable | null {
  const rows = source.trim().split(/\r?\n/); if (rows.length < 2 || !/^\s*\|?.+\|.+/.test(rows[0])) return null;
  const header = splitRow(rows[0]); const separator = splitRow(rows[1]); if (header.length !== separator.length || !separator.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
  const alignments = separator.map((cell) => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : null) as TableAlignment[];
  return { rows: [header, ...rows.slice(2).map(splitRow).map((row) => header.map((_, index) => row[index] || ''))], alignments };
}
export function serializeMarkdownTable(table: MarkdownTable): string {
  const width = table.rows[0]?.length || 0; const divider = Array.from({ length: width }, (_, index) => table.alignments[index] === 'center' ? ':---:' : table.alignments[index] === 'right' ? '---:' : table.alignments[index] === 'left' ? ':---' : '---');
  const row = (cells: string[]) => `| ${cells.map(escapeCell).join(' | ')} |`;
  return [row(table.rows[0]), row(divider), ...table.rows.slice(1).map(row)].join('\n');
}
export function addTableRow(table: MarkdownTable, at: number): MarkdownTable { const copy = table.rows.map((row) => [...row]); copy.splice(Math.max(1, at), 0, Array.from({ length: table.rows[0].length }, () => '')); return { ...table, rows: copy }; }
export function addTableColumn(table: MarkdownTable, at: number): MarkdownTable { const index = Math.max(0, Math.min(at, table.rows[0].length)); return { rows: table.rows.map((row) => [...row.slice(0, index), '', ...row.slice(index)]), alignments: [...table.alignments.slice(0, index), null, ...table.alignments.slice(index)] }; }
