import type { HTMLAttributes } from 'react';

type Tone = 'positive' | 'warning' | 'danger' | 'neutral' | 'info' | 'synthetic';
type Props = HTMLAttributes<HTMLSpanElement> & { tone?: Tone };
export function StatusPill({ tone = 'neutral', className = '', children, ...props }: Props) {
  return <span className={`status-pill status-${tone} ${className}`} {...props}><span className="status-dot" aria-hidden="true" />{children}</span>;
}
