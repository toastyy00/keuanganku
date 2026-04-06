import React, { useId } from 'react';
import { cn } from '../../lib/utils';
import type { ExpenseType } from '../../types';

// ============================================================
//  TOGGLE — 3-way NEED / WANT / TRANSFER selector
// ============================================================

interface ToggleOption {
  value: ExpenseType;
  label: string;
  activeClass: string;
}

const OPTIONS: ToggleOption[] = [
  { value: 'NEED',     label: 'Need',     activeClass: 'bg-blue-500 text-white' },
  { value: 'WANT',     label: 'Want',     activeClass: 'bg-pink-500 text-white' },
  { value: 'TRANSFER', label: 'Transfer', activeClass: 'bg-orange-400 text-brutal-black' },
];

interface ToggleProps {
  value: ExpenseType;
  onChange: (value: ExpenseType) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
  options?: ExpenseType[]; // e.g. ['NEED', 'WANT'] to exclude TRANSFER
}

const Toggle: React.FC<ToggleProps> = ({
  value,
  onChange,
  label,
  disabled = false,
  className,
  options,
}) => {
  const uid = useId();

  const visibleOptions = options 
    ? OPTIONS.filter(o => options.includes(o.value))
    : OPTIONS;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <span className="text-xs font-bold uppercase tracking-wider text-brutal-black">
          {label}
        </span>
      )}

      <div
        role="radiogroup"
        aria-label="Expense type"
        className={cn(
          'relative flex border-2 border-[#555555] h-11',
          disabled && 'opacity-50 pointer-events-none'
        )}
      >
        {visibleOptions.map((opt, i) => (
          <button
            key={opt.value}
            id={`${uid}-${opt.value.toLowerCase()}`}
            type="button"
            role="radio"
            aria-checked={value === opt.value}
            onClick={() => onChange(opt.value)}
            disabled={disabled}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5',
              'text-xs font-black uppercase tracking-wider',
              'transition-all duration-150',
              i < visibleOptions.length - 1 && 'border-r-2 border-[#555555]',
              value === opt.value
                ? opt.activeClass
                : 'bg-brutal-yellow-light text-brutal-black hover:bg-brutal-black/10'
            )}
          >
            <span
              className={cn(
                'w-2.5 h-2.5 border-2 border-current rounded-full transition-all duration-150 shrink-0',
                value === opt.value && 'bg-current'
              )}
            />
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export { Toggle };
export type { ToggleProps };
