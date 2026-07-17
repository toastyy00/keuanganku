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
    if (!isOpen) return;

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
        <p className={`text-[11px] font-medium ${error ? 'text-red-400' : 'text-white/40'}`}>
          {label}
        </p>
      )}

      <div className="relative">
        <button
          id={triggerId}
          ref={triggerRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listboxId : undefined}
          onClick={() => setIsOpen((prev) => !prev)}
          className={cn(
            'slim-input w-full px-3 py-2 flex items-center justify-between gap-3 text-left font-normal text-white/90',
            'transition-all duration-150',
            isOpen && 'border-[#B8F55A]/50 bg-[#B8F55A]/[0.04]',
            error && '!border-red-500/50',
            buttonClassName
          )}
        >
          <span className="min-w-0 flex items-center gap-2.5">
            {selectedCategory ? (
              <>
                <span className="text-lg leading-none shrink-0" aria-hidden="true">
                  {selectedCategory.emoji}
                </span>
                <span className="truncate font-medium text-white/95">
                  {selectedCategory.label}
                </span>
              </>
            ) : (
              <span className="truncate text-white/30">
                {placeholder}
              </span>
            )}
          </span>

          <ChevronDown
            size={14}
            strokeWidth={2}
            className={cn(
              'shrink-0 text-white/30 transition-transform duration-150',
              isOpen && 'rotate-180'
            )}
            aria-hidden="true"
          />
        </button>

        {isOpen && (
          <div
            id={listboxId}
            role="listbox"
            aria-labelledby={triggerId}
            className={cn(
              'absolute left-0 right-0 z-30 overflow-hidden border border-white/[0.08] bg-[#1c1c1c] rounded-xl shadow-2xl shadow-black/60',
              openDirection === 'up' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]',
              panelClassName
            )}
          >
            <div className="overflow-y-auto divide-y divide-white/[0.04]" style={{ maxHeight: `${panelMaxHeight}px` }}>
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
                      'w-full flex items-center justify-between gap-2.5 px-3 py-2.5 text-left text-sm transition-colors border-b border-white/[0.04] last:border-b-0',
                      isSelected
                        ? 'bg-[#B8F55A]/8 text-[#B8F55A]'
                        : 'text-white/75 hover:bg-white/[0.05] hover:text-white/95'
                    )}
                  >
                    <span className="min-w-0 flex items-center gap-2">
                      <span className="text-[15px] leading-none shrink-0" aria-hidden="true">
                        {cat.emoji}
                      </span>
                      <span className="truncate text-sm font-medium leading-tight">
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
        <p className="text-[10px] text-red-400" role="alert">
          {error}
        </p>
      )}

      {!error && hint && (
        <p className="text-xs text-white/40 font-medium">{hint}</p>
      )}
    </div>
  );
};

export { CategoryPicker };
export type { CategoryPickerProps };
