/**
 * Structured Mode materializes both an HTML representation and a ProseMirror
 * tree. Keeping very large Markdown files in Source Mode prevents a single
 * mode switch from exhausting the renderer process.
 */
export const STRUCTURED_MODE_MAX_BYTES = 2 * 1024 * 1024;

export interface DocumentModePolicy {
  readonly byteLength: number;
  readonly structuredModeAllowed: boolean;
  readonly initialMode: 'source' | 'structured';
  readonly reason?: string;
}

export function markdownByteLength(markdown: string): number {
  return new TextEncoder().encode(markdown).byteLength;
}

export function documentModePolicy(markdown: string): DocumentModePolicy {
  const byteLength = markdownByteLength(markdown);
  const structuredModeAllowed = byteLength <= STRUCTURED_MODE_MAX_BYTES;

  return {
    byteLength,
    structuredModeAllowed,
    initialMode: structuredModeAllowed ? 'structured' : 'source',
    reason: structuredModeAllowed
      ? undefined
      : `Structured Mode is limited to ${STRUCTURED_MODE_MAX_BYTES / 1024 / 1024} MiB. ` +
        `This document is ${(byteLength / 1024 / 1024).toFixed(1)} MiB and remains fully editable in Source Mode.`,
  };
}
