import { CommandRegistry, type CommandDefinition } from './registry';

export const SHORTCUT_SETTINGS_VERSION = 2 as const;
export const SHORTCUT_SETTINGS_SCHEMA = 'markora.shortcuts' as const;

export type ShortcutConflictResolution = 'reject' | 'replace' | 'swap';

export interface ShortcutBinding {
  readonly commandId: string;
  readonly shortcut: string;
  readonly customized: boolean;
}

export interface ShortcutConflict {
  readonly shortcut: string;
  readonly commandIds: readonly string[];
}

export interface ShortcutImportResult {
  readonly migratedFrom: number;
  readonly importedCommandIds: readonly string[];
  readonly ignoredCommandIds: readonly string[];
}

interface ShortcutSettingsV2 {
  readonly schema: typeof SHORTCUT_SETTINGS_SCHEMA;
  readonly version: typeof SHORTCUT_SETTINGS_VERSION;
  readonly bindings: Readonly<Record<string, string | null>>;
}

export interface ShortcutPersistenceAdapter {
  load(): string | null;
  save(serialized: string): void;
}

export class ShortcutError extends Error {
  readonly code:
    | 'INVALID_SHORTCUT'
    | 'UNKNOWN_COMMAND'
    | 'CONFLICT'
    | 'INVALID_SETTINGS'
    | 'UNSUPPORTED_VERSION'
    | 'PERSISTENCE_FAILED';
  readonly commandId?: string;
  readonly conflicts?: readonly string[];

  constructor(
    code: ShortcutError['code'],
    message: string,
    options: { readonly commandId?: string; readonly conflicts?: readonly string[] } = {},
  ) {
    super(message);
    this.name = 'ShortcutError';
    this.code = code;
    this.commandId = options.commandId;
    this.conflicts = options.conflicts;
  }
}

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
const MODIFIER_ALIASES: Readonly<Record<string, (typeof MODIFIER_ORDER)[number]>> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  meta: 'Meta',
  cmd: 'Meta',
  command: 'Meta',
  win: 'Meta',
  windows: 'Meta',
};

const KEY_ALIASES: Readonly<Record<string, string>> = {
  esc: 'Escape',
  escape: 'Escape',
  return: 'Enter',
  enter: 'Enter',
  space: 'Space',
  spacebar: 'Space',
  del: 'Delete',
  delete: 'Delete',
  backspace: 'Backspace',
  up: 'ArrowUp',
  arrowup: 'ArrowUp',
  down: 'ArrowDown',
  arrowdown: 'ArrowDown',
  left: 'ArrowLeft',
  arrowleft: 'ArrowLeft',
  right: 'ArrowRight',
  arrowright: 'ArrowRight',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End',
  tab: 'Tab',
  plus: 'Plus',
  minus: 'Minus',
  comma: 'Comma',
  period: 'Period',
  slash: 'Slash',
  backslash: 'Backslash',
  semicolon: 'Semicolon',
  quote: 'Quote',
  bracketleft: 'BracketLeft',
  bracketright: 'BracketRight',
  backquote: 'Backquote',
};

const EVENT_KEY_NAMES: Readonly<Record<string, string>> = {
  ' ': 'Space',
  '+': 'Plus',
  '-': 'Minus',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '`': 'Backquote',
};

function normalizeKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) {
    throw new ShortcutError('INVALID_SHORTCUT', 'A shortcut stroke requires a non-modifier key.');
  }
  const alias = KEY_ALIASES[trimmed.toLocaleLowerCase('en-US')];
  if (alias) return alias;
  if (/^[a-z]$/iu.test(trimmed)) return trimmed.toLocaleUpperCase('en-US');
  if (/^[0-9]$/u.test(trimmed)) return trimmed;
  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/iu.test(trimmed)) return trimmed.toLocaleUpperCase('en-US');
  if (/^[a-z][a-z0-9]*$/iu.test(trimmed)) {
    return `${trimmed[0].toLocaleUpperCase('en-US')}${trimmed.slice(1)}`;
  }
  throw new ShortcutError('INVALID_SHORTCUT', `Unsupported shortcut key "${key}".`);
}

export function normalizeShortcutStroke(input: string): string {
  if (typeof input !== 'string' || !input.trim()) {
    throw new ShortcutError('INVALID_SHORTCUT', 'Shortcut stroke must be a non-empty string.');
  }
  const pieces = input.split('+').map((piece) => piece.trim());
  if (pieces.some((piece) => !piece)) {
    throw new ShortcutError(
      'INVALID_SHORTCUT',
      'Use the key name "Plus" instead of a literal plus key in a shortcut.',
    );
  }
  const modifiers = new Set<(typeof MODIFIER_ORDER)[number]>();
  let key: string | undefined;
  pieces.forEach((piece) => {
    const modifier = MODIFIER_ALIASES[piece.toLocaleLowerCase('en-US')];
    if (modifier) {
      if (modifiers.has(modifier)) {
        throw new ShortcutError('INVALID_SHORTCUT', `Modifier ${modifier} is repeated.`);
      }
      modifiers.add(modifier);
      return;
    }
    if (key) {
      throw new ShortcutError('INVALID_SHORTCUT', 'A shortcut stroke may contain only one key.');
    }
    key = normalizeKey(piece);
  });
  if (!key) {
    throw new ShortcutError('INVALID_SHORTCUT', 'Modifier-only shortcuts are not supported.');
  }
  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join('+');
}

export function normalizeShortcut(input: string): string {
  if (typeof input !== 'string' || !input.trim() || input.length > 200) {
    throw new ShortcutError('INVALID_SHORTCUT', 'Shortcut must be a non-empty string.');
  }
  const strokes = input.trim().split(/\s+/u);
  if (strokes.length > 4) {
    throw new ShortcutError('INVALID_SHORTCUT', 'Shortcut chords may contain at most four strokes.');
  }
  return strokes.map(normalizeShortcutStroke).join(' ');
}

export function shortcutStrokeFromKeyboardEvent(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'isComposing'>,
): string | null {
  if (event.isComposing) return null;
  const lowered = event.key.toLocaleLowerCase('en-US');
  if (['control', 'alt', 'shift', 'meta', 'os', 'dead', 'unidentified'].includes(lowered)) {
    return null;
  }
  const key = EVENT_KEY_NAMES[event.key] ?? event.key;
  const pieces = [
    event.ctrlKey ? 'Ctrl' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    event.metaKey ? 'Meta' : '',
    key,
  ].filter(Boolean);
  return normalizeShortcutStroke(pieces.join('+'));
}

export class MemoryShortcutPersistence implements ShortcutPersistenceAdapter {
  private value: string | null;

  constructor(initialValue: string | null = null) {
    this.value = initialValue;
  }

  load(): string | null {
    return this.value;
  }

  save(serialized: string): void {
    this.value = serialized;
  }
}

export class LocalStorageShortcutPersistence implements ShortcutPersistenceAdapter {
  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'>,
    private readonly key = 'markora.shortcuts',
  ) {}

  load(): string | null {
    return this.storage.getItem(this.key);
  }

  save(serialized: string): void {
    this.storage.setItem(this.key, serialized);
  }
}

function effectiveShortcut<TContext>(
  command: CommandDefinition<TContext>,
  overrides: ReadonlyMap<string, string | null>,
): string | null {
  if (overrides.has(command.id)) return overrides.get(command.id) ?? null;
  return command.defaultShortcut ? normalizeShortcut(command.defaultShortcut) : null;
}

function settingsFromUnknown(value: unknown): { version: number; bindings: Record<string, unknown> } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ShortcutError('INVALID_SETTINGS', 'Shortcut settings must be a JSON object.');
  }
  const record = value as Record<string, unknown>;
  if (record.schema === SHORTCUT_SETTINGS_SCHEMA && record.version === 2) {
    if (!record.bindings || typeof record.bindings !== 'object' || Array.isArray(record.bindings)) {
      throw new ShortcutError('INVALID_SETTINGS', 'Shortcut settings bindings must be an object.');
    }
    return { version: 2, bindings: record.bindings as Record<string, unknown> };
  }
  if (
    record.version === 1 &&
    record.shortcuts &&
    typeof record.shortcuts === 'object' &&
    !Array.isArray(record.shortcuts)
  ) {
    return { version: 1, bindings: record.shortcuts as Record<string, unknown> };
  }
  if (record.version === undefined) {
    return { version: 0, bindings: record };
  }
  throw new ShortcutError(
    'UNSUPPORTED_VERSION',
    `Shortcut settings version ${String(record.version)} is not supported.`,
  );
}

export class ShortcutManager<TContext = void> {
  private overrides = new Map<string, string | null>();

  constructor(
    readonly registry: CommandRegistry<TContext>,
    private readonly persistence?: ShortcutPersistenceAdapter,
  ) {
    const conflicts = this.findAllConflicts(this.overrides);
    if (conflicts.length) {
      throw new ShortcutError(
        'CONFLICT',
        `Default shortcuts conflict: ${conflicts.map((conflict) => conflict.shortcut).join(', ')}.`,
        { conflicts: conflicts.flatMap((conflict) => conflict.commandIds) },
      );
    }
  }

  load(): ShortcutImportResult | null {
    if (!this.persistence) return null;
    let serialized: string | null;
    try {
      serialized = this.persistence.load();
    } catch (error) {
      throw new ShortcutError(
        'PERSISTENCE_FAILED',
        `Could not read shortcut settings: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return serialized ? this.importSettings(serialized, 'replace') : null;
  }

  bindingFor(commandId: string): string | null {
    return effectiveShortcut(this.requireCommand(commandId), this.overrides);
  }

  bindings(): readonly ShortcutBinding[] {
    return this.registry.list().flatMap((command) => {
      const shortcut = effectiveShortcut(command, this.overrides);
      return shortcut
        ? [{ commandId: command.id, shortcut, customized: this.overrides.has(command.id) }]
        : [];
    });
  }

  conflictsFor(shortcut: string, excludingCommandId?: string): readonly string[] {
    const normalized = normalizeShortcut(shortcut);
    return this.registry
      .list()
      .filter(
        (command) =>
          command.id !== excludingCommandId && effectiveShortcut(command, this.overrides) === normalized,
      )
      .map((command) => command.id);
  }

  assign(commandId: string, shortcut: string, resolution: ShortcutConflictResolution = 'reject'): void {
    const command = this.requireCommand(commandId);
    const normalized = normalizeShortcut(shortcut);
    const proposed = new Map(this.overrides);
    const oldShortcut = effectiveShortcut(command, proposed);
    this.setEffectiveOverride(proposed, command, normalized);
    const conflicts = this.commandsUsing(normalized, proposed).filter((id) => id !== commandId);
    if (conflicts.length) {
      if (resolution === 'reject') {
        throw new ShortcutError('CONFLICT', `${normalized} is already assigned to ${conflicts.join(', ')}.`, {
          commandId,
          conflicts,
        });
      }
      if (resolution === 'swap') {
        if (conflicts.length !== 1) {
          throw new ShortcutError('CONFLICT', 'Swap requires exactly one conflicting command.', {
            commandId,
            conflicts,
          });
        }
        const conflicting = this.requireCommand(conflicts[0]);
        this.setEffectiveOverride(proposed, conflicting, oldShortcut);
      } else {
        conflicts.forEach((id) => proposed.set(id, null));
      }
    }
    this.commit(proposed);
  }

  clear(commandId: string): void {
    this.requireCommand(commandId);
    const proposed = new Map(this.overrides);
    proposed.set(commandId, null);
    this.commit(proposed);
  }

  reset(commandId: string, resolution: Exclude<ShortcutConflictResolution, 'swap'> = 'reject'): void {
    const command = this.requireCommand(commandId);
    const proposed = new Map(this.overrides);
    proposed.delete(commandId);
    const defaultShortcut = command.defaultShortcut ? normalizeShortcut(command.defaultShortcut) : null;
    if (defaultShortcut) {
      const conflicts = this.commandsUsing(defaultShortcut, proposed).filter((id) => id !== commandId);
      if (conflicts.length && resolution === 'reject') {
        throw new ShortcutError(
          'CONFLICT',
          `Default shortcut ${defaultShortcut} conflicts with ${conflicts.join(', ')}.`,
          { commandId, conflicts },
        );
      }
      if (resolution === 'replace') conflicts.forEach((id) => proposed.set(id, null));
    }
    this.commit(proposed);
  }

  resetAll(): void {
    this.commit(new Map());
  }

  exportSettings(pretty = true): string {
    return JSON.stringify(this.payload(this.overrides), null, pretty ? 2 : undefined);
  }

  importSettings(
    serialized: string,
    resolution: Exclude<ShortcutConflictResolution, 'swap'> = 'reject',
  ): ShortcutImportResult {
    if (typeof serialized !== 'string' || serialized.length === 0 || serialized.length > 1_048_576) {
      throw new ShortcutError('INVALID_SETTINGS', 'Shortcut settings file is empty or too large.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch (error) {
      throw new ShortcutError(
        'INVALID_SETTINGS',
        `Shortcut settings are not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const migrated = settingsFromUnknown(parsed);
    const proposed = new Map<string, string | null>();
    const importedCommandIds: string[] = [];
    const ignoredCommandIds: string[] = [];
    for (const [commandId, rawShortcut] of Object.entries(migrated.bindings)) {
      if (!this.registry.has(commandId)) {
        ignoredCommandIds.push(commandId);
        continue;
      }
      if (rawShortcut !== null && typeof rawShortcut !== 'string') {
        throw new ShortcutError('INVALID_SETTINGS', `Shortcut for ${commandId} must be a string or null.`, {
          commandId,
        });
      }
      const command = this.requireCommand(commandId);
      const shortcut = rawShortcut === null ? null : normalizeShortcut(rawShortcut);
      this.setEffectiveOverride(proposed, command, shortcut);
      importedCommandIds.push(commandId);
    }
    const conflicts = this.findAllConflicts(proposed);
    if (conflicts.length && resolution === 'reject') {
      throw new ShortcutError(
        'CONFLICT',
        `Imported shortcuts conflict: ${conflicts.map((item) => item.shortcut).join(', ')}.`,
        { conflicts: conflicts.flatMap((item) => item.commandIds) },
      );
    }
    if (resolution === 'replace') this.resolveImportedConflicts(proposed, importedCommandIds);
    this.commit(proposed);
    return {
      migratedFrom: migrated.version,
      importedCommandIds,
      ignoredCommandIds,
    };
  }

  private requireCommand(commandId: string): CommandDefinition<TContext> {
    const command = this.registry.get(commandId);
    if (!command) {
      throw new ShortcutError('UNKNOWN_COMMAND', `Unknown command "${commandId}".`, {
        commandId,
      });
    }
    return command;
  }

  private setEffectiveOverride(
    proposed: Map<string, string | null>,
    command: CommandDefinition<TContext>,
    shortcut: string | null,
  ): void {
    const defaultShortcut = command.defaultShortcut ? normalizeShortcut(command.defaultShortcut) : null;
    if (shortcut === defaultShortcut) proposed.delete(command.id);
    else proposed.set(command.id, shortcut);
  }

  private commandsUsing(shortcut: string, overrides: ReadonlyMap<string, string | null>): string[] {
    return this.registry
      .list()
      .filter((command) => effectiveShortcut(command, overrides) === shortcut)
      .map((command) => command.id);
  }

  private findAllConflicts(overrides: ReadonlyMap<string, string | null>): ShortcutConflict[] {
    const owners = new Map<string, string[]>();
    this.registry.list().forEach((command) => {
      const shortcut = effectiveShortcut(command, overrides);
      if (!shortcut) return;
      const commandIds = owners.get(shortcut) ?? [];
      commandIds.push(command.id);
      owners.set(shortcut, commandIds);
    });
    return [...owners.entries()]
      .filter(([, commandIds]) => commandIds.length > 1)
      .map(([shortcut, commandIds]) => ({ shortcut, commandIds }));
  }

  private resolveImportedConflicts(
    proposed: Map<string, string | null>,
    importedCommandIds: readonly string[],
  ): void {
    const priority = new Map(importedCommandIds.map((id, index) => [id, index]));
    for (const conflict of this.findAllConflicts(proposed)) {
      const winner = [...conflict.commandIds].sort(
        (left, right) => (priority.get(right) ?? -1) - (priority.get(left) ?? -1),
      )[0];
      conflict.commandIds.filter((id) => id !== winner).forEach((id) => proposed.set(id, null));
    }
  }

  private payload(overrides: ReadonlyMap<string, string | null>): ShortcutSettingsV2 {
    return {
      schema: SHORTCUT_SETTINGS_SCHEMA,
      version: SHORTCUT_SETTINGS_VERSION,
      bindings: Object.fromEntries(overrides),
    };
  }

  private commit(proposed: Map<string, string | null>): void {
    const conflicts = this.findAllConflicts(proposed);
    if (conflicts.length) {
      throw new ShortcutError(
        'CONFLICT',
        `Shortcut assignments conflict: ${conflicts.map((item) => item.shortcut).join(', ')}.`,
        { conflicts: conflicts.flatMap((item) => item.commandIds) },
      );
    }
    const serialized = JSON.stringify(this.payload(proposed));
    if (this.persistence) {
      try {
        this.persistence.save(serialized);
      } catch (error) {
        throw new ShortcutError(
          'PERSISTENCE_FAILED',
          `Could not save shortcut settings: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    this.overrides = proposed;
  }
}

export interface ShortcutRecorderOptions {
  readonly chordTimeoutMs?: number;
  readonly maximumStrokes?: number;
  readonly onChange?: (shortcut: string) => void;
  readonly onComplete?: (shortcut: string) => void;
  readonly onCancel?: () => void;
}

export class ShortcutRecorder {
  private readonly strokes: string[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly chordTimeoutMs: number;
  private readonly maximumStrokes: number;

  constructor(private readonly options: ShortcutRecorderOptions = {}) {
    this.chordTimeoutMs = options.chordTimeoutMs ?? 1_200;
    this.maximumStrokes = options.maximumStrokes ?? 2;
    if (!Number.isSafeInteger(this.chordTimeoutMs) || this.chordTimeoutMs < 100) {
      throw new ShortcutError('INVALID_SHORTCUT', 'Chord timeout must be at least 100 ms.');
    }
    if (!Number.isSafeInteger(this.maximumStrokes) || this.maximumStrokes < 1 || this.maximumStrokes > 4) {
      throw new ShortcutError('INVALID_SHORTCUT', 'Record between one and four shortcut strokes.');
    }
  }

  get value(): string {
    return this.strokes.join(' ');
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancel();
      return true;
    }
    if (
      event.key === 'Enter' &&
      this.strokes.length > 0 &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      this.complete();
      return true;
    }
    const stroke = shortcutStrokeFromKeyboardEvent(event);
    if (!stroke) return false;
    event.preventDefault();
    event.stopPropagation();
    if (this.strokes.length >= this.maximumStrokes) this.strokes.length = 0;
    this.strokes.push(stroke);
    this.options.onChange?.(this.value);
    if (this.strokes.length >= this.maximumStrokes) this.complete();
    else this.armCompletion();
    return true;
  }

  complete(): string | null {
    this.clearTimer();
    if (!this.strokes.length) return null;
    const shortcut = this.value;
    this.options.onComplete?.(shortcut);
    return shortcut;
  }

  cancel(): void {
    this.clearTimer();
    this.strokes.length = 0;
    this.options.onCancel?.();
  }

  dispose(): void {
    this.clearTimer();
  }

  private armCompletion(): void {
    this.clearTimer();
    this.timer = setTimeout(() => this.complete(), this.chordTimeoutMs);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    Boolean(target.closest('[contenteditable="true"]'))
  );
}

export interface ShortcutDispatcherOptions<TContext> {
  readonly chordTimeoutMs?: number;
  readonly context?: () => TContext;
  readonly onChordChange?: (pendingShortcut: string | null) => void;
  readonly onError?: (error: unknown) => void;
}

export class ShortcutDispatcher<TContext = void> {
  private pending = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly chordTimeoutMs: number;

  constructor(
    private readonly manager: ShortcutManager<TContext>,
    private readonly options: ShortcutDispatcherOptions<TContext> = {},
  ) {
    this.chordTimeoutMs = options.chordTimeoutMs ?? 1_200;
    if (!Number.isSafeInteger(this.chordTimeoutMs) || this.chordTimeoutMs < 100) {
      throw new ShortcutError('INVALID_SHORTCUT', 'Chord timeout must be at least 100 ms.');
    }
  }

  get pendingChord(): string | null {
    return this.pending || null;
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    const stroke = shortcutStrokeFromKeyboardEvent(event);
    if (!stroke) return false;
    const hasCommandModifier = /^(?:Ctrl|Alt|Meta)\+|\+(?:Ctrl|Alt|Meta)\+/u.test(stroke);
    if (!this.pending && isEditableTarget(event.target) && !hasCommandModifier) {
      return false;
    }
    const candidate = this.pending ? `${this.pending} ${stroke}` : stroke;
    let matches = this.match(candidate);
    if (!matches.exact && !matches.prefix && this.pending) {
      this.clearPending();
      matches = this.match(stroke);
    }
    if (!matches.exact && !matches.prefix) return false;

    event.preventDefault();
    event.stopPropagation();
    if (matches.prefix) {
      this.pending = matches.candidate;
      this.options.onChordChange?.(this.pending);
      this.clearTimer();
      this.timer = setTimeout(() => {
        if (matches.exact) this.execute(matches.exact);
        this.clearPending();
      }, this.chordTimeoutMs);
    } else if (matches.exact) {
      this.execute(matches.exact);
      this.clearPending();
    }
    return true;
  }

  dispose(): void {
    this.clearPending();
  }

  private match(candidate: string): {
    readonly candidate: string;
    readonly exact?: string;
    readonly prefix: boolean;
  } {
    const bindings = this.manager.bindings();
    return {
      candidate,
      exact: bindings.find(({ shortcut }) => shortcut === candidate)?.commandId,
      prefix: bindings.some(({ shortcut }) => shortcut.startsWith(`${candidate} `)),
    };
  }

  private execute(commandId: string): void {
    const context = this.options.context?.();
    this.manager.registry.execute(commandId, undefined, context as TContext).catch((error) => {
      this.options.onError?.(error);
    });
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private clearPending(): void {
    this.clearTimer();
    if (this.pending) this.options.onChordChange?.(null);
    this.pending = '';
  }
}
