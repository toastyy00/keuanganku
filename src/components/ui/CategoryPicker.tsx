import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Category } from '../../types';

interface CategoryPickerProps {
  label?: string;
  value: string;
  categories: Category[];
  onChange: (slug: string) => void;
  error?: string;
  hint?: string;
  placeholder?: string;
  buttonClassName?: string;
  panelClassName?: string;
}

const CategoryPicker: React.FC<CategoryPickerProps> = ({
  label = 'Kategori',
  value,
  categories,
  onChange,
  error,
  hint,
  placeholder = 'Pilih kategori',
  buttonClassName,
  panelClassName,
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [openDirection, setOpenDirection] = React.useState<'down' | 'up'>('down');
  const [panelMaxHeight, setPanelMaxHeight] = React.useState(224);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const selectedCategory = categories.find((cat) => cat.slug === value) ?? null;
  const triggerId = React.useId();
  const listboxId = `${triggerId}-listbox`;

  React.useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (root.contains(event.target as Node)) return;
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  React.useLayoutEffect(() => {
    if (!isOpen || window.innerWidth >= 640) return;

    const measurePanel = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const screenPadding = 16;
      const gap = 8;
      const availableBelow = Math.max(120, viewportHeight - rect.bottom - screenPadding - gap);
      const availableAbove = Math.max(120, rect.top - screenPadding - gap);

      if (availableBelow < 180 && availableAbove > availableBelow) {
        setOpenDirection('up');
        setPanelMaxHeight(Math.min(224, availableAbove));
        return;
      }

      setOpenDirection('down');
      setPanelMaxHeight(Math.min(224, availableBelow));
    };

    measurePanel();
    window.addEventListener('resize', measurePanel);

    return () => {
      window.removeEventListener('resize', measurePanel);
    };
  }, [isOpen]);

  return (
    <div ref={rootRef} className="flex-1 flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={triggerId}
          className={cn(
            'text-xs font-bold uppercase tracking-wider',
            error ? 'text-brutal-red' : 'text-brutal-black'
          )}
        >
          {label}
        </label>
      )}

      <div className="relative">
        <div className="sm:hidden">
          <button
            id={triggerId}
            ref={triggerRef}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-controls={isOpen ? listboxId : undefined}
            onClick={() => setIsOpen((prev) => !prev)}
            className={cn(
              'neo-input w-full min-h-[44px] px-3 py-2.5 flex items-center justify-between gap-3 text-left',
              'transition-all duration-150',
              isOpen && 'border-brutal-yellow shadow-[3px_3px_0px_0px_#7ABF3A]',
              error && '!border-brutal-red focus:!shadow-[4px_4px_0px_0px_#EF4444]',
              buttonClassName
            )}
          >
            <span className="min-w-0 flex items-center gap-2.5">
              {selectedCategory ? (
                <>
                  <span className="text-lg leading-none shrink-0" aria-hidden="true">
                    {selectedCategory.emoji}
                  </span>
                  <span className="truncate font-bold text-brutal-black">
                    {selectedCategory.label}
                  </span>
                </>
              ) : (
                <span className="truncate font-bold text-brutal-black/45">
                  {placeholder}
                </span>
              )}
            </span>

            <ChevronDown
              size={18}
              strokeWidth={2.5}
              className={cn(
                'shrink-0 text-brutal-black/60 transition-transform duration-150',
                isOpen && 'rotate-180'
              )}
              aria-hidden="true"
            />
          </button>
        </div>

        <div className="relative hidden sm:block">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={cn(
              'neo-input w-full appearance-none pr-10',
              error && '!border-brutal-red focus:!shadow-[4px_4px_0px_0px_#EF4444]',
              buttonClassName
            )}
            style={{ fontSize: '16px' }}
          >
            {!selectedCategory && (
              <option value="" disabled>{placeholder}</option>
            )}
            {categories.map((cat) => (
              <option key={cat.slug} value={cat.slug}>
                {cat.emoji} {cat.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={18}
            strokeWidth={2.5}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-brutal-black/60"
            aria-hidden="true"
          />
        </div>

        {isOpen && (
          <div
            id={listboxId}
            role="listbox"
            aria-labelledby={triggerId}
            className={cn(
              'absolute left-0 right-[-3px] z-30 overflow-hidden border-2 border-[#555555] bg-[#242424]',
              openDirection === 'up' ? 'bottom-[calc(100%+3px)]' : 'top-[calc(100%+3px)]',
              panelClassName
            )}
          >
            <div className="overflow-y-auto" style={{ maxHeight: `${panelMaxHeight}px` }}>
              {categories.map((cat) => {
                const isSelected = cat.slug === value;

                return (
                  <button
                    key={cat.slug}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(cat.slug);
                      setIsOpen(false);
                    }}
                    className={cn(
                      'w-full flex items-center justify-between gap-2.5 px-3 py-1.5 text-left',
                      'border-b-2 border-[#3A3A3A] last:border-b-0',
                      'transition-colors duration-150 hover:bg-[#2A2A2A] active:bg-[#2F2F2F]',
                      isSelected && 'bg-[#2D2D2D]'
                    )}
                  >
                    <span className="min-w-0 flex items-center gap-2">
                      <span className="text-[15px] leading-none shrink-0" aria-hidden="true">
                        {cat.emoji}
                      </span>
                      <span className="truncate text-sm font-medium leading-tight text-brutal-white">
                        {cat.label}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

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
};

export { CategoryPicker };
export type { CategoryPickerProps };
