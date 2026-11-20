import { useId, type SelectHTMLAttributes } from 'react';

export interface SelectOption { readonly value: string; readonly label: string }
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'children'> {
  readonly label: string;
  readonly options: readonly SelectOption[];
  readonly id?: string;
  readonly hint?: string;
}

export function Select({ label, options, id, hint, className = '', ...rest }: SelectProps) {
  const generated = useId();
  const controlId = id ?? generated;
  const hintId = hint ? `${controlId}-hint` : undefined;
  return <div className={`tv-field ${className}`.trim()}>
    <label htmlFor={controlId}>{label}</label>
    <select {...rest} id={controlId} aria-describedby={hintId}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    {hint ? <span id={hintId} className="tv-field__hint">{hint}</span> : null}
  </div>;
}
