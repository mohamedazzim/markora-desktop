import { describe, expect, it } from 'vitest';
import {
  STRUCTURED_MODE_MAX_BYTES,
  documentModePolicy,
  markdownByteLength,
} from '../../src/renderer/documents/large-document-policy';

describe('large document mode policy', () => {
  it('measures UTF-8 bytes instead of UTF-16 code units', () => {
    expect(markdownByteLength('A')).toBe(1);
    expect(markdownByteLength('漢')).toBe(3);
    expect(markdownByteLength('📝')).toBe(4);
  });

  it('allows documents at the structured-mode boundary', () => {
    expect(documentModePolicy('x'.repeat(STRUCTURED_MODE_MAX_BYTES))).toMatchObject({
      structuredModeAllowed: true,
      initialMode: 'structured',
    });
  });

  it('keeps oversized documents in Source Mode with an actionable reason', () => {
    const policy = documentModePolicy('x'.repeat(STRUCTURED_MODE_MAX_BYTES + 1));
    expect(policy.initialMode).toBe('source');
    expect(policy.structuredModeAllowed).toBe(false);
    expect(policy.reason).toContain('fully editable in Source Mode');
  });
});
