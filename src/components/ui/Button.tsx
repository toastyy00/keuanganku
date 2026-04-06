import React from 'react';
import { cn } from '../../lib/utils';

// ============================================================
//  BUTTON COMPONENT — Neo-brutalism with variants
// ============================================================

type ButtonVariant = 'primary' | 'secondary' | 'destructive';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** If true, button takes full width */
  fullWidth?: boolean;
  /** Optional leading icon */
  leftIcon?: React.ReactNode;
  /** Optional trailing icon */
  rightIcon?: React.ReactNode;
  /** Loading state — shows spinner and disables */
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'neo-btn-primary',
  secondary: 'neo-btn-secondary',
  destructive: 'neo-btn-destructive',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'text-xs px-3 py-1.5 gap-1.5',
  md: 'text-sm px-5 py-2.5 gap-2',
  lg: 'text-base px-6 py-3 gap-2',
  icon: 'p-2 w-10 h-10',
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      fullWidth = false,
      leftIcon,
      rightIcon,
      loading = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={cn(
          'neo-btn',
          variantClasses[variant],
          sizeClasses[size],
          fullWidth && 'w-full',
          isDisabled && 'opacity-50 cursor-not-allowed',
          className
        )}
        {...props}
      >
        {loading ? (
          <span
            className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
            aria-hidden="true"
          />
        ) : (
          leftIcon
        )}
        {children}
        {!loading && rightIcon}
      </button>
    );
  }
);

Button.displayName = 'Button';

export { Button };
export type { ButtonProps, ButtonVariant, ButtonSize };
