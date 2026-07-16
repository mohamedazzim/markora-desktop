import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import type { CommandDefinition, CommandRegistry } from './registry';
import type { ShortcutManager } from './shortcuts';
import './command-palette.css';

export interface CommandPaletteMatch<TContext> {
  readonly command: CommandDefinition<TContext>;
  readonly score: number;
  readonly enabled: boolean;
}

function compact(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Scores exact, prefix, substring, word-prefix, then subsequence matches. */
export function commandMatchScore<TContext>(
  command: CommandDefinition<TContext>,
  query: string,
): number | null {
  const needle = compact(query);
  if (!needle) return 0;
  const label = compact(command.label);
  const id = compact(command.id);
  const category = compact(command.category);
  const keywords = compact(command.keywords?.join(' ') ?? '');
  const haystack = `${label} ${id} ${category} ${keywords}`;
  if (label === needle) return 1_000;
  if (label.startsWith(needle)) return 900 - (label.length - needle.length);
  const labelIndex = label.indexOf(needle);
  if (labelIndex >= 0) return 800 - labelIndex;
  if (haystack.split(' ').some((word) => word.startsWith(needle))) return 700;
  const substringIndex = haystack.indexOf(needle);
  if (substringIndex >= 0) return 600 - substringIndex;

  let queryIndex = 0;
  let gaps = 0;
  let lastMatch = -1;
  for (let index = 0; index < haystack.length && queryIndex < needle.length; index += 1) {
    if (haystack[index] !== needle[queryIndex]) continue;
    if (lastMatch >= 0) gaps += index - lastMatch - 1;
    lastMatch = index;
    queryIndex += 1;
  }
  return queryIndex === needle.length ? Math.max(1, 400 - gaps) : null;
}

export function filterPaletteCommands<TContext>(
  registry: CommandRegistry<TContext>,
  query: string,
  context: TContext,
): readonly CommandPaletteMatch<TContext>[] {
  return registry
    .list()
    .flatMap((command) => {
      const score = commandMatchScore(command, query);
      return score === null ? [] : [{ command, score, enabled: registry.isEnabled(command.id, context) }];
    })
    .sort(
      (left, right) =>
        Number(right.enabled) - Number(left.enabled) ||
        right.score - left.score ||
        left.command.label.localeCompare(right.command.label),
    );
}

export interface CommandPaletteProps<TContext> {
  readonly open: boolean;
  readonly registry: CommandRegistry<TContext>;
  readonly context: TContext;
  readonly shortcuts?: ShortcutManager<TContext>;
  readonly onClose: () => void;
  readonly onExecutionError?: (error: unknown, commandId: string) => void;
  readonly title?: string;
  readonly placeholder?: string;
}

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function CommandPalette<TContext>({
  open,
  registry,
  context,
  shortcuts,
  onClose,
  onExecutionError,
  title = 'Command Palette',
  placeholder = 'Type a command…',
}: CommandPaletteProps<TContext>) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [busyCommandId, setBusyCommandId] = useState<string>();
  const [registryRevision, setRegistryRevision] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const listId = useId();
  const titleId = useId();
  const statusId = useId();

  useEffect(() => registry.subscribe(() => setRegistryRevision((value) => value + 1)), [registry]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setActiveIndex(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      const previous = previousFocusRef.current;
      if (previous?.isConnected) previous.focus();
      previousFocusRef.current = null;
    };
  }, [open]);

  const matches = useMemo(
    () => filterPaletteCommands(registry, query, context),
    [context, query, registry, registryRevision],
  );
  const active = matches[activeIndex];

  useEffect(() => {
    if (activeIndex >= matches.length) setActiveIndex(Math.max(0, matches.length - 1));
  }, [activeIndex, matches.length]);

  const move = (direction: 1 | -1) => {
    if (!matches.length) return;
    let next = activeIndex;
    for (let attempts = 0; attempts < matches.length; attempts += 1) {
      next = (next + direction + matches.length) % matches.length;
      if (matches[next].enabled) break;
    }
    setActiveIndex(next);
  };

  const execute = async (match: CommandPaletteMatch<TContext> | undefined) => {
    if (!match?.enabled || busyCommandId) return;
    setBusyCommandId(match.command.id);
    try {
      await registry.execute(match.command.id, undefined, context);
      onClose();
    } catch (error) {
      onExecutionError?.(error, match.command.id);
    } finally {
      setBusyCommandId(undefined);
    }
  };

  const trapTab = (event: React.KeyboardEvent) => {
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
    ).filter(
      (element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true',
    );
    if (!focusable.length) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(
          Math.max(
            0,
            matches.findIndex((match) => match.enabled),
          ),
        );
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(
          Math.max(
            0,
            matches.findLastIndex((match) => match.enabled),
          ),
        );
        break;
      case 'Enter':
        event.preventDefault();
        void execute(active);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onClose();
        break;
      case 'Tab':
        trapTab(event);
        break;
      default:
        break;
    }
  };

  if (!open) return null;

  return (
    <Dialog
      open={open}
      contentRef={dialogRef}
      className="command-palette"
      size="small"
      closeOnBackdrop
      closeOnEscape={false}
      onClose={onClose}
      labelledBy={titleId}
      describedBy={statusId}
    >
      <div onKeyDown={handleKeyDown}>
        <h2 id={titleId} className="command-palette-title">
          {title}
        </h2>
        <input
          ref={inputRef}
          className="command-palette-input"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={active ? `${listId}-${active.command.id}` : undefined}
          aria-label="Search commands"
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setActiveIndex(0);
          }}
        />
        <div id={statusId} className="command-palette-sr-only" role="status" aria-live="polite">
          {matches.length === 1 ? '1 command found.' : `${matches.length} commands found.`}
        </div>
        <div id={listId} className="command-palette-results" role="listbox" aria-label="Commands">
          {matches.length === 0 ? (
            <p className="command-palette-empty">No matching commands</p>
          ) : (
            matches.map((match, index) => (
              <button
                id={`${listId}-${match.command.id}`}
                key={match.command.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                aria-disabled={!match.enabled}
                disabled={!match.enabled || Boolean(busyCommandId)}
                className="command-palette-option"
                onMouseMove={() => match.enabled && setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void execute(match)}
              >
                <span className="command-palette-option-text">
                  <span className="command-palette-option-label">{match.command.label}</span>
                  <span className="command-palette-option-category">{match.command.category}</span>
                </span>
                {shortcuts?.bindingFor(match.command.id) ? (
                  <kbd>{shortcuts.bindingFor(match.command.id)}</kbd>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}
