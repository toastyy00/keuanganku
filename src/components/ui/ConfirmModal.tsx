import React, { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';

// ============================================================
//  CONFIRM MODAL — Centered dialog for destructive actions
// ============================================================

interface ConfirmModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Modal title */
  title: string;
  /** Supporting description */
  description?: string;
  /** Label for the confirm (destructive) button */
  confirmLabel?: string;
  /** Label for the cancel button */
  cancelLabel?: string;
  /** Called when user confirms */
  onConfirm: () => void;
  /** Called when user cancels or clicks outside */
  onCancel: () => void;
  /** Show loading state on confirm button */
  loading?: boolean;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  description,
  confirmLabel = 'Ya, Lanjutkan',
  cancelLabel = 'Batal',
  onConfirm,
  onCancel,
  loading = false,
}) => {
  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') onCancel();
    },
    [isOpen, onCancel]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Lock body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) return null;

  const modalMarkup = (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[80] bg-black/60"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Dialog panel */}
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby={description ? 'confirm-modal-desc' : undefined}
        className="fixed inset-0 z-[81] flex items-center justify-center px-4 pointer-events-none"
      >
        <div
          className="w-full max-w-sm pointer-events-auto rounded-3xl border border-white/[0.08] bg-gradient-to-b from-[#1C1C1C] to-[#141414] shadow-[0_24px_50px_rgba(0,0,0,0.6)] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-6 pt-6 pb-2">
            <div className="flex items-center justify-center w-9 h-9 rounded-full bg-red-500/10 shrink-0">
              <AlertTriangle size={16} className="text-red-400" />
            </div>
            <h3
              id="confirm-modal-title"
              className="text-base font-bold text-white tracking-tight"
            >
              {title}
            </h3>
          </div>

          {/* Body */}
          {description && (
            <p
              id="confirm-modal-desc"
              className="px-6 py-3 text-sm text-white/50 leading-relaxed font-medium"
            >
              {description}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-3 px-6 pb-6 pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="flex-1 text-center text-xs font-semibold px-4 py-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.08] text-white/70 active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 text-xs font-semibold px-4 py-2.5 rounded-2xl bg-red-500/90 hover:bg-red-500 text-white shadow-lg active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && (
                <span
                  className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"
                  aria-hidden="true"
                />
              )}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );

  if (typeof document === 'undefined') return modalMarkup;
  return createPortal(modalMarkup, document.body);
};

export { ConfirmModal };
export type { ConfirmModalProps };
