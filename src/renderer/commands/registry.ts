export interface CommandMenuPlacement {
  readonly menu: 'file' | 'edit' | 'view' | 'insert' | 'export' | 'help';
  readonly group?: string;
  readonly order?: number;
}

export interface CommandToolbarPlacement {
  readonly area: 'primary' | 'editor' | 'view' | 'overflow';
  readonly order?: number;
}

export interface CommandInvocation<TContext> {
  readonly id: string;
  readonly context: TContext;
  readonly args: unknown;
  readonly registry: CommandRegistry<TContext>;
}

export type CommandHandler<TContext> = (
  invocation: CommandInvocation<TContext>,
) => unknown | Promise<unknown>;

export interface CommandDefinition<TContext> {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly handler: CommandHandler<TContext>;
  readonly enabled: boolean | ((context: TContext) => boolean);
  readonly defaultShortcut?: string;
  readonly menu?: CommandMenuPlacement;
  readonly toolbar?: CommandToolbarPlacement;
  readonly keywords?: readonly string[];
}

export interface CommandSnapshot<TContext> extends Omit<CommandDefinition<TContext>, 'enabled'> {
  readonly enabled: boolean;
}

export type CommandRegistryChange =
  | { readonly type: 'registered'; readonly id: string }
  | { readonly type: 'unregistered'; readonly id: string };

export type CommandRegistryListener = (change: CommandRegistryChange) => void;

export class CommandRegistryError extends Error {
  readonly code: 'INVALID_COMMAND' | 'DUPLICATE_COMMAND' | 'UNKNOWN_COMMAND' | 'DISABLED_COMMAND';
  readonly commandId?: string;

  constructor(code: CommandRegistryError['code'], message: string, commandId?: string) {
    super(message);
    this.name = 'CommandRegistryError';
    this.code = code;
    this.commandId = commandId;
  }
}

const COMMAND_ID_PATTERN = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/u;

function validateDefinition<TContext>(definition: CommandDefinition<TContext>): void {
  if (!COMMAND_ID_PATTERN.test(definition.id)) {
    throw new CommandRegistryError(
      'INVALID_COMMAND',
      `Command identifier "${definition.id}" must contain stable dot-separated camel-case segments.`,
      definition.id,
    );
  }
  if (!definition.label.trim() || !definition.category.trim()) {
    throw new CommandRegistryError(
      'INVALID_COMMAND',
      `Command "${definition.id}" requires a label and category.`,
      definition.id,
    );
  }
  if (typeof definition.handler !== 'function') {
    throw new CommandRegistryError(
      'INVALID_COMMAND',
      `Command "${definition.id}" requires a handler.`,
      definition.id,
    );
  }
  if (typeof definition.enabled !== 'boolean' && typeof definition.enabled !== 'function') {
    throw new CommandRegistryError(
      'INVALID_COMMAND',
      `Command "${definition.id}" requires an enabled state.`,
      definition.id,
    );
  }
}

/** The single execution boundary shared by menus, toolbars, shortcuts, and the palette. */
export class CommandRegistry<TContext = void> {
  private readonly definitions = new Map<string, CommandDefinition<TContext>>();
  private readonly listeners = new Set<CommandRegistryListener>();
  private readonly contextProvider: () => TContext;

  constructor(contextProvider?: () => TContext) {
    this.contextProvider = contextProvider ?? (() => undefined as TContext);
  }

  register(definition: CommandDefinition<TContext>): () => void {
    validateDefinition(definition);
    if (this.definitions.has(definition.id)) {
      throw new CommandRegistryError(
        'DUPLICATE_COMMAND',
        `Command "${definition.id}" is already registered.`,
        definition.id,
      );
    }
    const frozen: CommandDefinition<TContext> = Object.freeze({
      ...definition,
      keywords: definition.keywords ? Object.freeze([...definition.keywords]) : undefined,
      menu: definition.menu ? Object.freeze({ ...definition.menu }) : undefined,
      toolbar: definition.toolbar ? Object.freeze({ ...definition.toolbar }) : undefined,
    });
    this.definitions.set(frozen.id, frozen);
    this.emit({ type: 'registered', id: frozen.id });

    let registered = true;
    return () => {
      if (!registered || this.definitions.get(frozen.id) !== frozen) return;
      registered = false;
      this.definitions.delete(frozen.id);
      this.emit({ type: 'unregistered', id: frozen.id });
    };
  }

  registerMany(definitions: readonly CommandDefinition<TContext>[]): () => void {
    const disposers: Array<() => void> = [];
    try {
      definitions.forEach((definition) => disposers.push(this.register(definition)));
    } catch (error) {
      disposers.reverse().forEach((dispose) => dispose());
      throw error;
    }
    return () => disposers.reverse().forEach((dispose) => dispose());
  }

  has(id: string): boolean {
    return this.definitions.has(id);
  }

  get(id: string): CommandDefinition<TContext> | undefined {
    return this.definitions.get(id);
  }

  require(id: string): CommandDefinition<TContext> {
    const command = this.definitions.get(id);
    if (!command) {
      throw new CommandRegistryError('UNKNOWN_COMMAND', `Command "${id}" is not registered.`, id);
    }
    return command;
  }

  list(): readonly CommandDefinition<TContext>[] {
    return [...this.definitions.values()];
  }

  snapshot(context: TContext = this.contextProvider()): readonly CommandSnapshot<TContext>[] {
    return this.list().map((command) => ({
      ...command,
      enabled: this.isEnabled(command.id, context),
    }));
  }

  isEnabled(id: string, context: TContext = this.contextProvider()): boolean {
    const command = this.require(id);
    return typeof command.enabled === 'function' ? command.enabled(context) : command.enabled;
  }

  async execute(id: string, args?: unknown, context: TContext = this.contextProvider()): Promise<unknown> {
    const command = this.require(id);
    if (!this.isEnabled(id, context)) {
      throw new CommandRegistryError('DISABLED_COMMAND', `Command "${id}" is currently disabled.`, id);
    }
    return command.handler({ id, args, context, registry: this });
  }

  subscribe(listener: CommandRegistryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(change: CommandRegistryChange): void {
    this.listeners.forEach((listener) => {
      try {
        listener(change);
      } catch {
        // Observers must not make registry mutations partially succeed.
      }
    });
  }
}
