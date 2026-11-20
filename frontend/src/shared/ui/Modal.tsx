import { useEffect, useRef, type KeyboardEvent, type PropsWithChildren, type ReactNode } from 'react';
import { Button } from './Button';

type Props = PropsWithChildren<{ open: boolean; title: string; description?: string; onClose: () => void; footer?: ReactNode }>;
export function Modal({ open, title, description, onClose, footer, children }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('button, input, select, textarea, [tabindex="0"]')?.focus();
    return () => previous?.focus();
  }, [open]);
  if (!open) return null;
  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key !== 'Tab') return;
    const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]') ?? [])];
    if (!items.length) { event.preventDefault(); return; }
    const first = items[0]; const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div className="ui-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialogRef} className="ui-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby={description ? 'modal-description' : undefined} onKeyDown={trapFocus} tabIndex={-1}><header><div><h2 id="modal-title">{title}</h2>{description && <p id="modal-description">{description}</p>}</div><Button variant="quiet" size="sm" aria-label="Close dialog" onClick={onClose}>×</Button></header><div className="ui-modal-content">{children}</div>{footer && <footer>{footer}</footer>}</div></div>;
}
