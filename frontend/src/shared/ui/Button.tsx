import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import './primitives.css';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; size?: 'sm' | 'md' };
export function Button({ variant = 'secondary', size = 'md', className = '', children, type = 'button', ...props }: PropsWithChildren<Props>) {
  return <button type={type} className={`ui-button ui-button-${variant} ui-button-${size} ${className}`} {...props}>{children}</button>;
}
