import { useId, type InputHTMLAttributes } from 'react';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  readonly label: string;
  readonly id?: string;
  readonly hint?: string;
  readonly error?: string;
}

export function Input({ label, id, hint, error, className = '', ...rest }: InputProps) {
  const generated = useId();
  const controlId = id ?? generated;
  const descriptionId = hint || error ? `${controlId}-description` : undefined;
  return <div className={`tv-field ${className}`.trim()}>
    <label htmlFor={controlId}>{label}</label>
    <input {...rest} id={controlId} aria-invalid={error ? true : undefined}
      aria-describedby={descriptionId} />
    {error || hint ? <span id={descriptionId} className={error ? 'tv-field__error' : 'tv-field__hint'}>
      {error ?? hint}</span> : null}
  </div>;
}
