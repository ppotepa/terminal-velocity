import type { ReactNode } from 'react';

export interface PanelProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly eyebrow?: string;
  readonly action?: ReactNode;
  readonly className?: string;
}

export function Panel({ title, children, eyebrow, action, className = '' }: PanelProps) {
  return <section className={`tv-panel ${className}`.trim()} aria-label={title}>
    <header className="tv-panel__head">
      <div>{eyebrow ? <p className="tv-eyebrow">{eyebrow}</p> : null}<h2>{title}</h2></div>
      {action}
    </header>
    <div className="tv-panel__body">{children}</div>
  </section>;
}
