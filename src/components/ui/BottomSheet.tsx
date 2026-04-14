import React, { useEffect, useCallback, useState, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

// ============================================================
//  BOTTOM SHEET COMPONENT — Mobile-first slide-up modal
//  Drag-to-dismiss uses direct DOM manipulation (no React
//  re-renders during drag) for 60fps on mobile.
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
  /** Extra class for the inner content wrapper */
  contentClassName?: string;
  children?: React.ReactNode;
}

const SWIPE_THRESHOLD = 60;

const BottomSheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  title,
  description,
  disableBackdropClose = false,
  panelClassName,
  contentClassName,
  children,
}) => {
  const [isRendered, setIsRendered] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(false);

  // ── Refs for zero-rerender drag ──────────────────────────
  const panelRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number | null>(null);
  const dragStartX = useRef<number | null>(null);
  const isDragDismiss = useRef(false);
  const currentOffset = useRef(0);

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsRendered(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsVisible(true));
      });
    } else {
      setIsVisible(false);
      // Reset any leftover drag transform
      if (panelRef.current) {
        panelRef.current.style.transform = '';
        panelRef.current.style.transition = '';
      }
      if (overlayRef.current) {
        overlayRef.current.style.opacity = '';
      }
      currentOffset.current = 0;
      const timer = setTimeout(() => setIsRendered(false), 200);
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

  // ── Direct DOM helpers (no React state = no re-render) ───
  const applyDragOffset = useCallback((offset: number) => {
    currentOffset.current = offset;
    if (panelRef.current) {
      // Check if desktop centered layout (has translateX)
      const isDesktop = window.innerWidth >= 640;
      panelRef.current.style.transition = 'none';
      panelRef.current.style.transform = isDesktop
        ? `translateX(-50%) translateY(${offset}px)`
        : `translateY(${offset}px)`;
    }
    if (overlayRef.current) {
      overlayRef.current.style.opacity = String(Math.max(0.15, 1 - offset / 300));
    }
  }, []);

  const resetDrag = useCallback(() => {
    currentOffset.current = 0;
    if (panelRef.current) {
      // Snap back with smooth transition
      const isDesktop = window.innerWidth >= 640;
      panelRef.current.style.transition = 'transform 150ms cubic-bezier(0.16, 1, 0.3, 1)';
      panelRef.current.style.transform = isDesktop
        ? `translateX(-50%) translateY(0%)`
        : `translateY(0%)`;
    }
    if (overlayRef.current) {
      overlayRef.current.style.opacity = '';
    }
  }, []);

  const animateDismiss = useCallback(() => {
    if (panelRef.current) {
      const isDesktop = window.innerWidth >= 640;
      panelRef.current.style.transition = 'transform 180ms cubic-bezier(0.4, 0, 1, 1)';
      panelRef.current.style.transform = isDesktop
        ? `translateX(-50%) translateY(100%)`
        : `translateY(100%)`;
    }
    if (overlayRef.current) {
      overlayRef.current.style.transition = 'opacity 180ms ease-out';
      overlayRef.current.style.opacity = '0';
    }
    // Call onClose after animation completes
    setTimeout(() => onClose(), 190);
  }, [onClose]);

  // ── Swipe-to-dismiss handlers ────────────────────────────
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    dragStartY.current = touch.clientY;
    dragStartX.current = touch.clientX;
    isDragDismiss.current = false;

    // Walk up from touch target to find any scrollable element
    // that is currently scrolled down
    let el = e.target as HTMLElement | null;
    const panel = panelRef.current;
    while (el && el !== panel) {
      if (el.scrollHeight > el.clientHeight && el.scrollTop > 0) {
        dragStartY.current = null;
        return;
      }
      el = el.parentElement;
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (dragStartY.current === null) return;

    const deltaY = e.touches[0].clientY - dragStartY.current;
    const deltaX = e.touches[0].clientX - (dragStartX.current ?? 0);

    // If horizontal > vertical, abort (user is swiping sideways)
    if (!isDragDismiss.current && Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      dragStartY.current = null;
      resetDrag();
      return;
    }

    if (deltaY > 0) {
      isDragDismiss.current = true;
      // Rubber-band: diminishing returns past threshold
      applyDragOffset(Math.min(deltaY * 0.6, 200));
    } else {
      // User scrolling up — cancel dismiss
      if (!isDragDismiss.current) {
        dragStartY.current = null;
        resetDrag();
      }
    }
  }, [applyDragOffset, resetDrag]);

  const handleTouchEnd = useCallback(() => {
    if (dragStartY.current === null) {
      return;
    }

    if (currentOffset.current > SWIPE_THRESHOLD) {
      // Dismiss: animate out from current position
      animateDismiss();
    } else {
      // Snap back
      resetDrag();
    }

    dragStartY.current = null;
    isDragDismiss.current = false;
  }, [animateDismiss, resetDrag]);

  // ── Render ───────────────────────────────────────────────
  if (!isRendered) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        ref={overlayRef}
        className="bottom-sheet-overlay"
        data-state={isVisible ? 'open' : 'closed'}
        onClick={disableBackdropClose ? undefined : onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Bottom sheet'}
        className={cn('bottom-sheet-panel', panelClassName)}
        data-state={isVisible ? 'open' : 'closed'}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
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
        <div ref={contentRef} className={cn("px-4 py-4", contentClassName)}>
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
