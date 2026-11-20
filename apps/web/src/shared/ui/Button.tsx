import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly children: ReactNode;
  readonly variant?: 'primary' | 'quiet';
  readonly busy?: boolean;
}

export function Button({ children, variant = 'quiet', busy = false, disabled, className = '', ...rest }: ButtonProps) {
  return <button {...rest} type={rest.type ?? 'button'}
    className={`tv-button tv-button--${variant} ${className}`.trim()}
    disabled={disabled || busy} aria-busy={busy}>
    {busy ? <span className="tv-button__busy" aria-hidden="true" /> : null}
    {children}
  </button>;
}
