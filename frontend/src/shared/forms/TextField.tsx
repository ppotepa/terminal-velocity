import type { InputHTMLAttributes } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & { label: string; description?: string; error?: string };
export function TextField({ label, description, error, id, className = '', ...props }: Props) {
  const inputId = id ?? props.name;
  const describedBy = [description && `${inputId}-description`, error && `${inputId}-error`].filter(Boolean).join(' ') || undefined;
  return <div className="form-field"><label className="form-label" htmlFor={inputId}>{label}</label><input id={inputId} className={`form-control ${error ? 'form-control-error' : ''} ${className}`} aria-invalid={!!error} aria-describedby={describedBy} {...props} />{description && <small id={`${inputId}-description`} className="form-hint">{description}</small>}{error && <small id={`${inputId}-error`} className="form-error" role="alert">{error}</small>}</div>;
}
