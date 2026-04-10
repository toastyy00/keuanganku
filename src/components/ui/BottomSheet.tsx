import React, { useEffect, useCallback, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

// ============================================================
//  BOTTOM SHEET COMPONENT — Mobile-first slide-up modal
// ============================================================

interface BottomSheetProps {
  /** Whether the sheet is visible */
  isOpen: boolean;
  /** Called when user closes the sheet (backdrop click / close btn / swipe down) */
  onClose: () => void;
  /** Sheet title shown in the handle bar area */
  title?: string;
  /** Sub-title / description */
  description?: string;
  /** If true, clicking the backdrop does NOT close the sheet */
  disableBackdropClose?: boolean;
  /** Extra class for the panel itself */
  panelClassName?: string;
  children?: React.ReactNode;
}

const BottomSheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  title,
  description,
  disableBackdropClose = false,
  panelClassName,
  children,
}) => {
  const [isRendered, setIsRendered] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsRendered(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsVisible(true));
      });
    } else {
      setIsVisible(false);
      const timer = setTimeout(() => setIsRendered(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // ── Close on Escape key ──────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    },
    [isOpen, onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── Prevent body scroll when sheet is open ───────────────
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // ── Render ───────────────────────────────────────────────
  if (!isRendered) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="bottom-sheet-overlay"
        data-state={isVisible ? 'open' : 'closed'}
        onClick={disableBackdropClose ? undefined : onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Bottom sheet'}
        className={cn('bottom-sheet-panel', panelClassName)}
        data-state={isVisible ? 'open' : 'closed'}
      >
        {/* Handle bar */}
        <div className="flex items-center justify-center pt-3 pb-1">
          <div className="w-10 h-1.5 rounded-full bg-brutal-black/30" />
        </div>

        {/* Header */}
        {(title || description) && (
          <div className="flex items-start justify-between px-4 pt-2 pb-3 border-b-2 border-[#555555]">
            <div>
              {title && (
                <h3 className="text-lg font-bold uppercase tracking-tight leading-tight">
                  {title}
                </h3>
              )}
              {description && (
                <p className="text-sm text-brutal-black/60 mt-0.5 font-medium">
                  {description}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className={cn(
                'ml-3 mt-0.5 p-1.5 -mr-1',
                'border-2 border-[#555555]',
                'hover:bg-brutal-black hover:text-brutal-yellow',
                'active:translate-x-0.5 active:translate-y-0.5',
                'transition-all duration-150',
              )}
              aria-label="Close sheet"
            >
              <X size={18} strokeWidth={2.5} />
            </button>
          </div>
        )}

        {/* Content */}
        <div className="px-4 py-4">
          {children}
        </div>

        {/* Safe area spacer for mobile bottom */}
        <div className="h-safe-area-inset-bottom pb-4" />
      </div>
    </>
  );
};

export { BottomSheet };
export type { BottomSheetProps };
