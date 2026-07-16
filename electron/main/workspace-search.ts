import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants as fileConstants } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';

export type WorkspaceSearchScope = 'filename' | 'content' | 'both';
export type WorkspaceSearchMatchKind = 'filename' | 'content';

export interface WorkspaceSearchRequest {
  workspaceRoot: string;
  query: string;
  scope?: WorkspaceSearchScope;
  regex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  includeGlobs?: string[];
  excludeGlobs?: string[];
  respectGitignore?: boolean;
  ignoredDirectories?: string[];
  maxMatches?: number;
  maxFiles?: number;
  maxFileBytes?: number;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: WorkspaceSearchProgress) => void;
}

export interface WorkspaceSearchProgress {
  phase: 'enumerating' | 'searching' | 'complete';
  discoveredFiles: number;
  searchedFiles: number;
  matchCount: number;
}

export interface WorkspaceSearchMatch {
  id: string;
  fingerprint: string;
  kind: WorkspaceSearchMatchKind;
  line: number;
  column: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
  matchedText: string;
  preview: string;
  previewStartColumn: number;
  previewMatchStart: number;
  previewMatchLength: number;
}

export interface WorkspaceFileSearchResult {
  id: string;
  path: string;
  relativePath: string;
  filename: string;
  fingerprint: string;
  matches: WorkspaceSearchMatch[];
}

export interface WorkspaceSearchFailure {
  path: string;
  relativePath?: string;
  code: string;
  message: string;
}

export interface WorkspaceSearchResult {
  workspaceRoot: string;
  files: WorkspaceFileSearchResult[];
  matchCount: number;
  matchedFileCount: number;
  searchedFileCount: number;
  discoveredFileCount: number;
  truncated: boolean;
  durationMs: number;
  failures: WorkspaceSearchFailure[];
}

export interface WorkspaceReplaceSelection {
  /** Select every content match in these file groups. */
  includeFileIds?: string[];
  /** Select these individual content matches. */
  includeMatchIds?: string[];
  /** Remove individual matches from either the implicit-all or included selection. */
  excludeMatchIds?: string[];
}

export interface WorkspaceReplacePreviewRequest {
  search: WorkspaceSearchRequest;
  replacement: string;
  selection?: WorkspaceReplaceSelection;
}

export interface WorkspaceReplacePreviewMatch extends WorkspaceSearchMatch {
  replacementText: string;
  selected: boolean;
}

export interface WorkspaceReplacePreviewFile
  extends Omit<WorkspaceFileSearchResult, 'matches'> {
  matches: WorkspaceReplacePreviewMatch[];
  selectedMatchCount: number;
}

export interface WorkspaceReplacePreview {
  previewToken: string;
  confirmationToken: string;
  expiresAt: number;
  workspaceRoot: string;
  files: WorkspaceReplacePreviewFile[];
  selectedFileCount: number;
  selectedMatchCount: number;
  totalContentMatchCount: number;
  failures: WorkspaceSearchFailure[];
}

export interface ApplyWorkspaceReplaceRequest {
  previewToken: string;
  confirmationToken: string;
  confirmed: boolean;
  createBackups: boolean;
  signal?: AbortSignal;
}

export interface WorkspaceReplaceFileResult {
  fileId: string;
  path: string;
  relativePath: string;
  status: 'replaced' | 'failed' | 'cancelled';
  replacementCount: number;
  backupPath?: string;
  code?: string;
  message?: string;
}

export interface WorkspaceReplaceResult {
  previewToken: string;
  files: WorkspaceReplaceFileResult[];
  replacedFileCount: number;
  replacedMatchCount: number;
  failedFileCount: number;
  cancelled: boolean;
  backupRoot: string;
}

export type WorkspaceSearchErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_WORKSPACE'
  | 'INVALID_PATTERN'
  | 'CANCELLED'
  | 'NO_MATCHES'
  | 'PREVIEW_REQUIRED'
  | 'PREVIEW_EXPIRED'
  | 'CONFIRMATION_REQUIRED'
  | 'BACKUP_REQUIRED'
  | 'UNKNOWN_SELECTION'
  | 'FILE_CHANGED'
  | 'BACKUP_FAILED'
  | 'WRITE_FAILED';

export interface WorkspaceSearchServiceOptions {
  previewTtlMs?: number;
  maxPendingPreviews?: number;
  now?: () => number;
}

export type SerializableWorkspaceSearchRequest = Omit<
  WorkspaceSearchRequest,
  'signal' | 'onProgress'
>;
export interface SerializableWorkspaceReplacePreviewRequest
  extends Omit<WorkspaceReplacePreviewRequest, 'search'> {
  search: SerializableWorkspaceSearchRequest;
}
export type SerializableApplyWorkspaceReplaceRequest = Omit<
  ApplyWorkspaceReplaceRequest,
  'signal'
>;

/** Serializable protocol for running enumeration/search/replacement in a worker thread. */
export type WorkspaceSearchWorkerRequest =
  | {
      kind: 'search';
      operationId: string;
      request: SerializableWorkspaceSearchRequest;
    }
  | {
      kind: 'preview';
      operationId: string;
      request: SerializableWorkspaceReplacePreviewRequest;
    }
  | {
      kind: 'apply';
      operationId: string;
      request: SerializableApplyWorkspaceReplaceRequest;
    }
  | { kind: 'discard-preview'; operationId: string; previewToken: string }
  | { kind: 'cancel'; operationId: string };

export type WorkspaceSearchWorkerResponse =
  | {
      kind: 'progress';
      operationId: string;
      progress: WorkspaceSearchProgress;
    }
  | {
      kind: 'result';
      operationId: string;
      result: WorkspaceSearchResult | WorkspaceReplacePreview | WorkspaceReplaceResult | boolean;
    }
  | {
      kind: 'error';
      operationId: string;
      error: Record<string, unknown>;
    };

interface CandidateFile {
  path: string;
  relativePath: string;
  filename: string;
}

interface InternalMatch extends WorkspaceSearchMatch {
  captures: Array<string | undefined>;
  namedCaptures?: Record<string, string | undefined>;
  prefix: string;
  suffix: string;
}

interface InternalFileResult extends Omit<WorkspaceFileSearchResult, 'matches'> {
  matches: InternalMatch[];
}

interface DetailedSearchResult extends Omit<WorkspaceSearchResult, 'files'> {
  files: InternalFileResult[];
  regexMode: boolean;
}

interface StoredPreviewMatch {
  id: string;
  fingerprint: string;
  startOffset: number;
  endOffset: number;
  matchedText: string;
  replacementText: string;
}

interface StoredPreviewFile {
  id: string;
  path: string;
  relativePath: string;
  fingerprint: string;
  matches: StoredPreviewMatch[];
}

interface StoredPreview {
  previewToken: string;
  confirmationToken: string;
  workspaceRoot: string;
  expiresAt: number;
  files: StoredPreviewFile[];
}

interface CompiledPattern {
  source: string;
  flags: string;
  wholeWord: boolean;
}

interface CompiledGlob {
  original: string;
  regex: RegExp;
  negated: boolean;
  directoryOnly: boolean;
}

interface SearchConfiguration {
  workspaceRoot: string;
  scope: WorkspaceSearchScope;
  pattern: CompiledPattern;
  includeGlobs: CompiledGlob[];
  excludeGlobs: CompiledGlob[];
  gitignoreGlobs: CompiledGlob[];
  ignoredDirectories: Set<string>;
  maxMatches: number;
  maxFiles: number;
  maxFileBytes: number;
  concurrency: number;
}

const DEFAULT_INCLUDE_GLOBS = ['**/*.md', '**/*.markdown'];
const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.cache',
  '.markora',
  '.markora-cache',
  'node_modules',
  'dist',
  'release',
  'build',
  'out',
  'coverage',
  'playwright-report',
  'test-results',
  'cache',
]);
const DEFAULT_MAX_MATCHES = 20_000;
const DEFAULT_MAX_FILES = 100_000;
const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_PREVIEW_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_PENDING_PREVIEWS = 20;
const MAX_QUERY_LENGTH = 500;
const MAX_REPLACEMENT_LENGTH = 1_000_000;
const MAX_PREVIEW_LINE_LENGTH = 240;
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

export class WorkspaceSearchError extends Error {
  readonly code: WorkspaceSearchErrorCode;
  readonly path?: string;
  readonly recoverable: boolean;

  constructor(
    code: WorkspaceSearchErrorCode,
    message: string,
    options: { path?: string; cause?: unknown; recoverable?: boolean } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'WorkspaceSearchError';
    this.code = code;
    this.path = options.path;
    this.recoverable = options.recoverable ?? true;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      path: this.path,
      recoverable: this.recoverable,
    };
  }
}

export class WorkspaceSearchService {
  private readonly pendingPreviews = new Map<string, StoredPreview>();
  private readonly previewTtlMs: number;
  private readonly maxPendingPreviews: number;
  private readonly now: () => number;

  constructor(options: WorkspaceSearchServiceOptions = {}) {
    this.previewTtlMs = options.previewTtlMs ?? DEFAULT_PREVIEW_TTL_MS;
    this.maxPendingPreviews = options.maxPendingPreviews ?? DEFAULT_MAX_PENDING_PREVIEWS;
    this.now = options.now ?? Date.now;
    if (
      !Number.isSafeInteger(this.previewTtlMs) ||
      this.previewTtlMs < 1 ||
      this.previewTtlMs > 24 * 60 * 60 * 1000
    ) {
      throw new WorkspaceSearchError(
        'INVALID_REQUEST',
        'Preview lifetime must be between 1 millisecond and 24 hours.',
      );
    }
    if (
      !Number.isSafeInteger(this.maxPendingPreviews) ||
      this.maxPendingPreviews < 1 ||
      this.maxPendingPreviews > 1_000
    ) {
      throw new WorkspaceSearchError(
        'INVALID_REQUEST',
        'Pending preview capacity must be between 1 and 1000.',
      );
    }
  }

  async search(request: WorkspaceSearchRequest): Promise<WorkspaceSearchResult> {
    return toPublicSearchResult(await runDetailedSearch(request));
  }

  async createReplacePreview(
    request: WorkspaceReplacePreviewRequest,
  ): Promise<WorkspaceReplacePreview> {
    if (typeof request.replacement !== 'string' || request.replacement.length > MAX_REPLACEMENT_LENGTH) {
      throw new WorkspaceSearchError(
        'INVALID_REQUEST',
        `Replacement text must be a string no longer than ${MAX_REPLACEMENT_LENGTH} characters.`,
      );
    }
    checkCancelled(request.search.signal);
    this.prunePreviews();

    const detailed = await runDetailedSearch({ ...request.search, scope: 'content' });
    const allMatches = detailed.files.flatMap((file) => file.matches);
    if (allMatches.length === 0) {
      throw new WorkspaceSearchError('NO_MATCHES', 'No content matches are available to replace.');
    }
    const selection = selectReplacementMatches(detailed.files, request.selection);
    const selectedMatchCount = [...selection.values()].reduce(
      (total, matches) => total + matches.size,
      0,
    );
    if (selectedMatchCount === 0) {
      throw new WorkspaceSearchError('NO_MATCHES', 'The replacement selection contains no matches.');
    }

    while (this.pendingPreviews.size >= this.maxPendingPreviews) {
      const oldest = this.pendingPreviews.keys().next().value as string | undefined;
      if (!oldest) break;
      this.pendingPreviews.delete(oldest);
    }

    const previewToken = randomUUID();
    const confirmationToken = randomUUID();
    const expiresAt = this.now() + this.previewTtlMs;
    const publicFiles: WorkspaceReplacePreviewFile[] = [];
    const storedFiles: StoredPreviewFile[] = [];

    for (const file of detailed.files) {
      const selectedIds = selection.get(file.id) ?? new Set<string>();
      const previewMatches: WorkspaceReplacePreviewMatch[] = file.matches.map((match) => {
        const replacementText = expandReplacement(
          request.replacement,
          match,
          detailed.regexMode,
        );
        return { ...toPublicMatch(match), replacementText, selected: selectedIds.has(match.id) };
      });
      const selectedMatches = file.matches
        .filter((match) => selectedIds.has(match.id))
        .map((match) => ({
          id: match.id,
          fingerprint: match.fingerprint,
          startOffset: match.startOffset,
          endOffset: match.endOffset,
          matchedText: match.matchedText,
          replacementText: expandReplacement(request.replacement, match, detailed.regexMode),
        }));
      publicFiles.push({
        ...toPublicFile(file),
        matches: previewMatches,
        selectedMatchCount: selectedMatches.length,
      });
      if (selectedMatches.length > 0) {
        storedFiles.push({
          id: file.id,
          path: file.path,
          relativePath: file.relativePath,
          fingerprint: file.fingerprint,
          matches: selectedMatches,
        });
      }
    }

    this.pendingPreviews.set(previewToken, {
      previewToken,
      confirmationToken,
      workspaceRoot: detailed.workspaceRoot,
      expiresAt,
      files: storedFiles,
    });
    return {
      previewToken,
      confirmationToken,
      expiresAt,
      workspaceRoot: detailed.workspaceRoot,
      files: publicFiles,
      selectedFileCount: storedFiles.length,
      selectedMatchCount,
      totalContentMatchCount: allMatches.length,
      failures: detailed.failures,
    };
  }

  async applyReplacePreview(
    request: ApplyWorkspaceReplaceRequest,
  ): Promise<WorkspaceReplaceResult> {
    if (!request || typeof request.previewToken !== 'string') {
      throw new WorkspaceSearchError(
        'PREVIEW_REQUIRED',
        'Create a replacement preview before applying workspace changes.',
      );
    }
    const preview = this.pendingPreviews.get(request.previewToken);
    if (!preview) {
      throw new WorkspaceSearchError(
        'PREVIEW_REQUIRED',
        'The replacement preview token is unknown or has already been used.',
      );
    }
    if (preview.expiresAt <= this.now()) {
      this.pendingPreviews.delete(request.previewToken);
      throw new WorkspaceSearchError(
        'PREVIEW_EXPIRED',
        'The replacement preview expired. Create and review a new preview.',
      );
    }
    if (
      request.confirmed !== true ||
      typeof request.confirmationToken !== 'string' ||
      !tokensEqual(preview.confirmationToken, request.confirmationToken)
    ) {
      throw new WorkspaceSearchError(
        'CONFIRMATION_REQUIRED',
        'Explicit confirmation for this exact replacement preview is required.',
      );
    }
    if (request.createBackups !== true) {
      throw new WorkspaceSearchError(
        'BACKUP_REQUIRED',
        'Workspace replacement requires backups before any file is changed.',
      );
    }

    // Consume before starting writes: an apply request can never be replayed after a partial result.
    this.pendingPreviews.delete(request.previewToken);
    const backupRoot = path.join(
      preview.workspaceRoot,
      '.markora',
      'backups',
      `${formatBackupTimestamp(this.now())}-${preview.previewToken.slice(0, 8)}`,
    );
    const results: WorkspaceReplaceFileResult[] = [];
    let cancelled = false;

    for (const file of preview.files) {
      if (request.signal?.aborted) {
        cancelled = true;
        results.push({
          fileId: file.id,
          path: file.path,
          relativePath: file.relativePath,
          status: 'cancelled',
          replacementCount: 0,
          code: 'CANCELLED',
          message: 'Replacement was cancelled before this file was changed.',
        });
        continue;
      }
      const result = await applyStoredFile(preview.workspaceRoot, backupRoot, file, request.signal);
      if (result.status === 'cancelled') cancelled = true;
      results.push(result);
    }

    return {
      previewToken: preview.previewToken,
      files: results,
      replacedFileCount: results.filter((result) => result.status === 'replaced').length,
      replacedMatchCount: results.reduce(
        (total, result) => total + (result.status === 'replaced' ? result.replacementCount : 0),
        0,
      ),
      failedFileCount: results.filter((result) => result.status === 'failed').length,
      cancelled,
      backupRoot,
    };
  }

  discardReplacePreview(previewToken: string): boolean {
    return this.pendingPreviews.delete(previewToken);
  }

  private prunePreviews(): void {
    const currentTime = this.now();
    for (const [token, preview] of this.pendingPreviews) {
      if (preview.expiresAt <= currentTime) this.pendingPreviews.delete(token);
    }
  }
}

export async function searchWorkspaceAdvanced(
  request: WorkspaceSearchRequest,
): Promise<WorkspaceSearchResult> {
  return toPublicSearchResult(await runDetailedSearch(request));
}

async function runDetailedSearch(request: WorkspaceSearchRequest): Promise<DetailedSearchResult> {
  const startedAt = performance.now();
  const configuration = await validateAndCompileRequest(request);
  checkCancelled(request.signal);
  const failures: WorkspaceSearchFailure[] = [];
  const candidates = await enumerateWorkspaceFiles(
    configuration,
    failures,
    request.signal,
    request.onProgress,
  );
  const groups: InternalFileResult[] = [];
  let matchCount = 0;
  let searchedFileCount = 0;
  let matchLimitReached = false;

  await mapWithConcurrency(candidates.files, configuration.concurrency, async (candidate) => {
    if (matchLimitReached || request.signal?.aborted) return;
    const remaining = configuration.maxMatches - matchCount;
    if (remaining <= 0) {
      matchLimitReached = true;
      return;
    }
    try {
      const group = await searchCandidateFile(candidate, configuration, remaining, request.signal);
      searchedFileCount += 1;
      if (group && group.matches.length > 0) {
        const available = Math.max(0, configuration.maxMatches - matchCount);
        if (group.matches.length > available) group.matches = group.matches.slice(0, available);
        matchCount += group.matches.length;
        groups.push(group);
        if (matchCount >= configuration.maxMatches) matchLimitReached = true;
      }
    } catch (error) {
      if (error instanceof WorkspaceSearchError && error.code === 'CANCELLED') throw error;
      searchedFileCount += 1;
      failures.push(toSearchFailure(error, candidate.path, candidate.relativePath));
    }
    request.onProgress?.({
      phase: 'searching',
      discoveredFiles: candidates.files.length,
      searchedFiles: searchedFileCount,
      matchCount,
    });
  });
  checkCancelled(request.signal);

  groups.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, undefined, {
      numeric: true,
      sensitivity: 'base',
    }),
  );
  request.onProgress?.({
    phase: 'complete',
    discoveredFiles: candidates.files.length,
    searchedFiles: searchedFileCount,
    matchCount,
  });
  return {
    workspaceRoot: configuration.workspaceRoot,
    files: groups,
    matchCount,
    matchedFileCount: groups.length,
    searchedFileCount,
    discoveredFileCount: candidates.files.length,
    truncated: candidates.truncated || matchLimitReached,
    durationMs: performance.now() - startedAt,
    failures,
    regexMode: request.regex === true,
  };
}

async function validateAndCompileRequest(
  request: WorkspaceSearchRequest,
): Promise<SearchConfiguration> {
  if (!request || typeof request !== 'object') {
    throw new WorkspaceSearchError('INVALID_REQUEST', 'The workspace search request is invalid.');
  }
  if (typeof request.workspaceRoot !== 'string' || !path.isAbsolute(request.workspaceRoot)) {
    throw new WorkspaceSearchError(
      'INVALID_WORKSPACE',
      'The workspace root must be an absolute path.',
      { path: request.workspaceRoot },
    );
  }
  const workspaceRoot = path.resolve(request.workspaceRoot);
  try {
    const information = await stat(workspaceRoot);
    if (!information.isDirectory()) throw new Error('Not a directory.');
  } catch (error) {
    throw new WorkspaceSearchError(
      'INVALID_WORKSPACE',
      'The workspace root does not exist or is not a readable directory.',
      { path: workspaceRoot, cause: error },
    );
  }
  if (
    typeof request.query !== 'string' ||
    request.query.length === 0 ||
    request.query.length > MAX_QUERY_LENGTH
  ) {
    throw new WorkspaceSearchError(
      'INVALID_REQUEST',
      `Search text must contain between 1 and ${MAX_QUERY_LENGTH} characters.`,
    );
  }
  const scope = request.scope ?? 'content';
  if (scope !== 'filename' && scope !== 'content' && scope !== 'both') {
    throw new WorkspaceSearchError('INVALID_REQUEST', 'The workspace search scope is invalid.');
  }

  const maxMatches = boundedInteger(request.maxMatches, DEFAULT_MAX_MATCHES, 1, 1_000_000, 'matches');
  const maxFiles = boundedInteger(request.maxFiles, DEFAULT_MAX_FILES, 1, 1_000_000, 'files');
  const maxFileBytes = boundedInteger(
    request.maxFileBytes,
    DEFAULT_MAX_FILE_BYTES,
    1,
    100 * 1024 * 1024,
    'file bytes',
  );
  const concurrency = boundedInteger(request.concurrency, DEFAULT_CONCURRENCY, 1, 32, 'concurrency');
  const includeGlobs = compileGlobList(request.includeGlobs ?? DEFAULT_INCLUDE_GLOBS, false);
  if (includeGlobs.length === 0) {
    throw new WorkspaceSearchError('INVALID_REQUEST', 'At least one include glob is required.');
  }
  const excludeGlobs = compileGlobList(request.excludeGlobs ?? [], false);
  const gitignoreGlobs = request.respectGitignore === false
    ? []
    : await readRootGitignore(workspaceRoot);
  const ignoredDirectories = validateIgnoredDirectories(request.ignoredDirectories ?? []);
  return {
    workspaceRoot,
    scope,
    pattern: compileSearchPattern(request),
    includeGlobs,
    excludeGlobs,
    gitignoreGlobs,
    ignoredDirectories,
    maxMatches,
    maxFiles,
    maxFileBytes,
    concurrency,
  };
}

async function enumerateWorkspaceFiles(
  configuration: SearchConfiguration,
  failures: WorkspaceSearchFailure[],
  signal: AbortSignal | undefined,
  onProgress: WorkspaceSearchRequest['onProgress'],
): Promise<{ files: CandidateFile[]; truncated: boolean }> {
  const files: CandidateFile[] = [];
  const directories = [configuration.workspaceRoot];
  let truncated = false;

  while (directories.length > 0) {
    checkCancelled(signal);
    const directory = directories.shift()!;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      failures.push(
        toSearchFailure(
          error,
          directory,
          toWorkspaceRelative(configuration.workspaceRoot, directory),
        ),
      );
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
    for (const entry of entries) {
      checkCancelled(signal);
      const itemPath = path.join(directory, entry.name);
      const relativePath = toWorkspaceRelative(configuration.workspaceRoot, itemPath);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!shouldIgnoreDirectory(relativePath, configuration)) directories.push(itemPath);
        continue;
      }
      if (!entry.isFile() || shouldIgnoreFile(relativePath, configuration)) continue;
      if (!matchesGlobRules(relativePath, configuration.includeGlobs, false, false)) continue;
      files.push({ path: itemPath, relativePath, filename: entry.name });
      onProgress?.({
        phase: 'enumerating',
        discoveredFiles: files.length,
        searchedFiles: 0,
        matchCount: 0,
      });
      if (files.length >= configuration.maxFiles) {
        truncated = true;
        directories.length = 0;
        break;
      }
    }
  }
  return { files, truncated };
}

function shouldIgnoreDirectory(relativePath: string, configuration: SearchConfiguration): boolean {
  const segments = relativePath.split('/');
  if (
    segments.some(
      (segment) =>
        DEFAULT_IGNORED_DIRECTORIES.has(segment.toLowerCase()) ||
        configuration.ignoredDirectories.has(segment.toLowerCase()),
    )
  ) {
    return true;
  }
  if (matchesGlobRules(relativePath, configuration.excludeGlobs, true, false)) return true;
  return matchesGlobRules(relativePath, configuration.gitignoreGlobs, true, true);
}

function shouldIgnoreFile(relativePath: string, configuration: SearchConfiguration): boolean {
  const lower = relativePath.toLowerCase();
  if (
    lower.includes('/.markora/') ||
    lower.endsWith('.markora.tmp') ||
    lower.includes('.markora-backup')
  ) {
    return true;
  }
  if (matchesGlobRules(relativePath, configuration.excludeGlobs, false, false)) return true;
  return matchesGlobRules(relativePath, configuration.gitignoreGlobs, false, true);
}

async function searchCandidateFile(
  candidate: CandidateFile,
  configuration: SearchConfiguration,
  remainingMatches: number,
  signal: AbortSignal | undefined,
): Promise<InternalFileResult | null> {
  checkCancelled(signal);
  const fileId = hashValue(`file\0${candidate.relativePath.toLowerCase()}`);
  const matches: InternalMatch[] = [];
  let fileFingerprint = '';

  if (configuration.scope === 'filename' || configuration.scope === 'both') {
    const filenameFingerprint = hashValue(candidate.filename);
    matches.push(
      ...findMatches(
        candidate.filename,
        configuration.pattern,
        'filename',
        candidate.relativePath,
        filenameFingerprint,
        remainingMatches,
      ),
    );
  }

  if (
    (configuration.scope === 'content' || configuration.scope === 'both') &&
    matches.length < remainingMatches
  ) {
    const information = await stat(candidate.path);
    if (information.size > configuration.maxFileBytes) {
      throw Object.assign(
        new Error(
          `File is ${information.size} bytes; the configured limit is ${configuration.maxFileBytes}.`,
        ),
        { code: 'FILE_TOO_LARGE' },
      );
    }
    const bytes = await readFile(candidate.path);
    checkCancelled(signal);
    if (looksBinary(bytes)) {
      throw Object.assign(new Error('Binary files are not searched as text.'), { code: 'BINARY_FILE' });
    }
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch (error) {
      throw Object.assign(new Error('File is not valid UTF-8 text.', { cause: error }), {
        code: 'INVALID_UTF8',
      });
    }
    fileFingerprint = hashBytes(bytes);
    matches.push(
      ...findMatches(
        content,
        configuration.pattern,
        'content',
        candidate.relativePath,
        fileFingerprint,
        remainingMatches - matches.length,
      ),
    );
  }

  if (matches.length === 0) return null;
  return {
    id: fileId,
    path: candidate.path,
    relativePath: candidate.relativePath,
    filename: candidate.filename,
    fingerprint: fileFingerprint || hashValue(candidate.filename),
    matches,
  };
}

function findMatches(
  text: string,
  pattern: CompiledPattern,
  kind: WorkspaceSearchMatchKind,
  relativePath: string,
  fileFingerprint: string,
  maximumMatches: number,
): InternalMatch[] {
  const expression = new RegExp(pattern.source, pattern.flags);
  const lineStarts = kind === 'content' ? calculateLineStarts(text) : [0];
  const matches: InternalMatch[] = [];
  let result: RegExpExecArray | null;

  while (matches.length < maximumMatches && (result = expression.exec(text)) !== null) {
    const startOffset = result.index;
    const endOffset = startOffset + result[0].length;
    if (!pattern.wholeWord || hasWholeWordBoundary(text, startOffset, endOffset)) {
      const location = locateOffset(text, lineStarts, startOffset, kind);
      const preview = createLinePreview(text, location.lineStart, location.lineEnd, startOffset, endOffset);
      const fingerprint = hashValue(
        `${relativePath}\0${fileFingerprint}\0${kind}\0${startOffset}\0${endOffset}\0${result[0]}`,
      );
      matches.push({
        id: fingerprint,
        fingerprint,
        kind,
        line: location.line,
        column: location.column,
        endColumn:
          endOffset <= location.lineEnd
            ? location.column + Math.max(0, endOffset - startOffset)
            : location.lineEnd - location.lineStart + 1,
        startOffset,
        endOffset,
        matchedText: result[0],
        preview: preview.text,
        previewStartColumn: preview.startColumn,
        previewMatchStart: preview.matchStart,
        previewMatchLength: preview.matchLength,
        captures: result.slice(1),
        namedCaptures: result.groups,
        prefix: text.slice(0, startOffset),
        suffix: text.slice(endOffset),
      });
    }
    if (result[0].length === 0) expression.lastIndex = advanceStringIndex(text, expression.lastIndex);
  }
  return matches;
}

function compileSearchPattern(request: WorkspaceSearchRequest): CompiledPattern {
  const source = request.regex === true ? request.query : escapeRegularExpression(request.query);
  const flags = `g${request.caseSensitive === true ? '' : 'i'}u`;
  try {
    void new RegExp(source, flags);
  } catch (error) {
    throw new WorkspaceSearchError('INVALID_PATTERN', 'The regular expression is invalid.', {
      cause: error,
    });
  }
  return { source, flags, wholeWord: request.wholeWord === true };
}

function compileGlobList(patterns: string[], allowNegation: boolean): CompiledGlob[] {
  if (!Array.isArray(patterns) || patterns.length > 200) {
    throw new WorkspaceSearchError(
      'INVALID_REQUEST',
      'Glob lists must contain no more than 200 entries.',
    );
  }
  return patterns.map((pattern) => compileGlob(pattern, allowNegation));
}

export function compileWorkspaceGlob(pattern: string): RegExp {
  return compileGlob(pattern, false).regex;
}

function compileGlob(input: string, allowNegation: boolean): CompiledGlob {
  if (typeof input !== 'string' || input.length === 0 || input.length > 500 || input.includes('\0')) {
    throw new WorkspaceSearchError('INVALID_REQUEST', 'A workspace glob is invalid.');
  }
  let pattern = input.trim().replace(/\\/gu, '/');
  let negated = false;
  if (allowNegation && pattern.startsWith('!')) {
    negated = true;
    pattern = pattern.slice(1);
  }
  if (!pattern) throw new WorkspaceSearchError('INVALID_REQUEST', 'A workspace glob is empty.');
  const directoryOnly = pattern.endsWith('/');
  pattern = pattern.replace(/^\//u, '').replace(/\/$/u, '');
  const hasSlash = pattern.includes('/');
  let body = '';

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        index += 1;
        if (pattern[index + 1] === '/') {
          index += 1;
          body += '(?:.*/)?';
        } else {
          body += '.*';
        }
      } else {
        body += '[^/]*';
      }
    } else if (character === '?') {
      body += '[^/]';
    } else if (character === '[') {
      const close = pattern.indexOf(']', index + 1);
      if (close > index + 1) {
        const content = pattern.slice(index + 1, close).replace(/\\/gu, '\\\\');
        body += `[${content.startsWith('!') ? `^${content.slice(1)}` : content}]`;
        index = close;
      } else {
        body += '\\[';
      }
    } else {
      body += escapeRegularExpression(character);
    }
  }

  const prefix = hasSlash ? '^' : '^(?:.*/)?';
  const suffix = directoryOnly ? '(?:/.*)?$' : '$';
  try {
    return {
      original: input,
      regex: new RegExp(`${prefix}${body}${suffix}`, 'iu'),
      negated,
      directoryOnly,
    };
  } catch (error) {
    throw new WorkspaceSearchError('INVALID_REQUEST', `Invalid workspace glob: ${input}`, {
      cause: error,
    });
  }
}

async function readRootGitignore(workspaceRoot: string): Promise<CompiledGlob[]> {
  try {
    const content = await readFile(path.join(workspaceRoot, '.gitignore'), 'utf8');
    const patterns: string[] = [];
    for (const rawLine of content.split(/\r?\n/gu)) {
      let line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      if (line.startsWith('\\#')) line = line.slice(1);
      patterns.push(line);
    }
    return compileGlobList(patterns, true);
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return [];
    return [];
  }
}

function matchesGlobRules(
  relativePath: string,
  rules: CompiledGlob[],
  isDirectory: boolean,
  orderedNegation: boolean,
): boolean {
  let matched = false;
  const candidates = isDirectory
    ? [relativePath, `${relativePath}/`, `${relativePath}/__markora_descendant__`]
    : [relativePath];
  for (const rule of rules) {
    if (candidates.some((candidate) => rule.regex.test(candidate))) {
      if (orderedNegation) matched = !rule.negated;
      else if (!rule.negated) return true;
    }
  }
  return matched;
}

function validateIgnoredDirectories(values: string[]): Set<string> {
  if (!Array.isArray(values) || values.length > 200) {
    throw new WorkspaceSearchError(
      'INVALID_REQUEST',
      'Ignored-directory lists must contain no more than 200 entries.',
    );
  }
  const result = new Set<string>();
  for (const value of values) {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.includes('/') ||
      value.includes('\\') ||
      value === '.' ||
      value === '..'
    ) {
      throw new WorkspaceSearchError(
        'INVALID_REQUEST',
        'Custom ignored directories must be individual directory names.',
      );
    }
    result.add(value.toLowerCase());
  }
  return result;
}

function selectReplacementMatches(
  files: InternalFileResult[],
  selection: WorkspaceReplaceSelection | undefined,
): Map<string, Set<string>> {
  const contentMatches = files.flatMap((file) =>
    file.matches.filter((match) => match.kind === 'content').map((match) => ({ file, match })),
  );
  const knownFileIds = new Set(files.map((file) => file.id));
  const knownMatchIds = new Set(contentMatches.map(({ match }) => match.id));
  const includeFileIds = new Set(selection?.includeFileIds ?? []);
  const includeMatchIds = new Set(selection?.includeMatchIds ?? []);
  const excludeMatchIds = new Set(selection?.excludeMatchIds ?? []);

  for (const fileId of includeFileIds) {
    if (!knownFileIds.has(fileId)) {
      throw new WorkspaceSearchError(
        'UNKNOWN_SELECTION',
        `The replacement selection contains an unknown file identifier: ${fileId}`,
      );
    }
  }
  for (const matchId of [...includeMatchIds, ...excludeMatchIds]) {
    if (!knownMatchIds.has(matchId)) {
      throw new WorkspaceSearchError(
        'UNKNOWN_SELECTION',
        `The replacement selection contains an unknown match identifier: ${matchId}`,
      );
    }
  }

  const hasExplicitIncludes = includeFileIds.size > 0 || includeMatchIds.size > 0;
  const selected = new Map<string, Set<string>>();
  for (const { file, match } of contentMatches) {
    const included = hasExplicitIncludes
      ? includeFileIds.has(file.id) || includeMatchIds.has(match.id)
      : true;
    if (included && !excludeMatchIds.has(match.id)) {
      const fileMatches = selected.get(file.id) ?? new Set<string>();
      fileMatches.add(match.id);
      selected.set(file.id, fileMatches);
    }
  }
  return selected;
}

function expandReplacement(template: string, match: InternalMatch, regexMode: boolean): string {
  if (!regexMode) return template;
  return template.replace(/\$(\$|&|`|'|<[^>]+>|\d{1,2})/gu, (token, expression: string) => {
    if (expression === '$') return '$';
    if (expression === '&') return match.matchedText;
    if (expression === '`') return match.prefix;
    if (expression === "'") return match.suffix;
    if (expression.startsWith('<')) {
      const name = expression.slice(1, -1);
      return match.namedCaptures?.[name] ?? token;
    }
    const captureIndex = Number(expression);
    if (captureIndex === 0 || captureIndex > match.captures.length) return token;
    return match.captures[captureIndex - 1] ?? '';
  });
}

async function applyStoredFile(
  workspaceRoot: string,
  backupRoot: string,
  file: StoredPreviewFile,
  signal: AbortSignal | undefined,
): Promise<WorkspaceReplaceFileResult> {
  const base = {
    fileId: file.id,
    path: file.path,
    relativePath: file.relativePath,
    replacementCount: 0,
  };
  try {
    checkCancelled(signal);
    ensureInsideWorkspace(workspaceRoot, file.path);
    const originalBytes = await readFile(file.path);
    if (hashBytes(originalBytes) !== file.fingerprint) {
      throw new WorkspaceSearchError(
        'FILE_CHANGED',
        'The file changed after the replacement preview was created.',
        { path: file.path },
      );
    }
    const original = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(originalBytes);
    validateStoredMatches(file, original);
    const replacement = applyStoredMatches(original, file.matches);
    const backupPath = path.join(backupRoot, ...file.relativePath.split('/'));
    ensureInsideWorkspace(workspaceRoot, backupPath);
    try {
      await mkdir(path.dirname(backupPath), { recursive: true });
      await copyFile(file.path, backupPath, fileConstants.COPYFILE_EXCL);
    } catch (error) {
      throw new WorkspaceSearchError('BACKUP_FAILED', 'Could not create the required backup.', {
        path: backupPath,
        cause: error,
      });
    }
    checkCancelled(signal);
    await atomicReplaceIfUnchanged(file.path, replacement, file.fingerprint);
    return {
      ...base,
      status: 'replaced',
      replacementCount: file.matches.length,
      backupPath,
    };
  } catch (error) {
    const cancelled = error instanceof WorkspaceSearchError && error.code === 'CANCELLED';
    return {
      ...base,
      status: cancelled ? 'cancelled' : 'failed',
      code: error instanceof WorkspaceSearchError ? error.code : getErrorCode(error) ?? 'WRITE_FAILED',
      message: error instanceof Error ? error.message : 'The file could not be replaced.',
    };
  }
}

function validateStoredMatches(file: StoredPreviewFile, content: string): void {
  let previousEnd = -1;
  const ordered = [...file.matches].sort((left, right) => left.startOffset - right.startOffset);
  for (const match of ordered) {
    if (
      match.startOffset < previousEnd ||
      match.startOffset < 0 ||
      match.endOffset < match.startOffset ||
      match.endOffset > content.length ||
      content.slice(match.startOffset, match.endOffset) !== match.matchedText
    ) {
      throw new WorkspaceSearchError(
        'FILE_CHANGED',
        'A replacement match no longer corresponds to the previewed text.',
        { path: file.path },
      );
    }
    const expectedFingerprint = hashValue(
      `${file.relativePath}\0${file.fingerprint}\0content\0${match.startOffset}\0${match.endOffset}\0${match.matchedText}`,
    );
    if (expectedFingerprint !== match.fingerprint || match.id !== match.fingerprint) {
      throw new WorkspaceSearchError(
        'FILE_CHANGED',
        'A replacement match fingerprint is invalid.',
        { path: file.path },
      );
    }
    previousEnd = match.endOffset;
  }
}

function applyStoredMatches(content: string, matches: StoredPreviewMatch[]): string {
  let output = content;
  for (const match of [...matches].sort((left, right) => right.startOffset - left.startOffset)) {
    output = `${output.slice(0, match.startOffset)}${match.replacementText}${output.slice(match.endOffset)}`;
  }
  return output;
}

async function atomicReplaceIfUnchanged(
  filePath: string,
  content: string,
  expectedFingerprint: string,
): Promise<void> {
  const information = await stat(filePath);
  const temporaryPath = path.join(path.dirname(filePath), `.markora-${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, 'wx', information.mode);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    const currentBytes = await readFile(filePath);
    if (hashBytes(currentBytes) !== expectedFingerprint) {
      throw new WorkspaceSearchError(
        'FILE_CHANGED',
        'The file changed while the replacement was being prepared.',
        { path: filePath },
      );
    }
    await rename(temporaryPath, filePath);
    await chmod(filePath, information.mode);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    if (error instanceof WorkspaceSearchError) throw error;
    throw new WorkspaceSearchError('WRITE_FAILED', 'The replacement could not be written atomically.', {
      path: filePath,
      cause: error,
    });
  }
}

async function mapWithConcurrency<T>(
  values: T[],
  concurrency: number,
  callback: (value: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      await callback(values[index]!);
      if (index % 25 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
  });
  await Promise.all(workers);
}

function toPublicSearchResult(result: DetailedSearchResult): WorkspaceSearchResult {
  return {
    workspaceRoot: result.workspaceRoot,
    files: result.files.map(toPublicFile),
    matchCount: result.matchCount,
    matchedFileCount: result.matchedFileCount,
    searchedFileCount: result.searchedFileCount,
    discoveredFileCount: result.discoveredFileCount,
    truncated: result.truncated,
    durationMs: result.durationMs,
    failures: result.failures,
  };
}

function toPublicFile(file: InternalFileResult): WorkspaceFileSearchResult {
  return {
    id: file.id,
    path: file.path,
    relativePath: file.relativePath,
    filename: file.filename,
    fingerprint: file.fingerprint,
    matches: file.matches.map(toPublicMatch),
  };
}

function toPublicMatch(match: InternalMatch): WorkspaceSearchMatch {
  return {
    id: match.id,
    fingerprint: match.fingerprint,
    kind: match.kind,
    line: match.line,
    column: match.column,
    endColumn: match.endColumn,
    startOffset: match.startOffset,
    endOffset: match.endOffset,
    matchedText: match.matchedText,
    preview: match.preview,
    previewStartColumn: match.previewStartColumn,
    previewMatchStart: match.previewMatchStart,
    previewMatchLength: match.previewMatchLength,
  };
}

function calculateLineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function locateOffset(
  text: string,
  lineStarts: number[],
  offset: number,
  kind: WorkspaceSearchMatchKind,
): { line: number; column: number; lineStart: number; lineEnd: number } {
  if (kind === 'filename') {
    return { line: 1, column: offset + 1, lineStart: 0, lineEnd: text.length };
  }
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle]! <= offset) low = middle + 1;
    else high = middle - 1;
  }
  const lineIndex = Math.max(0, high);
  const lineStart = lineStarts[lineIndex]!;
  let lineEnd = text.indexOf('\n', lineStart);
  if (lineEnd < 0) lineEnd = text.length;
  if (lineEnd > lineStart && text[lineEnd - 1] === '\r') lineEnd -= 1;
  return { line: lineIndex + 1, column: offset - lineStart + 1, lineStart, lineEnd };
}

function createLinePreview(
  text: string,
  lineStart: number,
  lineEnd: number,
  matchStart: number,
  matchEnd: number,
): { text: string; startColumn: number; matchStart: number; matchLength: number } {
  const startInLine = Math.max(0, matchStart - lineStart);
  const endInLine = Math.max(startInLine, Math.min(lineEnd, matchEnd) - lineStart);
  const lineLength = lineEnd - lineStart;
  const maximumPreviewStart = Math.max(0, lineLength - MAX_PREVIEW_LINE_LENGTH);
  const previewStart = Math.min(Math.max(0, startInLine - 80), maximumPreviewStart);
  const previewEnd = Math.min(lineLength, previewStart + MAX_PREVIEW_LINE_LENGTH);
  return {
    text: text.slice(lineStart + previewStart, lineStart + previewEnd),
    startColumn: previewStart + 1,
    matchStart: startInLine - previewStart,
    matchLength: Math.max(0, Math.min(endInLine - startInLine, previewEnd - startInLine)),
  };
}

function hasWholeWordBoundary(text: string, start: number, end: number): boolean {
  const previous = codePointBefore(text, start);
  const next = end < text.length ? String.fromCodePoint(text.codePointAt(end)!) : '';
  return (!previous || !WORD_CHARACTER.test(previous)) && (!next || !WORD_CHARACTER.test(next));
}

function codePointBefore(text: string, index: number): string {
  if (index <= 0) return '';
  let start = index - 1;
  const trailing = text.charCodeAt(start);
  if (trailing >= 0xdc00 && trailing <= 0xdfff && start > 0) {
    const leading = text.charCodeAt(start - 1);
    if (leading >= 0xd800 && leading <= 0xdbff) start -= 1;
  }
  return String.fromCodePoint(text.codePointAt(start)!);
}

function advanceStringIndex(text: string, index: number): number {
  if (index >= text.length) return index + 1;
  const codePoint = text.codePointAt(index);
  return index + (codePoint !== undefined && codePoint > 0xffff ? 2 : 1);
}

function looksBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.byteLength, 8_192);
  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] === 0) return true;
  }
  return false;
}

function ensureInsideWorkspace(workspaceRoot: string, candidatePath: string): void {
  const relative = path.relative(path.resolve(workspaceRoot), path.resolve(candidatePath));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new WorkspaceSearchError(
      'INVALID_WORKSPACE',
      'A workspace operation attempted to access a path outside the workspace.',
      { path: candidatePath, recoverable: false },
    );
  }
}

function toWorkspaceRelative(workspaceRoot: string, itemPath: string): string {
  ensureInsideWorkspace(workspaceRoot, itemPath);
  return path.relative(workspaceRoot, itemPath).replace(/\\/gu, '/');
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashValue(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function tokensEqual(expected: string, received: string): boolean {
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(received, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function formatBackupTimestamp(value: number): string {
  return new Date(value).toISOString().replace(/[:.]/gu, '-');
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new WorkspaceSearchError(
      'INVALID_REQUEST',
      `Workspace search ${label} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return result;
}

function checkCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new WorkspaceSearchError('CANCELLED', 'The workspace operation was cancelled.');
  }
}

function toSearchFailure(
  error: unknown,
  affectedPath: string,
  relativePath?: string,
): WorkspaceSearchFailure {
  return {
    path: affectedPath,
    relativePath,
    code: error instanceof WorkspaceSearchError ? error.code : getErrorCode(error) ?? 'READ_FAILED',
    message: error instanceof Error ? error.message : 'The workspace item could not be searched.',
  };
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}
