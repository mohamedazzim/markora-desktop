import { useEffect, useId, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';

export interface TextInputDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly label: string;
  readonly initialValue?: string;
  readonly placeholder?: string;
  readonly submitLabel: string;
  readonly allowEmpty?: boolean;
  readonly validate?: (value: string) => string | undefined;
  readonly onRemove?: () => void;
  readonly removeLabel?: string;
  readonly onSubmit: (value: string) => void;
  readonly onClose: () => void;
}

export function TextInputDialog({
  open,
  title,
  description,
  label,
  initialValue = '',
  placeholder,
  submitLabel,
  allowEmpty = false,
  validate,
  onRemove,
  removeLabel = 'Remove link',
  onSubmit,
  onClose,
}: TextInputDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState('');
  const errorId = useId();

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    setError('');
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [initialValue, open]);

  if (!open) return null;

  return (
    <Dialog
      open={open}
      contentRef={dialogRef}
      className="markora-form-dialog markora-text-input-dialog"
      size="small"
      closeOnBackdrop={false}
      onClose={onClose}
      title={title}
      description={description}
      titleId={titleId}
      descriptionId={descriptionId}
      initialFocus="input"
    >
      <form
        className="markora-form-dialog-body"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const normalized = value.trim();
          if (!allowEmpty && !normalized) {
            setError(`${label} is required.`);
            return;
          }
          const validationError = validate?.(normalized);
          if (validationError) {
            setError(validationError);
            return;
          }
          onSubmit(normalized);
        }}
      >
        <label className="markora-form-field" htmlFor={`${titleId}-input`}>
          {label}
          <input
            id={`${titleId}-input`}
            ref={inputRef}
            value={value}
            placeholder={placeholder}
            autoComplete="url"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${descriptionId} ${errorId}` : descriptionId}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError('');
            }}
          />
        </label>
        {error ? (
          <p id={errorId} className="markora-form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="markora-dialog-actions">
          {onRemove ? (
            <button
              type="button"
              className="markora-dialog-button markora-dialog-button-danger"
              onClick={onRemove}
            >
              {removeLabel}
            </button>
          ) : null}
          <button
            type="button"
            className="markora-dialog-button markora-dialog-button-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="submit" className="markora-dialog-button markora-dialog-button-primary">
            {submitLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Validate destinations without rewriting relative paths or anchors. */
export function validateLinkDestination(value: string): string | undefined {
  if (!value) return undefined;
  if (
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 0x20 || codePoint === 0x7f;
    })
  ) {
    return 'The link destination contains unsupported control characters.';
  }
  if (/^(?:javascript|data|vbscript):/iu.test(value)) {
    return 'This link scheme is not allowed.';
  }
  if (/^(?:https?|ftp):/iu.test(value)) {
    try {
      new URL(value);
    } catch {
      return 'Enter a valid web address.';
    }
    return undefined;
  }
  if (/^mailto:/iu.test(value) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) return undefined;
  if (/^[a-z][a-z\d+.-]*:/iu.test(value))
    return 'Use a relative path, heading anchor, email, or web address.';
  return undefined;
}
