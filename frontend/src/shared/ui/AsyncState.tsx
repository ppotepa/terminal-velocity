import type { ReactNode } from 'react';
import { Button } from './Button';

export function LoadingState({ label = 'Loading data' }: { label?: string }) {
  return <div className="ui-loading" role="status"><span className="loading-spinner" aria-hidden="true" /><span>{label}</span></div>;
}
export function ErrorState({ title = 'Could not load this view', message, onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return <div className="ui-error" role="alert"><strong>{title}</strong>{message && <p>{message}</p>}{onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}</div>;
}
export function InlineNotice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' }) {
  return <div className={`ui-notice notice-${tone}`} role="status">{children}</div>;
}
