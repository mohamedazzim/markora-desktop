import { useEffect, useId, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';

export interface TableInsertDialogProps {
  readonly open: boolean;
  readonly onInsert: (rows: number, columns: number) => void;
  readonly onClose: () => void;
}

export function TableInsertDialog({ open, onInsert, onClose }: TableInsertDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(3);
  const [columns, setColumns] = useState(3);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setRows(3);
    setColumns(3);
    setError('');
    window.requestAnimationFrame(() => firstFieldRef.current?.focus());
  }, [open]);

  if (!open) return null;

  return (
    <Dialog
      open={open}
      contentRef={dialogRef}
      className="markora-form-dialog markora-table-dialog"
      size="small"
      closeOnBackdrop={false}
      onClose={onClose}
      title="Insert table"
      description="Choose 2–50 rows and 1–20 columns. The first row is a header."
      titleId={titleId}
      descriptionId={descriptionId}
      initialFocus="input"
    >
      <form
        className="markora-form-dialog-body"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!Number.isInteger(rows) || rows < 2 || rows > 50) {
            setError('Rows must be a whole number from 2 to 50.');
            return;
          }
          if (!Number.isInteger(columns) || columns < 1 || columns > 20) {
            setError('Columns must be a whole number from 1 to 20.');
            return;
          }
          onInsert(rows, columns);
        }}
      >
        <label className="markora-form-field">
          Rows
          <input
            ref={firstFieldRef}
            type="number"
            min={2}
            max={50}
            step={1}
            value={rows}
            onChange={(event) => setRows(event.target.valueAsNumber)}
          />
        </label>
        <label className="markora-form-field">
          Columns
          <input
            type="number"
            min={1}
            max={20}
            step={1}
            value={columns}
            onChange={(event) => setColumns(event.target.valueAsNumber)}
          />
        </label>
        {error ? (
          <p className="markora-form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="markora-dialog-actions">
          <button
            type="button"
            className="markora-dialog-button markora-dialog-button-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="submit" className="markora-dialog-button markora-dialog-button-primary">
            Insert table
          </button>
        </div>
      </form>
    </Dialog>
  );
}
