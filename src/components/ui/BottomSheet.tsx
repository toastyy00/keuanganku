import React, { useEffect, useCallback, useState, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
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
  /** Optional style for the inner content wrapper */
  contentStyle?: React.CSSProperties;
  /** Keep mobile swipe gestures inside this sheet so page pull-to-refresh is not triggered */
  containPageOverscroll?: boolean;
  /** Sticky footer rendered below the scrollable content area */
  footer?: React.ReactNode;
  children?: React.ReactNode;
  /** If true, prompts user before closing if they have unsaved changes */
  hasUnsavedChanges?: boolean;
}

const SWIPE_THRESHOLD = 60;
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');
let activeSheetCount = 0;

function syncBottomSheetBodyState() {
  if (typeof document === 'undefined') return;

  if (activeSheetCount > 0) {
    document.body.dataset.bottomSheetOpen = 'true';
    document.documentElement.dataset.bottomSheetOpen = 'true';
    return;
  }

  delete document.body.dataset.bottomSheetOpen;
  delete document.documentElement.dataset.bottomSheetOpen;
}

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];

  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => {
      if (element.hasAttribute('disabled')) return false;
      if (element.getAttribute('aria-hidden') === 'true') return false;
      return element.offsetParent !== null || document.activeElement === element;
    });
}

const BottomSheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  title,
  description,
  disableBackdropClose = false,
  panelClassName,
  contentClassName,
  contentStyle,
  containPageOverscroll = false,
  footer,
  children,
  hasUnsavedChanges = false,
}) => {
  const [isRendered, setIsRendered] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  // ── Refs for zero-rerender drag ──────────────────────────
  const panelRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const dragStartY = useRef<number | null>(null);
  const dragStartX = useRef<number | null>(null);
  const isDragDismiss = useRef(false);
  const currentOffset = useRef(0);

  const attemptClose = useCallback(() => {
    onClose();
  }, [onClose]);

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

  useEffect(() => {
    if (!isOpen) return;

    activeSheetCount += 1;
    syncBottomSheetBodyState();

    return () => {
      activeSheetCount = Math.max(0, activeSheetCount - 1);
      syncBottomSheetBodyState();
    };
  }, [isOpen]);

  // Lock panel height after opening transition settles.
  // This prevents the sheet from growing OR shrinking when internal content
  // changes (e.g. switching pills/tabs). Extra content scrolls instead.
  // Uses min() with 90dvh so the lock respects viewport changes (e.g. keyboard).
  useEffect(() => {
    if (!isVisible) return;
    const panel = panelRef.current;
    if (!panel) return;

    // Wait for the 220ms open transition + one extra frame to settle
    const timer = setTimeout(() => {
      const h = panel.getBoundingClientRect().height;
      if (h > 0) {
        const locked = `min(${h}px, 90dvh)`;
        panel.style.minHeight = locked;
        panel.style.maxHeight = locked;
      }
    }, 280);

    return () => {
      clearTimeout(timer);
      panel.style.minHeight = '';
      panel.style.maxHeight = '';
    };
  }, [isVisible]);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedElementRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;

      // Focus the panel container itself on open. This establishes the focus trap
      // context for screen readers and keyboard navigation without visually highlighting the close button.
      panel.focus({ preventScroll: true });
    }, 30);

    return () => {
      window.clearTimeout(focusTimer);

      const previousFocus = previouslyFocusedElementRef.current;
      if (previousFocus && previousFocus.isConnected) {
        previousFocus.focus();
      }
      previouslyFocusedElementRef.current = null;
    };
  }, [isOpen]);

  // ── Close on Escape key ──────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        attemptClose();
        return;
      }

      if (e.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusableElements = getFocusableElements(panel);
      if (focusableElements.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      const activeInsidePanel = activeElement ? panel.contains(activeElement) : false;

      if (e.shiftKey) {
        if (!activeInsidePanel || activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
        return;
      }

      if (!activeInsidePanel || activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    },
    [isOpen, attemptClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (!isOpen) return;

    const handleFocusIn = (event: FocusEvent) => {
      const panel = panelRef.current;
      const target = event.target;

      if (!panel || !(target instanceof HTMLElement) || panel.contains(target)) {
        return;
      }

      const focusableElements = getFocusableElements(panel);
      const nextFocusTarget = closeButtonRef.current ?? focusableElements[0] ?? panel;
      nextFocusTarget.focus();
    };

    document.addEventListener('focusin', handleFocusIn);
    return () => document.removeEventListener('focusin', handleFocusIn);
  }, [isOpen]);

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

    // Close gesture is only allowed when the sheet itself and the touched
    // scroll area are already at the very top.
    let el = e.target as HTMLElement | null;
    const panel = panelRef.current;
    if (panel && panel.scrollTop > 0) {
      dragStartY.current = null;
      return;
    }

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
      if (containPageOverscroll && e.cancelable) {
        e.preventDefault();
      }
      // Rubber-band: diminishing returns past threshold
      applyDragOffset(Math.min(deltaY * 0.6, 200));
    } else {
      // User scrolling up — cancel dismiss
      if (!isDragDismiss.current) {
        dragStartY.current = null;
        resetDrag();
      }
    }
  }, [applyDragOffset, containPageOverscroll, resetDrag]);

  const handleTouchEnd = useCallback(() => {
    if (dragStartY.current === null) {
      return;
    }

    if (currentOffset.current > SWIPE_THRESHOLD) {
      if (hasUnsavedChanges) {
        resetDrag();
        onClose();
      } else {
        // Dismiss: animate out from current position
        animateDismiss();
      }
    } else {
      // Snap back
      resetDrag();
    }

    dragStartY.current = null;
    isDragDismiss.current = false;
  }, [animateDismiss, resetDrag, hasUnsavedChanges, onClose]);

  // ── Render ───────────────────────────────────────────────
  if (!isRendered) return null;

  const sheetMarkup = (
    <>
      {/* Backdrop */}
      <div
        ref={overlayRef}
        className="bottom-sheet-overlay"
        data-no-swipe="true"
        data-contain-page-overscroll={containPageOverscroll ? 'true' : undefined}
        data-state={isVisible ? 'open' : 'closed'}
        onClick={disableBackdropClose ? undefined : attemptClose}
        aria-hidden="true"
      />

      {/* Panel — flex column: sticky header + scrollable content + sticky footer */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title ? undefined : 'Bottom sheet'}
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        className={cn('bottom-sheet-panel', panelClassName)}
        data-no-swipe="true"
        data-contain-page-overscroll={containPageOverscroll ? 'true' : undefined}
        data-state={isVisible ? 'open' : 'closed'}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        tabIndex={-1}
      >
        {/* Handle bar — sticky, never scrolls */}
        <div className="flex items-center justify-center pt-3 pb-2 shrink-0">
          <div className="w-9 h-1 rounded-full bg-white/20" />
        </div>

        {/* Header — sticky, never scrolls */}
        {(title || description) && (
          <div className="flex items-center justify-between px-4 pt-1 pb-3 border-b border-white/[0.07] shrink-0">
            <div>
              {title && (
                <h3 id={titleId} className="text-base font-semibold tracking-tight leading-tight text-white/90">
                  {title}
                </h3>
              )}
              {description && (
                <p id={descriptionId} className="text-xs text-white/40 mt-0.5 font-normal">
                  {description}
                </p>
              )}
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={attemptClose}
              className={cn(
                'ml-3 w-7 h-7 flex items-center justify-center rounded-full',
                'bg-white/[0.08] text-red-500/70',
                'hover:bg-white/[0.14] hover:text-red-500',
                'active:scale-95',
                'transition-all duration-150',
              )}
              aria-label="Close sheet"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        )}

        {/* Scrollable content — flex-1 so it fills remaining space */}
        <div
          ref={contentRef}
          className={cn('flex-1 overflow-y-auto px-4 py-4', contentClassName)}
          style={contentStyle}
        >
          {children}
        </div>

        {/* Sticky footer — pinned above safe area */}
        {footer ? (
          <div
            className="shrink-0 px-4 pt-3 border-t border-white/[0.07] bg-transparent"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
          >
            {footer}
          </div>
        ) : (
          <div
            className="shrink-0"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
          />
        )}
      </div>
    </>
  );

  if (typeof document === 'undefined') {
    return sheetMarkup;
  }

  return createPortal(sheetMarkup, document.body);
};

export { BottomSheet };
export type { BottomSheetProps };
