import React, { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';

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
          className="w-full max-w-sm pointer-events-auto"
          style={{
            backgroundColor: '#242424',
            border: '4px solid #555555',
            boxShadow: '4px 4px 0px 0px #F5F0E8',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className="flex items-center gap-3 px-5 py-4"
            style={{ borderBottom: '2px solid #3A3A3A' }}
          >
            <div
              className="flex items-center justify-center w-9 h-9 shrink-0"
              style={{ backgroundColor: '#3A1A1A', border: '2px solid #F87171' }}
            >
              <AlertTriangle size={18} strokeWidth={2.5} className="text-red-400" />
            </div>
            <h3
              id="confirm-modal-title"
              className="text-base font-black uppercase tracking-tight"
              style={{ color: '#F5F0E8' }}
            >
              {title}
            </h3>
          </div>

          {/* Body */}
          {description && (
            <p
              id="confirm-modal-desc"
              className="px-5 py-4 text-sm font-medium"
              style={{ color: '#A09890', lineHeight: 1.6 }}
            >
              {description}
            </p>
          )}

          {/* Actions */}
          <div
            className="flex gap-3 px-5 pb-5"
            style={{ paddingTop: description ? 0 : '1.25rem' }}
          >
            <Button
              variant="secondary"
              fullWidth
              onClick={onCancel}
              disabled={loading}
            >
              {cancelLabel}
            </Button>
            <Button
              variant="destructive"
              fullWidth
              onClick={onConfirm}
              loading={loading}
            >
              {confirmLabel}
            </Button>
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
