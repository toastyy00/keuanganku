import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, CheckCircle2, FileText, Loader2, X, Trash2 } from 'lucide-react';
import { formatCurrency, cn } from '../lib/utils';
import type { Category, Currency, RecurringTemplate, ReceiptInboxItem } from '../types';

function haptic() {
  if ('vibrate' in navigator) navigator.vibrate(10);
}

interface NotificationBoxProps {
  isOpen: boolean;
  onClose: () => void;
  unrecordedList: RecurringTemplate[];
  categories: Category[];
  currency: Currency;
  onLogItem: (template: RecurringTemplate) => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
  inboxItems?: ReceiptInboxItem[];
  onReviewReceipt?: (item: ReceiptInboxItem) => void;
  onDismissReceipt?: (id: string) => void;
}

export const NotificationBox: React.FC<NotificationBoxProps> = ({
  isOpen,
  onClose,
  unrecordedList,
  categories,
  currency,
  onLogItem,
  triggerRef,
  inboxItems = [],
  onReviewReceipt = () => {},
  onDismissReceipt = () => {},
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 60, left: 16 });
  const [activeTab, setActiveTab] = useState<'all' | 'routine' | 'inbox'>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Synchronously measure trigger position before first browser paint
  useLayoutEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      if (triggerRef?.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const clientWidth = document.documentElement.clientWidth;
        const popoverLeft = Math.max(12, Math.min(rect.right - 350, clientWidth - 362));
        setCoords({
          top: rect.bottom + 8,
          left: popoverLeft,
        });
      }
    };

    updatePosition();

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, triggerRef]);

  // Keyboard Escape & Touch Isolation listener
  useEffect(() => {
    if (!isOpen) return;

    // Set flag on document body so background swipe handlers know notification box is open
    document.body.dataset.notificationOpen = 'true';

    const stopPropagationNative = (e: Event) => {
      e.stopPropagation();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const popoverEl = popoverRef.current;
    if (popoverEl) {
      popoverEl.addEventListener('touchstart', stopPropagationNative, { passive: true });
      popoverEl.addEventListener('touchmove', stopPropagationNative, { passive: true });
      popoverEl.addEventListener('touchend', stopPropagationNative, { passive: true });
      popoverEl.addEventListener('pointerdown', stopPropagationNative, { passive: true });
      popoverEl.addEventListener('pointermove', stopPropagationNative, { passive: true });
      popoverEl.addEventListener('pointerup', stopPropagationNative, { passive: true });
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      delete document.body.dataset.notificationOpen;
      document.removeEventListener('keydown', handleKeyDown);
      if (popoverEl) {
        popoverEl.removeEventListener('touchstart', stopPropagationNative);
        popoverEl.removeEventListener('touchmove', stopPropagationNative);
        popoverEl.removeEventListener('touchend', stopPropagationNative);
        popoverEl.removeEventListener('pointerdown', stopPropagationNative);
        popoverEl.removeEventListener('pointermove', stopPropagationNative);
        popoverEl.removeEventListener('pointerup', stopPropagationNative);
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Measure trigger element position for 1st-frame accuracy
  let activeCoords = coords;
  let triggerRectInfo: { top: number; left: number; width: number; height: number } | null = null;

  if (triggerRef?.current && typeof window !== 'undefined') {
    const rect = triggerRef.current.getBoundingClientRect();
    const clientWidth = document.documentElement.clientWidth;
    const popoverLeft = Math.max(12, Math.min(rect.right - 350, clientWidth - 362));
    activeCoords = {
      top: rect.bottom + 8,
      left: popoverLeft,
    };
    triggerRectInfo = {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    };
  }

  const totalCount = unrecordedList.length + inboxItems.length;

  const renderRoutineItem = (item: RecurringTemplate) => {
    const cat = categories.find((c) => c.slug === item.category);
    return (
      <div
        key={item.id}
        className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.07] transition-all group"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-full bg-white/[0.08] border border-white/10 flex items-center justify-center text-xl shrink-0">
            {cat?.emoji ?? '🛍️'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-white/95 truncate">{item.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs font-black text-white">
                {formatCurrency(item.amount, item.currency ?? currency)}
              </span>
              {item.schedule_detail && (
                <span className="text-[10px] text-white/40 truncate">· {item.schedule_detail}</span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            haptic();
            onLogItem(item);
          }}
          className="px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-white font-bold text-xs border border-white/10 transition-all duration-200 shrink-0"
        >
          Catat
        </button>
      </div>
    );
  };

  const renderInboxItem = (item: ReceiptInboxItem) => {
    const isReady = item.status === 'ready';
    const isError = item.status === 'error';
    const isProcessing = item.status === 'processing';
    const isConfirmingDelete = confirmDeleteId === item.id;

    if (isConfirmingDelete) {
      return (
        <div
          key={item.id}
          className="flex items-center justify-between gap-2.5 p-3 rounded-2xl bg-red-500/10 border border-red-500/30 animate-in fade-in-0 duration-200 relative"
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center shrink-0">
              <Trash2 size={15} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-white leading-tight">Hapus Struk</p>
              <p className="text-[10px] text-white/50 truncate mt-0.5">{item.store_name || 'Struk'}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                haptic();
                setConfirmDeleteId(null);
              }}
              className="px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-white/70 hover:text-white text-xs font-semibold transition-all active:scale-95"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                haptic();
                onDismissReceipt(item.id);
                setConfirmDeleteId(null);
              }}
              className="px-3.5 py-1.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-bold shadow-md shadow-red-500/20 transition-all active:scale-95"
            >
              Hapus
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        key={item.id}
        className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.07] transition-all group"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-full bg-white/[0.08] border border-white/10 flex items-center justify-center text-white/70 shrink-0">
            {isProcessing ? (
              <Loader2 size={18} className="animate-spin text-white" />
            ) : (
              <FileText size={18} />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-white/95 truncate">
              {item.store_name || 'Memproses Struk...'}
            </p>
            
            {isReady && (
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs font-black text-white">
                  {formatCurrency(item.total || 0, item.currency)}
                </span>
                {item.items && item.items.length > 0 && (
                  <span className="text-[10px] text-white/40 font-medium">
                    · {item.items.length} item
                  </span>
                )}
              </div>
            )}
            
            {isError && (
              <p className="text-[11px] text-red-400 truncate mt-0.5">{item.error_message || 'Gagal memproses struk'}</p>
            )}
            {isProcessing && (
              <p className="text-[11px] text-white/40 truncate mt-0.5">Menganalisa dengan AI Vision...</p>
            )}

            {item.receipt_date && (
              <p className="text-[10px] text-white/35 truncate mt-0.5">⏱ {item.receipt_date}</p>
            )}
          </div>
        </div>

        {/* Action Buttons: Compact Trash Icon & Catat Button */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              haptic();
              setConfirmDeleteId(item.id);
            }}
            className="w-8 h-8 rounded-xl bg-white/[0.05] hover:bg-red-500/15 text-white/35 hover:text-red-400 flex items-center justify-center transition-all duration-200 active:scale-95 border border-white/[0.06] hover:border-red-500/20 shrink-0"
            title="Hapus struk"
            aria-label="Hapus struk"
          >
            <Trash2 size={14} />
          </button>

          {isReady && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                haptic();
                onReviewReceipt(item);
              }}
              className="px-3.5 h-8 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-white font-bold text-xs border border-white/10 transition-all duration-200 shrink-0 flex items-center justify-center"
            >
              Catat
            </button>
          )}
          {isError && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                haptic();
                onDismissReceipt(item.id);
              }}
              className="px-3.5 h-8 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-white font-bold text-xs border border-white/10 transition-all duration-200 shrink-0 flex items-center justify-center"
            >
              Coba Lagi
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderRoutineEmpty = () => (
    <div className="py-8 px-4 text-center">
      <CheckCircle2 size={32} className="mx-auto mb-2 text-white/20" />
      <p className="text-xs font-bold text-white">Semua Rutin Selesai!</p>
      <p className="text-[11px] text-white/40 mt-1">
        Seluruh pengeluaran rutin bulan ini sudah dicatat.
      </p>
    </div>
  );

  const renderInboxEmpty = () => (
    <div className="py-8 px-4 text-center">
      <FileText size={32} className="mx-auto mb-2 text-white/20" />
      <p className="text-xs font-bold text-white">Belum ada struk</p>
      <p className="text-[11px] text-white/40 mt-1">
        Upload struk dari tombol + untuk mulai scan.
      </p>
    </div>
  );

  const content = (
    <>
      <div
        className="fixed inset-0 z-[9998] cursor-default bg-black/20 backdrop-blur-[2px] transition-[opacity,backdrop-filter] duration-200 animate-in fade-in-0 touch-none select-none"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => {
          e.stopPropagation();
          if (e.cancelable) e.preventDefault();
        }}
        onTouchEnd={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      />

      {triggerRectInfo && (
        <button
          type="button"
          style={{
            position: 'fixed',
            top: `${triggerRectInfo.top}px`,
            left: `${triggerRectInfo.left}px`,
            width: `${triggerRectInfo.width}px`,
            height: `${triggerRectInfo.height}px`,
          }}
          onClick={(e) => {
            e.stopPropagation();
            haptic();
            onClose();
          }}
          className="z-[9999] flex items-center justify-center rounded-xl bg-[#222222] border border-white/20 text-white shadow-lg active:scale-95 transition-transform select-none"
          aria-label="Tutup Pengingat"
        >
          <Bell size={17} />
          {totalCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-white text-[#1A1A1A] text-[10px] font-black shadow-md border border-[#1A1A1A]">
              {totalCount}
            </span>
          )}
        </button>
      )}

      <div
        ref={popoverRef}
        style={{
          position: 'fixed',
          top: `${activeCoords.top}px`,
          left: `${activeCoords.left}px`,
          transformOrigin: 'top right',
        }}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        className="z-[9999] w-[350px] max-w-[calc(100vw-2rem)] rounded-3xl bg-[#1A1A1E]/95 backdrop-blur-2xl border border-white/[0.1] shadow-[0_24px_48px_rgba(0,0,0,0.7)] overflow-hidden origin-top-right transition-[opacity,transform] duration-200 ease-out animate-in fade-in-0 zoom-in-95 overscroll-contain"
      >
        {/* Header (Reference 2 style) */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h3 className="text-base font-bold text-white tracking-tight">Notifikasi</h3>
          <button
            type="button"
            onClick={() => {
              haptic();
              onClose();
            }}
            className="p-1.5 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Tutup Notifikasi"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Navigation (Reference 2 style - Underline Tab bar) */}
        <div className="flex items-center gap-6 px-4 pt-1 border-b border-white/[0.08]">
          <button
            type="button"
            onClick={() => {
              haptic();
              setActiveTab('all');
            }}
            className={cn(
              "flex items-center gap-1.5 pb-2.5 text-xs transition-all relative font-semibold",
              activeTab === 'all'
                ? "text-white font-bold"
                : "text-white/40 hover:text-white/70"
            )}
          >
            <span>Semua</span>
            <span className={cn(
              "px-1.5 py-0.5 rounded-md text-[10px] font-bold leading-none transition-colors",
              activeTab === 'all' ? "bg-white/15 text-white" : "bg-white/[0.06] text-white/40"
            )}>
              {totalCount}
            </span>
            {activeTab === 'all' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-white rounded-full" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              haptic();
              setActiveTab('routine');
            }}
            className={cn(
              "flex items-center gap-1.5 pb-2.5 text-xs transition-all relative font-semibold",
              activeTab === 'routine'
                ? "text-white font-bold"
                : "text-white/40 hover:text-white/70"
            )}
          >
            <span>Rutin</span>
            <span className={cn(
              "px-1.5 py-0.5 rounded-md text-[10px] font-bold leading-none transition-colors",
              activeTab === 'routine' ? "bg-white/15 text-white" : "bg-white/[0.06] text-white/40"
            )}>
              {unrecordedList.length}
            </span>
            {activeTab === 'routine' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-white rounded-full" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              haptic();
              setActiveTab('inbox');
            }}
            className={cn(
              "flex items-center gap-1.5 pb-2.5 text-xs transition-all relative font-semibold",
              activeTab === 'inbox'
                ? "text-white font-bold"
                : "text-white/40 hover:text-white/70"
            )}
          >
            <span>Inbox</span>
            <span className={cn(
              "px-1.5 py-0.5 rounded-md text-[10px] font-bold leading-none transition-colors",
              activeTab === 'inbox' ? "bg-white/15 text-white" : "bg-white/[0.06] text-white/40"
            )}>
              {inboxItems.length}
            </span>
            {activeTab === 'inbox' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-white rounded-full" />
            )}
          </button>
        </div>

        {/* Content List */}
        <div className="max-h-[340px] overflow-y-auto p-3 scrollbar-none">
          {activeTab === 'routine' && (
            <div className="space-y-2">
              {unrecordedList.length === 0 ? renderRoutineEmpty() : unrecordedList.map(renderRoutineItem)}
            </div>
          )}

          {activeTab === 'inbox' && (
            <div className="space-y-2">
              {inboxItems.length === 0 ? renderInboxEmpty() : inboxItems.map(renderInboxItem)}
            </div>
          )}

          {activeTab === 'all' && (
            <div className="space-y-4">
              {totalCount === 0 ? (
                <div className="py-8 px-4 text-center">
                  <Bell size={32} className="mx-auto mb-2 text-white/20" />
                  <p className="text-xs font-bold text-white">Tidak ada notifikasi</p>
                </div>
              ) : (
                <>
                  {unrecordedList.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-[11px] font-bold text-white/40 uppercase tracking-wider px-1">Belum Dicatat</h4>
                      {unrecordedList.map(renderRoutineItem)}
                    </div>
                  )}
                  {inboxItems.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-[11px] font-bold text-white/40 uppercase tracking-wider px-1">Struk Masuk</h4>
                      {inboxItems.map(renderInboxItem)}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );

  if (typeof document === 'undefined') return content;
  return createPortal(content, document.body);
};
