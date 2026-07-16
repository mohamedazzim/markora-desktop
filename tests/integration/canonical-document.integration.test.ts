import { describe, expect, it } from 'vitest';
import { CanonicalDocument } from '../../src/renderer/documents/canonical-document';

describe('CanonicalDocument integration', () => {
  it('keeps LF internally while preserving the source file convention across edits and save/reopen', () => {
    const crlf = CanonicalDocument.fromDisk('# Windows\r\n\r\nOriginal\r\n');
    const lf = CanonicalDocument.fromDisk('# Unix\n\nOriginal\n');

    crlf.setText('# Windows\n\nEdited\n');
    lf.setText('# Unix\r\n\r\nEdited\r\n');

    const crlfSave = crlf.beginSave();
    const lfSave = lf.beginSave();
    expect(crlfSave.diskText).toBe('# Windows\r\n\r\nEdited\r\n');
    expect(lfSave.diskText).toBe('# Unix\n\nEdited\n');

    crlf.completeSave(crlfSave);
    lf.completeSave(lfSave);
    const reopenedCrlf = CanonicalDocument.fromDisk(crlfSave.diskText);
    const reopenedLf = CanonicalDocument.fromDisk(lfSave.diskText);

    expect(reopenedCrlf.currentSnapshot).toMatchObject({
      text: '# Windows\n\nEdited\n',
      lineEnding: 'crlf',
    });
    expect(reopenedLf.currentSnapshot).toMatchObject({
      text: '# Unix\n\nEdited\n',
      lineEnding: 'lf',
    });
    expect(reopenedCrlf.dirty).toBe(false);
    expect(reopenedLf.dirty).toBe(false);
  });

  it('does not let an asynchronous save clear edits made while the write is pending', async () => {
    const document = CanonicalDocument.fromDisk('on disk\n');
    document.setText('first editor revision\n');
    const firstWrite = document.beginSave();

    const simulatedWrite = Promise.resolve().then(() => firstWrite.diskText);
    document.setText('second editor revision\n');

    expect(await simulatedWrite).toBe('first editor revision\n');
    expect(document.completeSave(firstWrite)).toMatchObject({
      status: 'stale',
      savedRevision: 1,
      currentRevision: 2,
      dirty: true,
    });
    expect(document.text).toBe('second editor revision\n');
    expect(document.lastSavedDiskText).toBe('first editor revision\n');

    const secondWrite = document.beginSave();
    document.completeSave(secondWrite);
    expect(document.dirty).toBe(false);
    expect(document.lastSavedDiskText).toBe('second editor revision\n');
  });

  it('tracks the disk state correctly when overlapping writes complete out of order', () => {
    const document = CanonicalDocument.fromDisk('base\n');
    document.setText('older write\n');
    const older = document.beginSave();
    document.setText('newer write\n');
    const newer = document.beginSave();

    expect(document.completeSave(newer).status).toBe('saved');
    expect(document.dirty).toBe(false);

    // If the older filesystem operation completes last, it really is the last
    // content written to disk. The model must expose that regression as dirty.
    expect(document.completeSave(older).status).toBe('stale');
    expect(document.lastSavedDiskText).toBe('older write\n');
    expect(document.text).toBe('newer write\n');
    expect(document.dirty).toBe(true);
  });

  it('preserves independent source and structured selection/scroll state through edits and reload', () => {
    const document = CanonicalDocument.fromDisk('# Heading\n\nBody\n');
    document.setViewSnapshot('source', {
      anchor: 2,
      head: 8,
      scrollTop: 420,
      scrollLeft: 12,
    });
    document.setViewSnapshot('structured', {
      anchor: 1,
      head: 4,
      scrollTop: 175,
      scrollLeft: 0,
    });

    document.setText('# Heading\n\nChanged body\n');
    expect(document.getViewSnapshot('source')).toEqual({
      anchor: 2,
      head: 8,
      scrollTop: 420,
      scrollLeft: 12,
    });
    expect(document.getViewSnapshot('structured')).toEqual({
      anchor: 1,
      head: 4,
      scrollTop: 175,
      scrollLeft: 0,
    });

    document.reloadFromDisk('# Reloaded\n\nDisk body\n');
    expect(document.getViewSnapshot('source').scrollTop).toBe(420);
    expect(document.getViewSnapshot('structured').scrollTop).toBe(175);
  });

  it('classifies clean reloads, editor/disk matches, divergent edits, and deletions without mutation', () => {
    const clean = CanonicalDocument.fromDisk('base\r\n');
    expect(clean.classifyExternalChange('external\r\n')).toMatchObject({
      kind: 'reload-safe',
      hasConflict: false,
    });
    expect(clean.text).toBe('base\n');

    clean.reloadFromDisk('external\r\n');
    expect(clean.text).toBe('external\n');
    expect(clean.dirty).toBe(false);

    clean.setText('editor\n');
    expect(clean.classifyExternalChange('editor\r\n').kind).toBe('matches-editor');
    expect(clean.classifyExternalChange('different disk\r\n')).toMatchObject({
      kind: 'conflict',
      hasConflict: true,
    });
    expect(clean.classifyExternalChange(null)).toMatchObject({
      kind: 'deleted-conflict',
      hasConflict: true,
    });
    expect(clean.text).toBe('editor\n');

    const deletedClean = CanonicalDocument.fromDisk('base');
    expect(deletedClean.classifyExternalChange(null).kind).toBe('deleted-clean');
  });

  it('preserves empty and multilingual documents through an actual save snapshot', () => {
    const empty = CanonicalDocument.createNew();
    const emptySave = empty.beginSave();
    expect(emptySave.diskText).toBe('');
    empty.completeSave(emptySave);
    expect(CanonicalDocument.fromDisk(emptySave.diskText).text).toBe('');

    const unicodeText = '# Café 文档 العربية 📝\n\n日本語 · 한국어 · 👩🏽‍💻\n';
    const unicode = CanonicalDocument.fromDisk(unicodeText);
    unicode.replaceText(unicode.text.indexOf('📝'), unicode.text.indexOf('📝') + '📝'.length, '✅');
    const unicodeSave = unicode.beginSave();
    unicode.completeSave(unicodeSave);

    expect(CanonicalDocument.fromDisk(unicodeSave.diskText).text).toBe(
      '# Café 文档 العربية ✅\n\n日本語 · 한국어 · 👩🏽‍💻\n',
    );
  });

  it('handles a 10 MiB canonical source without truncation or revision loss', () => {
    const line = 'Unicode payload 文档 العربية 📝 and ordinary Markdown text.\n';
    const repetitions = Math.ceil((10 * 1024 * 1024) / line.length);
    const largeSource = line.repeat(repetitions).slice(0, 10 * 1024 * 1024);
    const document = CanonicalDocument.fromDisk(largeSource);

    expect(document.text.length).toBe(10 * 1024 * 1024);
    document.replaceText(document.text.length - 8, document.text.length, 'THE END\n');
    const save = document.beginSave();

    expect(save.diskText.length).toBe(document.text.length);
    expect(save.diskText.endsWith('THE END\n')).toBe(true);
    expect(document.completeSave(save).status).toBe('saved');
    expect(document.dirty).toBe(false);
  });
});
