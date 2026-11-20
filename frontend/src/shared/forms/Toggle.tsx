import type { ButtonHTMLAttributes } from 'react';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & { label: string; checked: boolean; onChange: (checked: boolean) => void; description?: string };
export function Toggle({ label, checked, onChange, description, id, ...props }: Props) {
  const controlId = id ?? label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return <div className="toggle-row"><div className="toggle-copy"><span id={`${controlId}-label`} className="toggle-label">{label}</span>{description && <small id={`${controlId}-description`}>{description}</small>}</div><button id={controlId} type="button" role="switch" aria-labelledby={`${controlId}-label`} aria-describedby={description ? `${controlId}-description` : undefined} aria-checked={checked} className={`toggle ${checked ? 'toggle-on' : ''}`} onClick={() => onChange(!checked)} {...props}><span /></button></div>;
}
