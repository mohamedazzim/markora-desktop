import { describe, expect, it } from 'vitest';
import {
  CanonicalDocument,
  DOCUMENT_HISTORY_MAX_BYTES,
  detectDiskLineEnding,
  toCanonicalText,
  toDiskText,
} from '../../src/renderer/documents/canonical-document';

describe('canonical line endings', () => {
  it('normalizes CRLF internally and preserves it for disk serialization', () => {
    const document = CanonicalDocument.fromDisk('# Title\r\n\r\nBody 🚀\r\n');

    expect(document.text).toBe('# Title\n\nBody 🚀\n');
    expect(document.lineEnding).toBe('crlf');
    expect(document.serializedText).toBe('# Title\r\n\r\nBody 🚀\r\n');
    expect(document.dirty).toBe(false);
  });

  it('preserves LF and uses an explicit fallback for files without newlines', () => {
    expect(CanonicalDocument.fromDisk('alpha\nbeta').lineEnding).toBe('lf');
    expect(CanonicalDocument.fromDisk('one line', 'crlf').lineEnding).toBe('crlf');
    expect(detectDiskLineEnding('a\r\nb\nc\r\n')).toBe('crlf');
  });

  it('normalizes legacy bare CR and serializes only LF or CRLF', () => {
    expect(toCanonicalText('a\rb\r\nc')).toBe('a\nb\nc');
    expect(toDiskText('a\r\nb\nc', 'crlf')).toBe('a\r\nb\r\nc');
  });
});

describe('canonical document revisions and dirty state', () => {
  it('derives ordinary dirty state from the last saved content snapshot', () => {
    const document = CanonicalDocument.fromDisk('saved\n');

    expect(document.setText('edited\r\n')).toMatchObject({ changed: true, revision: 1 });
    expect(document.text).toBe('edited\n');
    expect(document.dirty).toBe(true);

    document.setText('saved\n');
    expect(document.revision).toBe(2);
    expect(document.dirty).toBe(false);
  });

  it('does not create a revision for a line-ending-equivalent source update', () => {
    const document = CanonicalDocument.fromDisk('a\r\nb\r\n');

    expect(document.setText('a\nb\n')).toEqual({
      changed: false,
      revision: 0,
      dirty: false,
    });
  });

  it('tracks line-ending changes as serialization revisions', () => {
    const document = CanonicalDocument.fromDisk('a\nb\n');

    document.setLineEnding('crlf');
    expect(document.revision).toBe(1);
    expect(document.dirty).toBe(true);
    expect(document.serializedText).toBe('a\r\nb\r\n');
  });

  it('creates a dirty non-empty unsaved document and a clean empty one', () => {
    expect(CanonicalDocument.createNew().dirty).toBe(false);
    const document = CanonicalDocument.createNew('draft\r\n');
    expect(document.text).toBe('draft\n');
    expect(document.revision).toBe(1);
    expect(document.dirty).toBe(true);
  });

  it('applies range edits to canonical offsets', () => {
    const document = CanonicalDocument.fromDisk('alpha omega');

    document.replaceText(6, 11, 'βeta\r\nline');
    expect(document.text).toBe('alpha βeta\nline');
    expect(() => document.replaceText(99, 100, '')).toThrow(RangeError);
  });
});

describe('per-editor presentation state', () => {
  it('keeps independent source and structured selections and scroll positions', () => {
    const document = CanonicalDocument.fromDisk('# Heading\n\nText');
    document.setViewState('source', {
      selection: { anchor: 3, head: 7 },
      scrollTop: 120,
      scrollLeft: 4,
    });
    document.setViewState('structured', {
      selection: { anchor: 1, head: 1 },
      scrollTop: 48,
      scrollLeft: 0,
    });

    document.setText('# Heading\n\nChanged');
    expect(document.getViewState('source')).toEqual({
      selection: { anchor: 3, head: 7 },
      scrollTop: 120,
      scrollLeft: 4,
    });
    expect(document.getViewState('structured').scrollTop).toBe(48);
  });

  it('returns defensive copies and validates invalid presentation state', () => {
    const document = CanonicalDocument.createNew();
    const view = document.getViewState('source');
    (view.selection as { anchor: number }).anchor = 10;

    expect(document.getViewState('source').selection.anchor).toBe(0);
    expect(() => document.updateViewState('source', { selection: { anchor: -1, head: 0 } })).toThrow(
      RangeError,
    );
    expect(() => document.updateViewState('source', { scrollTop: Number.NaN })).toThrow(RangeError);
  });

  it('provides a flat editor-adapter snapshot shape', () => {
    const document = CanonicalDocument.createNew();
    document.setViewSnapshot('structured', {
      anchor: 4,
      head: 9,
      scrollTop: 64,
      scrollLeft: 2,
    });

    expect(document.getViewSnapshot('structured')).toEqual({
      anchor: 4,
      head: 9,
      scrollTop: 64,
      scrollLeft: 2,
    });
  });
});

describe('revision-safe asynchronous saves', () => {
  it('clears dirty state when the saved revision is still current', () => {
    const document = CanonicalDocument.fromDisk('old\r\n');
    document.setText('new\n');
    const ticket = document.beginSave();

    expect(ticket.diskText).toBe('new\r\n');
    expect(document.completeSave(ticket)).toEqual({
      status: 'saved',
      savedRevision: 1,
      currentRevision: 1,
      dirty: false,
    });
    expect(document.lastSavedDiskText).toBe('new\r\n');
  });

  it('does not clear dirty state when edits happen while I/O is pending', () => {
    const document = CanonicalDocument.fromDisk('old\n');
    document.setText('first edit\n');
    const staleTicket = document.beginSave();
    document.setText('second edit\n');

    expect(document.completeSave(staleTicket)).toMatchObject({
      status: 'stale',
      savedRevision: 1,
      currentRevision: 2,
      dirty: true,
    });
    expect(document.savedSnapshot.text).toBe('first edit\n');
    expect(document.text).toBe('second edit\n');

    const currentTicket = document.beginSave();
    expect(document.completeSave(currentTicket).status).toBe('saved');
    expect(document.dirty).toBe(false);
  });

  it('keeps the safety latch when content changes away and back during a save', () => {
    const document = CanonicalDocument.fromDisk('disk\n');
    document.setText('pending\n');
    const ticket = document.beginSave();
    document.setText('temporary\n');
    document.setText('pending\n');

    expect(document.completeSave(ticket).status).toBe('stale');
    expect(document.text).toBe(document.savedSnapshot.text);
    expect(document.hasStaleSave).toBe(true);
    expect(document.dirty).toBe(true);

    document.completeSave(document.beginSave());
    expect(document.hasStaleSave).toBe(false);
    expect(document.dirty).toBe(false);
  });

  it('does not change the saved snapshot after a failed save', () => {
    const document = CanonicalDocument.fromDisk('disk');
    document.setText('editor');
    const ticket = document.beginSave();
    document.failSave(ticket);

    expect(document.savedSnapshot.text).toBe('disk');
    expect(document.dirty).toBe(true);
    expect(() => document.completeSave(ticket)).toThrow(/already/);
  });
});

describe('external disk change classification', () => {
  it('marks a clean editor version dirty when the user keeps it over a newer disk version', () => {
    const document = CanonicalDocument.fromDisk('opened');
    expect(document.dirty).toBe(false);
    document.markDiskVersionDiverged();
    expect(document.dirty).toBe(true);
  });

  it('classifies unchanged, line-ending-only, and safe reload events', () => {
    const document = CanonicalDocument.fromDisk('disk\r\n');

    expect(document.classifyExternalChange('disk\r\n').kind).toBe('unchanged');
    expect(document.classifyExternalChange('disk\n').kind).toBe('line-ending-only');
    expect(document.classifyExternalChange('external\r\n')).toMatchObject({
      kind: 'reload-safe',
      hasConflict: false,
    });
  });

  it('distinguishes a matching editor version from a true divergence', () => {
    const document = CanonicalDocument.fromDisk('base\n');
    document.setText('editor\n');

    expect(document.classifyExternalChange('editor\n').kind).toBe('matches-editor');
    expect(document.classifyExternalChange('other\n')).toMatchObject({
      kind: 'conflict',
      hasConflict: true,
    });
    expect(document.classifyExternalChange(null).kind).toBe('deleted-conflict');
  });

  it('classifies deletion of a clean document separately', () => {
    const document = CanonicalDocument.fromDisk('base');
    expect(document.classifyExternalChange(null)).toEqual({
      kind: 'deleted-clean',
      hasConflict: false,
      disk: null,
    });
  });

  it('reloads a safe disk version while retaining editor view state', () => {
    const document = CanonicalDocument.fromDisk('old\r\n');
    document.updateViewState('source', {
      selection: { anchor: 2, head: 2 },
      scrollTop: 40,
    });

    document.reloadFromDisk('new\n');
    expect(document.text).toBe('new\n');
    expect(document.lineEnding).toBe('lf');
    expect(document.dirty).toBe(false);
    expect(document.revision).toBe(1);
    expect(document.getViewState('source')).toMatchObject({
      selection: { anchor: 2, head: 2 },
      scrollTop: 40,
    });
  });
});

describe('canonical undo and redo', () => {
  it('keeps mode-independent text history in the authoritative model', () => {
    const document = CanonicalDocument.fromDisk('one\n');
    document.setText('two\n');
    document.setText('three\n');

    expect(document.canUndo).toBe(true);
    expect(document.undo().changed).toBe(true);
    expect(document.text).toBe('two\n');
    expect(document.undo().changed).toBe(true);
    expect(document.text).toBe('one\n');
    expect(document.dirty).toBe(false);
    expect(document.canRedo).toBe(true);
    document.redo();
    expect(document.text).toBe('two\n');
  });

  it('clears redo after a divergent edit and history after disk reload', () => {
    const document = CanonicalDocument.fromDisk('base');
    document.setText('first');
    document.undo();
    document.setText('second');
    expect(document.canRedo).toBe(false);

    document.reloadFromDisk('external');
    expect(document.canUndo).toBe(false);
    expect(document.canRedo).toBe(false);
  });

  it('tracks line-ending changes in the same history', () => {
    const document = CanonicalDocument.fromDisk('line\n');
    document.setLineEnding('crlf');
    expect(document.serializedText).toBe('line\r\n');
    document.undo();
    expect(document.serializedText).toBe('line\n');
  });

  it('bounds snapshot history memory for repeated edits to a large source document', () => {
    const source = 'x'.repeat(2 * 1024 * 1024);
    const document = CanonicalDocument.fromDisk(source);
    for (let index = 0; index < 20; index += 1) {
      document.replaceText(document.text.length - 1, document.text.length, String(index % 10));
    }

    expect(document.historyUsage.estimatedBytes).toBeLessThanOrEqual(DOCUMENT_HISTORY_MAX_BYTES);
    expect(document.historyUsage.undoEntries).toBeLessThan(20);
    expect(document.undo().changed).toBe(true);
  });
});
