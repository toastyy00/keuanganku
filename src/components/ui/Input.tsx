import React from 'react';
import { cn } from '../../lib/utils';

// ============================================================
//  INPUT COMPONENT — Neo-brutalism text input
// ============================================================

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Label shown above the input */
  label?: string;
  /** Error message shown below the input */
  error?: string;
  /** Helper text shown below the input (only when no error) */
  hint?: string;
  /** Leading icon or element */
  leftSection?: React.ReactNode;
  /** Trailing icon or element */
  rightSection?: React.ReactNode;
  /** Container className override */
  wrapperClassName?: string;
  /** Label className override */
  labelClassName?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      label,
      error,
      hint,
      leftSection,
      rightSection,
      wrapperClassName,
      labelClassName,
      id,
      ...props
    },
    ref
  ) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
        {label && (
          <label
            htmlFor={inputId}
            className={cn(
              'text-xs font-bold uppercase tracking-wider',
              error ? 'text-brutal-red' : 'text-brutal-black',
              labelClassName
            )}
          >
            {label}
          </label>
        )}

        <div className="relative flex items-center">
          {leftSection && (
            <div className="absolute left-3 flex items-center pointer-events-none text-brutal-black/60">
              {leftSection}
            </div>
          )}

          <input
            ref={ref}
            id={inputId}
            className={cn(
              'neo-input',
              !!leftSection && 'pl-9',
              !!rightSection && 'pr-9',
              error && '!border-brutal-red focus:!shadow-[4px_4px_0px_0px_#EF4444]',
              className
            )}
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
            {...props}
          />

          {rightSection && (
            <div className="absolute right-3 flex items-center pointer-events-none text-brutal-black/60">
              {rightSection}
            </div>
          )}
        </div>

        {error && (
          <p
            id={`${inputId}-error`}
            className="text-xs font-bold text-brutal-red uppercase tracking-wider"
            role="alert"
          >
            {error}
          </p>
        )}

        {!error && hint && (
          <p
            id={`${inputId}-hint`}
            className="text-xs text-brutal-black/60 font-medium"
          >
            {hint}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

// ============================================================
//  TEXTAREA COMPONENT
// ============================================================

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
  wrapperClassName?: string;
  labelClassName?: string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, hint, wrapperClassName, labelClassName, id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
        {label && (
          <label
            htmlFor={inputId}
            className={cn(
              'text-xs font-bold uppercase tracking-wider',
              error ? 'text-brutal-red' : 'text-brutal-black',
              labelClassName
            )}
          >
            {label}
          </label>
        )}

        <textarea
          ref={ref}
          id={inputId}
          className={cn(
            'neo-input resize-none min-h-[80px]',
            error && '!border-brutal-red',
            className
          )}
          aria-invalid={!!error}
          {...props}
        />

        {error && (
          <p className="text-xs font-bold text-brutal-red uppercase tracking-wider" role="alert">
            {error}
          </p>
        )}
        {!error && hint && (
          <p className="text-xs text-brutal-black/60 font-medium">{hint}</p>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';

export { Input, Textarea };
export type { InputProps, TextareaProps };
