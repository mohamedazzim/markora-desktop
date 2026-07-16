import { createPortal } from 'react-dom';
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import './dialog.css';

export interface DialogProps {
  readonly open: boolean;
  readonly children: ReactNode;
  readonly onClose?: () => void;
  readonly closeOnBackdrop?: boolean;
  readonly closeOnEscape?: boolean;
  readonly onEscape?: () => void;
  readonly busy?: boolean;
  readonly className?: string;
  readonly size?: 'small' | 'medium' | 'large' | 'wide' | 'full';
  readonly title?: string;
  readonly description?: string;
  readonly titleId?: string;
  readonly descriptionId?: string;
  readonly labelledBy?: string;
  readonly describedBy?: string;
  readonly ariaLabel?: string;
  readonly role?: 'dialog' | 'alertdialog';
  readonly initialFocus?: string;
  readonly contentRef?: RefObject<HTMLDivElement | null>;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
}

/**
 * The only renderer-owned modal surface. It owns the portal, stacking, focus
 * scope, background inerting, Escape handling, and reduced-motion-friendly
 * overlay. Existing dialogs can keep their body markup and labels inside it.
 */
export function Dialog({
  open,
  children,
  onClose,
  closeOnBackdrop = false,
  closeOnEscape = true,
  onEscape,
  busy = false,
  className = '',
  size = 'medium',
  title,
  description,
  titleId: explicitTitleId,
  descriptionId: explicitDescriptionId,
  labelledBy,
  describedBy,
  ariaLabel,
  role = 'dialog',
  initialFocus,
  contentRef,
}: DialogProps) {
  const generatedTitleId = useId();
  const generatedDescriptionId = useId();
  const titleId = explicitTitleId ?? generatedTitleId;
  const descriptionId = explicitDescriptionId ?? generatedDescriptionId;
  const localRef = useRef<HTMLDivElement>(null);
  const dialogRef = contentRef ?? localRef;
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const portalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const appRoot = document.querySelector<HTMLElement>('#root');
    const previousInert = appRoot?.inert ?? false;
    if (appRoot) appRoot.inert = true;
    const frame = window.requestAnimationFrame(() => {
      const target = initialFocus ? dialogRef.current?.querySelector<HTMLElement>(initialFocus) : null;
      (target ?? focusableElements(dialogRef.current ?? document.body)[0] ?? dialogRef.current)?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (appRoot) appRoot.inert = previousInert;
      const previous = previousFocusRef.current;
      if (previous?.isConnected) previous.focus();
      previousFocusRef.current = null;
    };
  }, [dialogRef, initialFocus, open]);

  if (!open) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      if (onEscape && (busy || !closeOnEscape)) {
        event.preventDefault();
        onEscape();
        return;
      }
      if (!busy && closeOnEscape) {
        event.preventDefault();
        onClose?.();
        return;
      }
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const controls = focusableElements(dialogRef.current);
    if (!controls.length) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = controls[0];
    const last = controls.at(-1)!;
    const lastSummary = dialogRef.current
      .querySelectorAll<HTMLElement>('summary')
      .item(dialogRef.current.querySelectorAll<HTMLElement>('summary').length - 1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || document.activeElement === lastSummary)
    ) {
      event.preventDefault();
      first.focus();
    }
  };

  const portal = (
    <div
      ref={portalRef}
      className="markora-dialog-overlay"
      data-markora-dialog-overlay="true"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget && !busy) onClose?.();
      }}
    >
      <div
        ref={dialogRef}
        className={`markora-dialog markora-dialog-${size} ${className}`.trim()}
        data-markora-dialog="true"
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy ?? (title ? titleId : explicitTitleId)}
        aria-describedby={describedBy ?? (description ? descriptionId : explicitDescriptionId)}
        aria-label={ariaLabel}
        aria-busy={busy || undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {title ? (
          <header className="markora-dialog-header">
            <div>
              <h2 id={titleId}>{title}</h2>
              {description ? <p id={descriptionId}>{description}</p> : null}
            </div>
            {onClose ? (
              <button
                type="button"
                className="markora-dialog-close"
                onClick={onClose}
                disabled={busy}
                aria-label="Close"
              >
                ×
              </button>
            ) : null}
          </header>
        ) : null}
        {children}
      </div>
    </div>
  );

  return createPortal(portal, document.body);
}
