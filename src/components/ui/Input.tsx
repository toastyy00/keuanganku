import React from 'react';
import { cn } from '../../lib/utils';

// ============================================================
//  INPUT COMPONENT — Dark Glass UI Input
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
              'text-[11px] font-medium transition-colors',
              error ? 'text-red-400' : 'text-white/40',
              labelClassName
            )}
          >
            {label}
          </label>
        )}

        <div className="relative flex items-center">
          {leftSection && (
            <div className="absolute left-3 flex items-center pointer-events-none text-white/40">
              {leftSection}
            </div>
          )}

          <input
            ref={ref}
            id={inputId}
            className={cn(
              'w-full h-10 px-3 rounded-xl bg-white/[0.05] border border-white/10 hover:border-white/20 focus:border-white/40 focus:ring-1 focus:ring-white/20 text-white placeholder:text-white/30 text-sm font-medium outline-none transition-all',
              !!leftSection && 'pl-9',
              !!rightSection && 'pr-9',
              error && 'border-red-500/50 focus:border-red-500 focus:ring-red-500/20 text-red-300',
              className
            )}
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
            {...props}
          />

          {rightSection && (
            <div className="absolute right-3 flex items-center pointer-events-none text-white/40">
              {rightSection}
            </div>
          )}
        </div>

        {error && (
          <p
            id={`${inputId}-error`}
            className="text-[11px] font-medium text-red-400"
            role="alert"
          >
            {error}
          </p>
        )}

        {!error && hint && (
          <p
            id={`${inputId}-hint`}
            className="text-[11px] text-white/40 font-medium"
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
              'text-[11px] font-medium transition-colors',
              error ? 'text-red-400' : 'text-white/40',
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
            'w-full p-3 rounded-xl bg-white/[0.05] border border-white/10 hover:border-white/20 focus:border-white/40 focus:ring-1 focus:ring-white/20 text-white placeholder:text-white/30 text-sm font-medium outline-none transition-all resize-none min-h-[80px]',
            error && 'border-red-500/50 focus:border-red-500 focus:ring-red-500/20 text-red-300',
            className
          )}
          aria-invalid={!!error}
          {...props}
        />

        {error && (
          <p className="text-[11px] font-medium text-red-400" role="alert">
            {error}
          </p>
        )}
        {!error && hint && (
          <p className="text-[11px] text-white/40 font-medium">{hint}</p>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';

export { Input, Textarea };
export type { InputProps, TextareaProps };
