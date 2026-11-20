import type { SelectHTMLAttributes } from 'react';

type Option = { value: string; label: string; disabled?: boolean };
type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & { label: string; options: Option[]; description?: string; error?: string };
export function SelectField({ label, options, description, error, id, className = '', ...props }: Props) {
  const selectId = id ?? props.name;
  const describedBy = [description && `${selectId}-description`, error && `${selectId}-error`].filter(Boolean).join(' ') || undefined;
  return <div className="form-field"><label className="form-label" htmlFor={selectId}>{label}</label><select id={selectId} className={`form-control ${error ? 'form-control-error' : ''} ${className}`} aria-invalid={!!error} aria-describedby={describedBy} {...props}>{options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select>{description && <small id={`${selectId}-description`} className="form-hint">{description}</small>}{error && <small id={`${selectId}-error`} className="form-error" role="alert">{error}</small>}</div>;
}
