import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../../lib/cn';

const inputBase =
  'w-full rounded-[12px] bg-fill-3 px-3.5 text-body text-label outline-none transition-shadow placeholder:text-[var(--placeholder)] focus:bg-grouped-2 focus:shadow-[0_0_0_2px_var(--tint)] disabled:opacity-50';

interface FieldShellProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode;
  className?: string;
  labelHidden?: boolean;
  required?: boolean;
}

export function FieldShell({ label, hint, error, children, className, labelHidden, required }: FieldShellProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className={cn('px-1 text-subhead font-medium text-label-2', labelHidden && 'sr-only')}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {children({ id, describedBy })}
      {hint && !error && (
        <p id={hintId} className="px-1 text-footnote text-label-2">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="px-1 text-footnote text-red">
          {error}
        </p>
      )}
    </div>
  );
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  labelHidden?: boolean;
  trailing?: ReactNode;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField({ label, hint, error, labelHidden, className, trailing, required, ...rest }, ref) {
  return (
    <FieldShell label={label} hint={hint} error={error} labelHidden={labelHidden} className={className} required={required}>
      {({ id, describedBy }) => (
        <div className="relative">
          <input
            ref={ref}
            id={id}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            required={required}
            className={cn(inputBase, 'h-12', error && 'shadow-[0_0_0_2px_var(--red)]', trailing && 'pr-12')}
            {...rest}
          />
          {trailing && <div className="absolute inset-y-0 right-2 flex items-center">{trailing}</div>}
        </div>
      )}
    </FieldShell>
  );
});

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea({ label, hint, error, className, rows = 4, required, ...rest }, ref) {
  return (
    <FieldShell label={label} hint={hint} error={error} className={className} required={required}>
      {({ id, describedBy }) => (
        <textarea
          ref={ref}
          id={id}
          rows={rows}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          required={required}
          className={cn(inputBase, 'resize-y py-3 leading-[1.4]', error && 'shadow-[0_0_0_2px_var(--red)]')}
          {...rest}
        />
      )}
    </FieldShell>
  );
});

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  options: { value: string; label: string }[];
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField({ label, hint, error, className, options, required, ...rest }, ref) {
  return (
    <FieldShell label={label} hint={hint} error={error} className={className} required={required}>
      {({ id, describedBy }) => (
        <div className="relative">
          <select
            ref={ref}
            id={id}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            required={required}
            className={cn(inputBase, 'h-12 appearance-none pr-10', error && 'shadow-[0_0_0_2px_var(--red)]')}
            {...rest}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <svg aria-hidden="true" viewBox="0 0 12 8" className="pointer-events-none absolute right-4 top-1/2 h-2 w-3 -translate-y-1/2 text-label-2">
            <path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </FieldShell>
  );
});

export function SearchField({
  value,
  onChange,
  placeholder = 'Søk',
  autoFocus,
  className,
  onSubmit,
  label = 'Søk',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  onSubmit?: () => void;
  label?: string;
}) {
  return (
    <form
      role="search"
      className={cn('relative', className)}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
        (document.activeElement as HTMLElement | null)?.blur();
      }}
    >
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-label-2" />
      <input
        type="search"
        inputMode="search"
        enterKeyHint="search"
        aria-label={label}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-[12px] bg-fill-3 pl-10 pr-10 text-body outline-none placeholder:text-[var(--placeholder)] focus:shadow-[0_0_0_2px_var(--tint)] [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label="Tøm søket"
          onClick={() => onChange('')}
          className="absolute right-0.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-label-2"
        >
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-label-3 text-bg">
            <X className="h-3 w-3" strokeWidth={3} />
          </span>
        </button>
      )}
    </form>
  );
}
