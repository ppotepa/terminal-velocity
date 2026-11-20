import type { ReactNode } from 'react';

export interface StateMessageProps {
  readonly kind: 'loading' | 'empty' | 'error';
  readonly title: string;
  readonly children?: ReactNode;
}

export function StateMessage({ kind, title, children }: StateMessageProps) {
  return <div className={`tv-state tv-state--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
    {kind === 'loading' ? <span className="tv-skeleton" aria-hidden="true" /> : null}
    <strong>{title}</strong>
    {children ? <p>{children}</p> : null}
  </div>;
}
