import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, CheckCircle2, Plus } from 'lucide-react';
import { formatCurrency } from '../lib/utils';
import type { Category, Currency, RecurringTemplate } from '../types';

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
}

export const NotificationBox: React.FC<NotificationBoxProps> = ({
  isOpen,
  onClose,
  unrecordedList,
  categories,
  currency,
  onLogItem,
  triggerRef,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 60, left: 16 });

  // Synchronously measure trigger position before first browser paint
  useLayoutEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      if (triggerRef?.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const clientWidth = document.documentElement.clientWidth;
        const popoverLeft = Math.max(12, Math.min(rect.right - 340, clientWidth - 352));
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

  // Keyboard Escape listener
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Measure trigger element position for 1st-frame accuracy (eliminates initial shift on desktop)
  let activeCoords = coords;
  let triggerRectInfo: { top: number; left: number; width: number; height: number } | null = null;

  if (triggerRef?.current && typeof window !== 'undefined') {
    const rect = triggerRef.current.getBoundingClientRect();
    const clientWidth = document.documentElement.clientWidth;
    const popoverLeft = Math.max(12, Math.min(rect.right - 340, clientWidth - 352));
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

  const content = (
    <>
      {/* 
        Full-screen Portal Backdrop at document.body level.
        Guarantees 100% viewport coverage over all transformed/stacked parent cards.
        Absorbs touch/click on mobile and desktop without triggering underlying links/cards.
      */}
      <div
        className="fixed inset-0 z-[9998] cursor-default bg-black/25 backdrop-blur-[2px] transition-[opacity,backdrop-filter] duration-200 animate-in fade-in-0"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
      />

      {/* 
        Unblurred Active Bell Icon Button Portal.
        Rendered at z-[9999] above z-[9998] backdrop, positioned precisely over the trigger rect.
        Stays 100% sharp, unblurred, and matched with the popover panel on desktop & mobile!
      */}
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
          {unrecordedList.length > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-[#B8F55A] text-[#1A1A1A] text-[10px] font-black shadow-md border border-[#1A1A1A]">
              {unrecordedList.length}
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
        className="z-[9999] w-[340px] max-w-[calc(100vw-2rem)] rounded-2xl bg-[#222222]/95 backdrop-blur-xl border border-white/10 shadow-[0_16px_36px_rgba(0,0,0,0.6)] overflow-hidden origin-top-right transition-[opacity,transform] duration-200 ease-out animate-in fade-in-0 zoom-in-95"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-[#B8F55A]/10 text-[#B8F55A]">
              <Bell size={15} />
            </div>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">Pengingat Rutin</h3>
              <p className="text-[10px] text-white/40 font-medium">Bulan Ini</p>
            </div>
          </div>
        </div>

        {/* Content List */}
        <div className="max-h-[320px] overflow-y-auto p-2 space-y-2">
          {unrecordedList.length === 0 ? (
            <div className="p-6 text-center">
              <CheckCircle2 size={32} className="mx-auto mb-2 text-[#B8F55A]" />
              <p className="text-xs font-bold text-white">Semua Rutin Selesai!</p>
              <p className="text-[11px] text-white/40 mt-1">
                Seluruh pengeluaran rutin bulan ini sudah dicatat.
              </p>
            </div>
          ) : (
            unrecordedList.map((item) => {
              const cat = categories.find((c) => c.slug === item.category);
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.07] transition-all"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className="text-2xl shrink-0">{cat?.emoji ?? '🛍️'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-white truncate">{item.name}</p>
                      <p className="text-[11px] font-black text-[#B8F55A]">
                        {formatCurrency(item.amount, item.currency ?? currency)}
                      </p>
                      {item.schedule_detail && (
                        <p className="text-[10px] text-white/35 truncate">⏱ {item.schedule_detail}</p>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      haptic();
                      onLogItem(item);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#B8F55A] text-[#1A1A1A] font-bold text-[11px] hover:bg-[#B8F55A]/90 active:scale-95 transition-all flex items-center gap-1 shrink-0 shadow-md"
                  >
                    <Plus size={12} strokeWidth={3} />
                    Catat
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );

  if (typeof document === 'undefined') return content;
  return createPortal(content, document.body);
};
