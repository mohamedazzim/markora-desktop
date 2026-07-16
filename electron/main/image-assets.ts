import { randomUUID } from 'node:crypto';
import { constants as fileConstants } from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  open,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ASSET_DESTINATION_STRATEGIES = [
  'keep-original',
  'document-sibling',
  'assets',
  'document-assets',
  'workspace-assets',
  'date-based',
] as const;

export type AssetDestinationStrategy = (typeof ASSET_DESTINATION_STRATEGIES)[number];
export type AssetConflictPolicy = 'rename' | 'error' | 'overwrite';
export type MarkdownPathPreference =
  | 'auto'
  | 'document-relative'
  | 'workspace-relative'
  | 'absolute';
export type MarkdownPathKind = 'document-relative' | 'workspace-relative' | 'absolute';
export type AssetSourceKind = 'local' | 'clipboard' | 'remote';

export type AssetErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UNSAVED_DOCUMENT'
  | 'WORKSPACE_REQUIRED'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_NOT_FILE'
  | 'BROKEN_LOCAL_REFERENCE'
  | 'INVALID_DESTINATION'
  | 'OUTSIDE_WORKSPACE'
  | 'PATH_TOO_LONG'
  | 'DESTINATION_READ_ONLY'
  | 'CONFLICT'
  | 'COPY_FAILED'
  | 'WRITE_FAILED'
  | 'UNSUPPORTED_PROTOCOL'
  | 'UNSAFE_REDIRECT'
  | 'TOO_MANY_REDIRECTS'
  | 'DOWNLOAD_FAILED'
  | 'DOWNLOAD_TIMEOUT'
  | 'DOWNLOAD_CANCELLED'
  | 'DOWNLOAD_TOO_LARGE'
  | 'INVALID_RESPONSE';

export interface AssetContext {
  /** Absolute path of the Markdown document. Omit for an unsaved document. */
  documentPath?: string;
  /** Absolute path of the open workspace root. */
  workspaceRoot?: string;
  /** A single directory name used by workspace/date strategies. Defaults to "assets". */
  workspaceAssetDirectoryName?: string;
  /** Makes date-based paths deterministic in tests and callers. */
  now?: Date;
  /** Windows supports long paths when enabled; this guard still prevents pathological IPC input. */
  maxPathLength?: number;
}

export interface AssetDestinationRequest {
  strategy: AssetDestinationStrategy;
  filename: string;
  context: AssetContext;
  conflictPolicy?: AssetConflictPolicy;
}

export interface ResolvedAssetDestination {
  directoryPath: string;
  assetPath: string;
  filename: string;
  requestedFilename: string;
  renamedForConflict: boolean;
}

export interface MarkdownAssetPath {
  value: string;
  kind: MarkdownPathKind;
}

export interface AssetWriteResult extends ResolvedAssetDestination {
  sourceKind: AssetSourceKind;
  originalSource: string | null;
  copied: boolean;
  byteLength: number;
  mimeType?: string;
  markdownPath: string;
  markdownPathKind: MarkdownPathKind;
}

export interface CopyLocalImageRequest extends AssetDestinationRequest {
  sourcePath: string;
  markdownPathPreference?: MarkdownPathPreference;
}

export interface WriteClipboardImageRequest extends AssetDestinationRequest {
  data: Uint8Array;
  mimeType: string;
  markdownPathPreference?: MarkdownPathPreference;
  maxBytes?: number;
}

export interface DownloadRemoteImageRequest extends AssetDestinationRequest {
  url: string;
  markdownPathPreference?: MarkdownPathPreference;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface ResolveLocalImageReferenceRequest {
  reference: string;
  documentPath?: string;
  workspaceRoot?: string;
}

interface DownloadedImage {
  bytes: Uint8Array;
  finalUrl: URL;
  filename: string;
  mimeType?: string;
}

const DEFAULT_MAX_PATH_LENGTH = 32_000;
const DEFAULT_MAX_ASSET_BYTES = 25 * 1024 * 1024;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REDIRECTS = 5;
const MAX_FILENAME_LENGTH = 240;
const RESERVED_WINDOWS_NAMES = /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9]|lpt[1-9])$/i;
const HTTP_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/tiff': '.tiff',
  'image/webp': '.webp',
  'image/x-icon': '.ico',
};

export class AssetOperationError extends Error {
  readonly code: AssetErrorCode;
  readonly path?: string;
  readonly causeCode?: string;
  readonly recoverable: boolean;

  constructor(
    code: AssetErrorCode,
    message: string,
    options: {
      path?: string;
      cause?: unknown;
      recoverable?: boolean;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AssetOperationError';
    this.code = code;
    this.path = options.path;
    this.causeCode = getNodeErrorCode(options.cause);
    this.recoverable = options.recoverable ?? true;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      path: this.path,
      causeCode: this.causeCode,
      recoverable: this.recoverable,
    };
  }
}

export function sanitizeWindowsFilename(
  input: string,
  fallback = 'image',
  maxLength = MAX_FILENAME_LENGTH,
): string {
  if (!Number.isSafeInteger(maxLength) || maxLength < 8 || maxLength > 255) {
    throw new AssetOperationError(
      'INVALID_ARGUMENT',
      'Filename length must be an integer between 8 and 255.',
      { recoverable: false },
    );
  }

  const normalizedFallback = normalizeFilenameText(fallback) || 'image';
  let filename = normalizeFilenameText(input) || normalizedFallback;
  let extension = path.win32.extname(filename);
  let stem = extension ? filename.slice(0, -extension.length) : filename;

  if (!stem || /^\.+$/.test(stem)) stem = normalizedFallback;
  if (RESERVED_WINDOWS_NAMES.test(stem)) stem = `_${stem}`;

  extension = trimToCodePoints(extension, Math.min(extension.length, 32));
  const maximumStemLength = Math.max(1, maxLength - Array.from(extension).length);
  stem = trimToCodePoints(stem, maximumStemLength).replace(/[ .]+$/u, '');
  filename = `${stem || normalizedFallback}${extension}`;

  if (RESERVED_WINDOWS_NAMES.test(path.win32.parse(filename).name)) filename = `_${filename}`;
  return trimToCodePoints(filename, maxLength).replace(/[ .]+$/u, '') || 'image';
}

export function resolveAssetBaseDirectory(
  strategy: Exclude<AssetDestinationStrategy, 'keep-original'>,
  context: AssetContext,
): string {
  assertDestinationStrategy(strategy);
  if (strategy === ('keep-original' as AssetDestinationStrategy)) {
    throw new AssetOperationError(
      'INVALID_DESTINATION',
      'Keep original does not have an asset destination directory.',
    );
  }
  validateContext(context);
  const documentPath = context.documentPath ? path.resolve(context.documentPath) : undefined;
  const workspaceRoot = context.workspaceRoot ? path.resolve(context.workspaceRoot) : undefined;
  const documentDirectory = documentPath ? path.dirname(documentPath) : undefined;

  switch (strategy) {
    case 'document-sibling':
      return requireDocumentDirectory(documentDirectory);
    case 'assets':
      return path.join(requireDocumentDirectory(documentDirectory), 'assets');
    case 'document-assets': {
      const savedDocument = requireDocumentPath(documentPath);
      const documentName = sanitizeWindowsFilename(path.parse(savedDocument).name, 'document');
      return path.join(path.dirname(savedDocument), `${documentName}.assets`);
    }
    case 'workspace-assets':
      return path.join(
        requireWorkspaceRoot(workspaceRoot),
        sanitizeDirectoryName(context.workspaceAssetDirectoryName ?? 'assets'),
      );
    case 'date-based': {
      const base = workspaceRoot
        ? path.join(
            workspaceRoot,
            sanitizeDirectoryName(context.workspaceAssetDirectoryName ?? 'assets'),
          )
        : path.join(requireDocumentDirectory(documentDirectory), 'assets');
      const date = context.now ?? new Date();
      if (Number.isNaN(date.getTime())) {
        throw new AssetOperationError('INVALID_ARGUMENT', 'The date-based asset date is invalid.');
      }
      return path.join(
        base,
        String(date.getFullYear()).padStart(4, '0'),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      );
    }
  }
}

export async function resolveAssetDestination(
  request: AssetDestinationRequest,
): Promise<ResolvedAssetDestination> {
  assertDestinationStrategy(request.strategy);
  if (typeof request.filename !== 'string') {
    throw new AssetOperationError('INVALID_ARGUMENT', 'The asset filename must be a string.');
  }
  if (request.strategy === 'keep-original') {
    throw new AssetOperationError(
      'INVALID_DESTINATION',
      'Keep original does not create a destination. Use it only with an existing local image.',
    );
  }

  const requestedFilename = sanitizeWindowsFilename(request.filename);
  const directoryPath = resolveAssetBaseDirectory(request.strategy, request.context);
  await prepareDestinationDirectory(directoryPath, request.context.maxPathLength);

  const conflictPolicy = request.conflictPolicy ?? 'rename';
  assertConflictPolicy(conflictPolicy);
  const assetPath = await selectDestinationPath(
    directoryPath,
    requestedFilename,
    conflictPolicy,
    request.context.maxPathLength,
  );
  return {
    directoryPath,
    assetPath,
    filename: path.basename(assetPath),
    requestedFilename,
    renamedForConflict: path.basename(assetPath) !== requestedFilename,
  };
}

export function calculateMarkdownAssetPath(
  assetPath: string,
  context: Pick<AssetContext, 'documentPath' | 'workspaceRoot'>,
  preference: MarkdownPathPreference = 'auto',
): MarkdownAssetPath {
  assertMarkdownPathPreference(preference);
  if (!path.isAbsolute(assetPath)) {
    throw new AssetOperationError('INVALID_ARGUMENT', 'The asset path must be absolute.', {
      path: assetPath,
    });
  }
  validateOptionalAbsolutePath(context.documentPath, 'document path');
  validateOptionalAbsolutePath(context.workspaceRoot, 'workspace root');

  const absoluteAssetPath = path.resolve(assetPath);
  const documentDirectory = context.documentPath
    ? path.dirname(path.resolve(context.documentPath))
    : undefined;
  const workspaceRoot = context.workspaceRoot ? path.resolve(context.workspaceRoot) : undefined;

  if (preference === 'document-relative') {
    if (!documentDirectory) {
      throw new AssetOperationError(
        'UNSAVED_DOCUMENT',
        'Save the document before creating a document-relative image path.',
      );
    }
    return {
      value: toMarkdownPath(path.relative(documentDirectory, absoluteAssetPath)),
      kind: 'document-relative',
    };
  }

  if (preference === 'workspace-relative') {
    const root = requireWorkspaceRoot(workspaceRoot);
    ensurePathInside(root, absoluteAssetPath);
    return {
      value: toMarkdownPath(path.relative(root, absoluteAssetPath)),
      kind: 'workspace-relative',
    };
  }

  if (preference === 'absolute') {
    return { value: toMarkdownPath(absoluteAssetPath), kind: 'absolute' };
  }

  if (documentDirectory) {
    return {
      value: toMarkdownPath(path.relative(documentDirectory, absoluteAssetPath)),
      kind: 'document-relative',
    };
  }
  if (workspaceRoot && isPathInside(workspaceRoot, absoluteAssetPath)) {
    return {
      value: toMarkdownPath(path.relative(workspaceRoot, absoluteAssetPath)),
      kind: 'workspace-relative',
    };
  }
  return { value: toMarkdownPath(absoluteAssetPath), kind: 'absolute' };
}

export function formatMarkdownImageDestination(markdownPath: string): string {
  const escaped = markdownPath.replace(/</gu, '%3C').replace(/>/gu, '%3E');
  return /[\s()]/u.test(escaped) ? `<${escaped}>` : escaped;
}

export async function resolveLocalImageReference(
  request: ResolveLocalImageReferenceRequest,
): Promise<string> {
  const reference = request.reference.trim();
  if (!reference) {
    throw new AssetOperationError('INVALID_ARGUMENT', 'The image reference is empty.');
  }
  if (/^https?:/iu.test(reference) || /^data:/iu.test(reference)) {
    throw new AssetOperationError(
      'INVALID_ARGUMENT',
      'The image reference is remote rather than a local file.',
    );
  }

  let localReference = reference;
  if (/^file:/iu.test(reference)) {
    try {
      localReference = fileURLToPath(reference);
    } catch (error) {
      throw new AssetOperationError('INVALID_ARGUMENT', 'The file URL is invalid.', {
        cause: error,
      });
    }
  }

  const candidates: string[] = [];
  if (path.isAbsolute(localReference)) {
    candidates.push(path.resolve(localReference));
  } else {
    if (request.documentPath) {
      validateOptionalAbsolutePath(request.documentPath, 'document path');
      candidates.push(path.resolve(path.dirname(request.documentPath), localReference));
    }
    if (request.workspaceRoot) {
      validateOptionalAbsolutePath(request.workspaceRoot, 'workspace root');
      candidates.push(path.resolve(request.workspaceRoot, localReference));
    }
  }

  for (const candidate of [...new Set(candidates)]) {
    try {
      const information = await stat(candidate);
      if (information.isFile()) return candidate;
    } catch (error) {
      if (getNodeErrorCode(error) !== 'ENOENT') {
        throw fileSystemError('SOURCE_NOT_FOUND', 'Could not inspect the local image.', candidate, error);
      }
    }
  }

  throw new AssetOperationError(
    'BROKEN_LOCAL_REFERENCE',
    `The local image reference could not be resolved: ${reference}`,
    { path: candidates[0] },
  );
}

export async function copyLocalImageAsset(
  request: CopyLocalImageRequest,
): Promise<AssetWriteResult> {
  assertDestinationStrategy(request.strategy);
  if (typeof request.sourcePath !== 'string' || !path.isAbsolute(request.sourcePath)) {
    throw new AssetOperationError('INVALID_ARGUMENT', 'The source image path must be absolute.', {
      path: request.sourcePath,
    });
  }

  const sourcePath = path.resolve(request.sourcePath);
  const sourceInformation = await inspectSourceFile(sourcePath);
  if (request.strategy === 'keep-original') {
    const markdown = calculateMarkdownAssetPath(
      sourcePath,
      request.context,
      request.markdownPathPreference,
    );
    return {
      directoryPath: path.dirname(sourcePath),
      assetPath: sourcePath,
      filename: path.basename(sourcePath),
      requestedFilename: path.basename(sourcePath),
      renamedForConflict: false,
      sourceKind: 'local',
      originalSource: sourcePath,
      copied: false,
      byteLength: sourceInformation.size,
      markdownPath: markdown.value,
      markdownPathKind: markdown.kind,
    };
  }

  const requestedFilename = request.filename.trim() || path.basename(sourcePath);
  const intendedDirectory = resolveAssetBaseDirectory(request.strategy, request.context);
  const intendedFilename = sanitizeWindowsFilename(requestedFilename);
  const intendedPath = path.join(intendedDirectory, intendedFilename);
  if (pathsEqual(sourcePath, intendedPath)) {
    const markdown = calculateMarkdownAssetPath(
      sourcePath,
      request.context,
      request.markdownPathPreference,
    );
    return buildWriteResult(
      {
        directoryPath: intendedDirectory,
        assetPath: sourcePath,
        filename: path.basename(sourcePath),
        requestedFilename: intendedFilename,
        renamedForConflict: false,
      },
      {
        sourceKind: 'local',
        originalSource: sourcePath,
        copied: false,
        byteLength: sourceInformation.size,
        markdown,
      },
    );
  }

  let destination = await resolveAssetDestination({ ...request, filename: requestedFilename });
  if (pathsEqual(sourcePath, destination.assetPath)) {
    const markdown = calculateMarkdownAssetPath(
      sourcePath,
      request.context,
      request.markdownPathPreference,
    );
    return buildWriteResult(destination, {
      sourceKind: 'local',
      originalSource: sourcePath,
      copied: false,
      byteLength: sourceInformation.size,
      markdown,
    });
  }

  destination = await copyWithConflictHandling(
    sourcePath,
    destination,
    request.conflictPolicy ?? 'rename',
    request.context.maxPathLength,
  );
  const markdown = calculateMarkdownAssetPath(
    destination.assetPath,
    request.context,
    request.markdownPathPreference,
  );
  return buildWriteResult(destination, {
    sourceKind: 'local',
    originalSource: sourcePath,
    copied: true,
    byteLength: sourceInformation.size,
    markdown,
  });
}

export async function writeClipboardImageAsset(
  request: WriteClipboardImageRequest,
): Promise<AssetWriteResult> {
  assertDestinationStrategy(request.strategy);
  if (request.strategy === 'keep-original') {
    throw new AssetOperationError(
      'INVALID_DESTINATION',
      'Clipboard images must be copied to an asset destination.',
    );
  }
  const mimeType = normalizeMimeType(request.mimeType);
  const extension = MIME_EXTENSIONS[mimeType];
  if (!extension) {
    throw new AssetOperationError(
      'INVALID_ARGUMENT',
      `Clipboard content type is not a supported image: ${mimeType || '(empty)'}`,
    );
  }
  assertBoundedBytes(request.data.byteLength, request.maxBytes ?? DEFAULT_MAX_ASSET_BYTES);

  const requestedFilename = ensureFilenameExtension(request.filename, extension);
  let destination = await resolveAssetDestination({ ...request, filename: requestedFilename });
  destination = await writeBytesWithConflictHandling(
    request.data,
    destination,
    request.conflictPolicy ?? 'rename',
    request.context.maxPathLength,
  );
  const markdown = calculateMarkdownAssetPath(
    destination.assetPath,
    request.context,
    request.markdownPathPreference,
  );
  return buildWriteResult(destination, {
    sourceKind: 'clipboard',
    originalSource: null,
    copied: true,
    byteLength: request.data.byteLength,
    mimeType,
    markdown,
  });
}

export async function downloadRemoteImageAsset(
  request: DownloadRemoteImageRequest,
): Promise<AssetWriteResult> {
  assertDestinationStrategy(request.strategy);
  if (request.strategy === 'keep-original') {
    throw new AssetOperationError(
      'INVALID_DESTINATION',
      'A remote image must be copied to an asset destination before it becomes local.',
    );
  }

  const downloaded = await fetchRemoteImage(request);
  const requestedFilename = request.filename.trim()
    ? ensureFilenameExtension(request.filename, path.extname(downloaded.filename))
    : downloaded.filename;
  let destination = await resolveAssetDestination({ ...request, filename: requestedFilename });
  destination = await writeBytesWithConflictHandling(
    downloaded.bytes,
    destination,
    request.conflictPolicy ?? 'rename',
    request.context.maxPathLength,
  );
  const markdown = calculateMarkdownAssetPath(
    destination.assetPath,
    request.context,
    request.markdownPathPreference,
  );
  return buildWriteResult(destination, {
    sourceKind: 'remote',
    originalSource: request.url,
    copied: true,
    byteLength: downloaded.bytes.byteLength,
    mimeType: downloaded.mimeType,
    markdown,
  });
}

async function fetchRemoteImage(request: DownloadRemoteImageRequest): Promise<DownloadedImage> {
  const fetchImpl = request.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new AssetOperationError('DOWNLOAD_FAILED', 'No HTTP fetch implementation is available.');
  }
  const maxBytes = request.maxBytes ?? DEFAULT_MAX_ASSET_BYTES;
  assertMaximumBytes(maxBytes);
  const timeoutMs = request.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new AssetOperationError(
      'INVALID_ARGUMENT',
      'Download timeout must be between 1 and 120000 milliseconds.',
    );
  }
  const maxRedirects = request.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 20) {
    throw new AssetOperationError('INVALID_ARGUMENT', 'Maximum redirects must be between 0 and 20.');
  }

  let currentUrl = parseHttpUrl(request.url);
  let redirectCount = 0;
  const controller = new AbortController();
  let didTimeOut = false;
  const onCallerAbort = (): void => controller.abort(request.signal?.reason);
  if (request.signal?.aborted) {
    throw new AssetOperationError('DOWNLOAD_CANCELLED', 'The image download was cancelled.');
  }
  request.signal?.addEventListener('abort', onCallerAbort, { once: true });
  const timeout = setTimeout(() => {
    didTimeOut = true;
    controller.abort(new Error('Asset download timed out.'));
  }, timeoutMs);

  try {
    while (true) {
      let response: Response;
      try {
        response = await fetchImpl(currentUrl.href, {
          method: 'GET',
          redirect: 'manual',
          credentials: 'omit',
          signal: controller.signal,
          headers: { Accept: 'image/*' },
        });
      } catch (error) {
        if (didTimeOut) {
          throw new AssetOperationError(
            'DOWNLOAD_TIMEOUT',
            `The image download timed out after ${timeoutMs} ms.`,
            { cause: error },
          );
        }
        if (request.signal?.aborted || controller.signal.aborted) {
          throw new AssetOperationError('DOWNLOAD_CANCELLED', 'The image download was cancelled.', {
            cause: error,
          });
        }
        throw new AssetOperationError('DOWNLOAD_FAILED', 'The remote image request failed.', {
          cause: error,
        });
      }

      if (HTTP_REDIRECT_STATUSES.has(response.status)) {
        if (redirectCount >= maxRedirects) {
          throw new AssetOperationError(
            'TOO_MANY_REDIRECTS',
            `The image download exceeded ${maxRedirects} redirects.`,
          );
        }
        const location = response.headers.get('location');
        if (!location) {
          throw new AssetOperationError(
            'INVALID_RESPONSE',
            `The server returned redirect status ${response.status} without a Location header.`,
          );
        }
        const nextUrl = parseHttpUrl(new URL(location, currentUrl).href);
        if (currentUrl.protocol === 'https:' && nextUrl.protocol !== 'https:') {
          throw new AssetOperationError(
            'UNSAFE_REDIRECT',
            'The image download refused an HTTPS-to-HTTP redirect.',
          );
        }
        currentUrl = nextUrl;
        redirectCount += 1;
        continue;
      }

      if (!response.ok) {
        throw new AssetOperationError(
          'DOWNLOAD_FAILED',
          `The image server returned HTTP ${response.status}.`,
        );
      }

      const contentType = normalizeMimeType(response.headers.get('content-type') ?? '');
      if (contentType && !contentType.startsWith('image/')) {
        throw new AssetOperationError(
          'INVALID_RESPONSE',
          `The remote resource is not an image (${contentType}).`,
        );
      }
      const contentLength = parseContentLength(response.headers.get('content-length'));
      if (contentLength !== undefined) assertBoundedBytes(contentLength, maxBytes);
      const bytes = await readResponseBytes(response, maxBytes, controller.signal);
      if (bytes.byteLength === 0) {
        throw new AssetOperationError('INVALID_RESPONSE', 'The remote image response was empty.');
      }
      const filename = inferRemoteFilename(response, currentUrl, contentType);
      return { bytes, finalUrl: currentUrl, filename, mimeType: contentType || undefined };
    }
  } catch (error) {
    if (error instanceof AssetOperationError) throw error;
    if (didTimeOut) {
      throw new AssetOperationError(
        'DOWNLOAD_TIMEOUT',
        `The image download timed out after ${timeoutMs} ms.`,
        { cause: error },
      );
    }
    if (request.signal?.aborted || controller.signal.aborted) {
      throw new AssetOperationError('DOWNLOAD_CANCELLED', 'The image download was cancelled.', {
        cause: error,
      });
    }
    throw new AssetOperationError('DOWNLOAD_FAILED', 'The remote image response could not be read.', {
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener('abort', onCallerAbort);
  }
}

async function readResponseBytes(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    assertBoundedBytes(bytes.byteLength, maxBytes);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) {
        throw new AssetOperationError('DOWNLOAD_CANCELLED', 'The image download was cancelled.');
      }
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      assertBoundedBytes(total, maxBytes);
      chunks.push(result.value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function inferRemoteFilename(response: Response, url: URL, mimeType: string): string {
  const contentDisposition = response.headers.get('content-disposition') ?? '';
  const encodedFilename = /filename\*\s*=\s*UTF-8''([^;]+)/iu.exec(contentDisposition)?.[1];
  const ordinaryFilename = /filename\s*=\s*"([^"]+)"/iu.exec(contentDisposition)?.[1];
  let filename = encodedFilename ? safeDecodeUriComponent(encodedFilename) : ordinaryFilename;
  if (!filename) {
    const urlName = path.posix.basename(url.pathname);
    filename = safeDecodeUriComponent(urlName) || 'downloaded-image';
  }
  const extension = MIME_EXTENSIONS[mimeType] ?? '';
  return ensureFilenameExtension(sanitizeWindowsFilename(filename), extension);
}

async function inspectSourceFile(sourcePath: string): Promise<{ size: number }> {
  try {
    const information = await stat(sourcePath);
    if (!information.isFile()) {
      throw new AssetOperationError('SOURCE_NOT_FILE', 'The selected image source is not a file.', {
        path: sourcePath,
      });
    }
    return { size: information.size };
  } catch (error) {
    if (error instanceof AssetOperationError) throw error;
    if (getNodeErrorCode(error) === 'ENOENT') {
      throw new AssetOperationError('SOURCE_NOT_FOUND', 'The selected image does not exist.', {
        path: sourcePath,
        cause: error,
      });
    }
    throw fileSystemError('SOURCE_NOT_FOUND', 'Could not inspect the selected image.', sourcePath, error);
  }
}

async function prepareDestinationDirectory(
  directoryPath: string,
  maximumPathLength = DEFAULT_MAX_PATH_LENGTH,
): Promise<void> {
  assertSafePathLength(directoryPath, maximumPathLength);
  try {
    await mkdir(directoryPath, { recursive: true });
    await access(directoryPath, fileConstants.W_OK);
  } catch (error) {
    throw fileSystemError(
      'WRITE_FAILED',
      'The asset destination could not be created or is not writable.',
      directoryPath,
      error,
    );
  }
}

async function selectDestinationPath(
  directoryPath: string,
  filename: string,
  conflictPolicy: AssetConflictPolicy,
  maximumPathLength = DEFAULT_MAX_PATH_LENGTH,
): Promise<string> {
  const initialPath = path.join(directoryPath, filename);
  assertSafePathLength(initialPath, maximumPathLength);
  if (!(await pathExists(initialPath))) return initialPath;
  if (conflictPolicy === 'overwrite') return initialPath;
  if (conflictPolicy === 'error') {
    throw new AssetOperationError(
      'CONFLICT',
      `An asset named "${filename}" already exists in the destination.`,
      { path: initialPath },
    );
  }

  for (let index = 1; index <= 9_999; index += 1) {
    const candidate = path.join(directoryPath, appendConflictSuffix(filename, index));
    assertSafePathLength(candidate, maximumPathLength);
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new AssetOperationError(
    'CONFLICT',
    'No available duplicate filename could be found after 9999 attempts.',
    { path: initialPath },
  );
}

async function copyWithConflictHandling(
  sourcePath: string,
  initialDestination: ResolvedAssetDestination,
  conflictPolicy: AssetConflictPolicy,
  maximumPathLength = DEFAULT_MAX_PATH_LENGTH,
): Promise<ResolvedAssetDestination> {
  let destination = initialDestination;
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    try {
      if (conflictPolicy === 'overwrite') {
        await replaceFileAtomically(sourcePath, destination.assetPath);
      } else {
        await copyFile(sourcePath, destination.assetPath, fileConstants.COPYFILE_EXCL);
      }
      return destination;
    } catch (error) {
      if (getNodeErrorCode(error) === 'EEXIST' && conflictPolicy === 'rename') {
        destination = await nextConflictDestination(destination, maximumPathLength);
        continue;
      }
      if (getNodeErrorCode(error) === 'EEXIST' && conflictPolicy === 'error') {
        throw new AssetOperationError('CONFLICT', 'The asset destination already exists.', {
          path: destination.assetPath,
          cause: error,
        });
      }
      if (getNodeErrorCode(error) !== 'EEXIST') {
        await unlink(destination.assetPath).catch(() => undefined);
      }
      throw fileSystemError(
        'COPY_FAILED',
        'The image could not be copied to the asset destination.',
        destination.assetPath,
        error,
      );
    }
  }
  throw new AssetOperationError('CONFLICT', 'Too many concurrent filename conflicts occurred.', {
    path: initialDestination.assetPath,
  });
}

async function writeBytesWithConflictHandling(
  bytes: Uint8Array,
  initialDestination: ResolvedAssetDestination,
  conflictPolicy: AssetConflictPolicy,
  maximumPathLength = DEFAULT_MAX_PATH_LENGTH,
): Promise<ResolvedAssetDestination> {
  let destination = initialDestination;
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    if (conflictPolicy === 'overwrite') {
      try {
        await writeBytesAtomically(bytes, destination.assetPath);
        return destination;
      } catch (error) {
        throw fileSystemError(
          'WRITE_FAILED',
          'The image bytes could not be written to the asset destination.',
          destination.assetPath,
          error,
        );
      }
    }

    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let createdDestination = false;
    try {
      handle = await open(destination.assetPath, 'wx');
      createdDestination = true;
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      return destination;
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (getNodeErrorCode(error) === 'EEXIST' && conflictPolicy === 'rename') {
        destination = await nextConflictDestination(destination, maximumPathLength);
        continue;
      }
      if (getNodeErrorCode(error) === 'EEXIST' && conflictPolicy === 'error') {
        throw new AssetOperationError('CONFLICT', 'The asset destination already exists.', {
          path: destination.assetPath,
          cause: error,
        });
      }
      if (createdDestination) await unlink(destination.assetPath).catch(() => undefined);
      throw fileSystemError(
        'WRITE_FAILED',
        'The image bytes could not be written to the asset destination.',
        destination.assetPath,
        error,
      );
    }
  }
  throw new AssetOperationError('CONFLICT', 'Too many concurrent filename conflicts occurred.', {
    path: initialDestination.assetPath,
  });
}

async function writeBytesAtomically(bytes: Uint8Array, destinationPath: string): Promise<void> {
  const temporaryPath = path.join(path.dirname(destinationPath), `.markora-${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, 'wx');
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, destinationPath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function replaceFileAtomically(sourcePath: string, destinationPath: string): Promise<void> {
  const temporaryPath = path.join(path.dirname(destinationPath), `.markora-${randomUUID()}.tmp`);
  try {
    await copyFile(sourcePath, temporaryPath, fileConstants.COPYFILE_EXCL);
    await rename(temporaryPath, destinationPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function nextConflictDestination(
  current: ResolvedAssetDestination,
  maximumPathLength: number,
): Promise<ResolvedAssetDestination> {
  const selected = await selectDestinationPath(
    current.directoryPath,
    current.requestedFilename,
    'rename',
    maximumPathLength,
  );
  return {
    ...current,
    assetPath: selected,
    filename: path.basename(selected),
    renamedForConflict: path.basename(selected) !== current.requestedFilename,
  };
}

function buildWriteResult(
  destination: ResolvedAssetDestination,
  details: {
    sourceKind: AssetSourceKind;
    originalSource: string | null;
    copied: boolean;
    byteLength: number;
    mimeType?: string;
    markdown: MarkdownAssetPath;
  },
): AssetWriteResult {
  return {
    ...destination,
    sourceKind: details.sourceKind,
    originalSource: details.originalSource,
    copied: details.copied,
    byteLength: details.byteLength,
    mimeType: details.mimeType,
    markdownPath: details.markdown.value,
    markdownPathKind: details.markdown.kind,
  };
}

function validateContext(context: AssetContext): void {
  if (!context || typeof context !== 'object') {
    throw new AssetOperationError('INVALID_ARGUMENT', 'The asset context is invalid.');
  }
  validateOptionalAbsolutePath(context.documentPath, 'document path');
  validateOptionalAbsolutePath(context.workspaceRoot, 'workspace root');
  if (
    context.maxPathLength !== undefined &&
    (!Number.isSafeInteger(context.maxPathLength) || context.maxPathLength < 260)
  ) {
    throw new AssetOperationError(
      'INVALID_ARGUMENT',
      'Maximum asset path length must be an integer of at least 260.',
    );
  }
}

function assertDestinationStrategy(value: AssetDestinationStrategy): void {
  if (!ASSET_DESTINATION_STRATEGIES.includes(value)) {
    throw new AssetOperationError('INVALID_ARGUMENT', 'The asset destination strategy is invalid.');
  }
}

function assertConflictPolicy(value: AssetConflictPolicy): void {
  if (value !== 'rename' && value !== 'error' && value !== 'overwrite') {
    throw new AssetOperationError('INVALID_ARGUMENT', 'The asset conflict policy is invalid.');
  }
}

function assertMarkdownPathPreference(value: MarkdownPathPreference): void {
  if (
    value !== 'auto' &&
    value !== 'document-relative' &&
    value !== 'workspace-relative' &&
    value !== 'absolute'
  ) {
    throw new AssetOperationError('INVALID_ARGUMENT', 'The Markdown path preference is invalid.');
  }
}

function validateOptionalAbsolutePath(value: string | undefined, label: string): void {
  if (value !== undefined && (!value.trim() || !path.isAbsolute(value))) {
    throw new AssetOperationError('INVALID_ARGUMENT', `The ${label} must be an absolute path.`, {
      path: value,
    });
  }
}

function requireDocumentPath(documentPath: string | undefined): string {
  if (!documentPath) {
    throw new AssetOperationError(
      'UNSAVED_DOCUMENT',
      'Save the document before using this image destination strategy.',
    );
  }
  return documentPath;
}

function requireDocumentDirectory(documentDirectory: string | undefined): string {
  if (!documentDirectory) {
    throw new AssetOperationError(
      'UNSAVED_DOCUMENT',
      'Save the document before using a document-relative image destination.',
    );
  }
  return documentDirectory;
}

function requireWorkspaceRoot(workspaceRoot: string | undefined): string {
  if (!workspaceRoot) {
    throw new AssetOperationError(
      'WORKSPACE_REQUIRED',
      'Open a workspace before using a workspace-relative image destination.',
    );
  }
  return workspaceRoot;
}

function sanitizeDirectoryName(value: string): string {
  const sanitized = sanitizeWindowsFilename(value, 'assets');
  if (sanitized === '.' || sanitized === '..') {
    throw new AssetOperationError('INVALID_ARGUMENT', 'The asset directory name is invalid.');
  }
  return sanitized;
}

function ensurePathInside(rootPath: string, candidatePath: string): void {
  if (!isPathInside(rootPath, candidatePath)) {
    throw new AssetOperationError(
      'OUTSIDE_WORKSPACE',
      'The image is outside the selected workspace.',
      { path: candidatePath },
    );
  }
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertSafePathLength(
  candidatePath: string,
  maximumPathLength = DEFAULT_MAX_PATH_LENGTH,
): void {
  if (candidatePath.length > maximumPathLength) {
    throw new AssetOperationError(
      'PATH_TOO_LONG',
      `The asset path is ${candidatePath.length} characters; the configured limit is ${maximumPathLength}.`,
      { path: candidatePath },
    );
  }
}

function assertMaximumBytes(maximumBytes: number): void {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 1024 * 1024 * 1024) {
    throw new AssetOperationError(
      'INVALID_ARGUMENT',
      'Maximum asset size must be between 1 byte and 1 GiB.',
    );
  }
}

function assertBoundedBytes(actualBytes: number, maximumBytes: number): void {
  assertMaximumBytes(maximumBytes);
  if (actualBytes > maximumBytes) {
    throw new AssetOperationError(
      'DOWNLOAD_TOO_LARGE',
      `The image is ${actualBytes} bytes; the configured limit is ${maximumBytes} bytes.`,
    );
  }
}

function appendConflictSuffix(filename: string, index: number): string {
  const extension = path.extname(filename);
  const stem = extension ? filename.slice(0, -extension.length) : filename;
  const suffix = ` (${index})`;
  const maximumStemLength = MAX_FILENAME_LENGTH - Array.from(extension + suffix).length;
  return `${trimToCodePoints(stem, maximumStemLength)}${suffix}${extension}`;
}

function ensureFilenameExtension(filename: string, fallbackExtension: string): string {
  const sanitized = sanitizeWindowsFilename(filename);
  if (!fallbackExtension) return sanitized;
  const expectedExtension = fallbackExtension.toLowerCase();
  const currentExtension = path.extname(sanitized).toLowerCase();
  const isEquivalentJpeg =
    expectedExtension === '.jpg' && (currentExtension === '.jpg' || currentExtension === '.jpeg');
  if (currentExtension === expectedExtension || isEquivalentJpeg) return sanitized;
  const stem = currentExtension ? sanitized.slice(0, -currentExtension.length) : sanitized;
  return sanitizeWindowsFilename(`${stem}${expectedExtension}`);
}

function normalizeFilenameText(value: string): string {
  const withoutControlCharacters = Array.from(value.normalize('NFC'), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? '_' : character;
  }).join('');
  return withoutControlCharacters
    .replace(/[<>:"/\\|?*]+/gu, '_')
    .replace(/\s+/gu, ' ')
    .replace(/[ .]+$/gu, '')
    .trim();
}

function normalizeMimeType(value: string): string {
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function trimToCodePoints(value: string, maximumLength: number): string {
  return Array.from(value).slice(0, maximumLength).join('');
}

function toMarkdownPath(value: string): string {
  return value.replace(/\\/gu, '/');
}

function parseHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new AssetOperationError('INVALID_ARGUMENT', 'The remote image URL is invalid.', {
      cause: error,
    });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AssetOperationError(
      'UNSUPPORTED_PROTOCOL',
      'Only HTTP and HTTPS image URLs are supported.',
    );
  }
  if (url.username || url.password) {
    throw new AssetOperationError(
      'INVALID_ARGUMENT',
      'Image URLs containing embedded credentials are not accepted.',
    );
  }
  return url;
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function pathsEqual(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
    : path.resolve(left) === path.resolve(right);
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await access(candidatePath, fileConstants.F_OK);
    return true;
  } catch (error) {
    if (getNodeErrorCode(error) === 'ENOENT') return false;
    throw fileSystemError(
      'WRITE_FAILED',
      'The asset destination could not be inspected.',
      candidatePath,
      error,
    );
  }
}

function fileSystemError(
  fallbackCode: AssetErrorCode,
  message: string,
  affectedPath: string,
  cause: unknown,
): AssetOperationError {
  const causeCode = getNodeErrorCode(cause);
  const isWriteOperation = fallbackCode === 'WRITE_FAILED' || fallbackCode === 'COPY_FAILED';
  const isReadOnly =
    isWriteOperation &&
    (causeCode === 'EACCES' || causeCode === 'EPERM' || causeCode === 'EROFS');
  return new AssetOperationError(isReadOnly ? 'DESTINATION_READ_ONLY' : fallbackCode, message, {
    path: affectedPath,
    cause,
  });
}

function getNodeErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}
