import type { PropsWithChildren, ReactNode } from 'react';

type Props = PropsWithChildren<{ title: string; description?: string; action?: ReactNode; icon?: ReactNode }>;
export function EmptyState({ title, description, action, icon, children }: Props) {
  return <div className="ui-empty">{icon && <div className="ui-empty-icon" aria-hidden="true">{icon}</div>}<h3>{title}</h3>{description && <p>{description}</p>}{children}{action && <div className="ui-empty-action">{action}</div>}</div>;
}
