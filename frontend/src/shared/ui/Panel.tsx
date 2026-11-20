import type { PropsWithChildren, ReactNode } from 'react';

type Props = PropsWithChildren<{ title?: string; description?: string; action?: ReactNode; className?: string }>;
export function Panel({ title, description, action, className = '', children }: Props) {
  return <section className={`ui-panel ${className}`} aria-label={title}><header className="ui-panel-heading">{(title || description) && <div>{title && <h2>{title}</h2>}{description && <p>{description}</p>}</div>}{action}</header>{children}</section>;
}
