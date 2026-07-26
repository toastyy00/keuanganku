import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Check, X, Merge, ShoppingBag, Package, Calendar, ChevronRight, Pencil } from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';
import { CategoryPicker } from '../ui/CategoryPicker';
import { useReceiptStore, compactItemName } from '../../store/useReceiptStore';
import { useExpenseStore } from '../../store/useExpenseStore';
import { formatCurrency, cn, todayISO } from '../../lib/utils';
import type { ReceiptMergeGroup, ReceiptLineItem } from '../../types';

interface ReceiptReviewSheetProps {
  isOpen: boolean;
  onClose: () => void;
  receiptId: string | null;
}

const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

const formatDate = (isoStr: string) => {
  if (!isoStr) return '';
  try {
    const date = new Date(isoStr);
    return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  } catch {
    return isoStr;
  }
};

const ReceiptReviewSheet: React.FC<ReceiptReviewSheetProps> = ({
  isOpen,
  onClose,
  receiptId,
}) => {
  const {
    inboxItems,
    updateLineItem,
    toggleItemIncluded,
    getExpensesFromReceiptMerged,
  } = useReceiptStore();

  const { categories } = useExpenseStore();
  const dateInputRef = useRef<HTMLInputElement>(null);

  const receipt = useMemo(() => inboxItems.find(i => i.id === receiptId), [inboxItems, receiptId]);

  // Dynamically reconcile & scale item prices if stored receipt.total differs from raw item sum (e.g. GoFood delivery fees / discounts)
  const effectiveItems = useMemo(() => {
    if (!receipt?.items) return [];
    const total = receipt.total ?? 0;
    const rawSum = receipt.items.reduce((sum, item) => sum + item.total_price, 0);
    if (!total || !rawSum || total === rawSum || receipt.items.length === 0) {
      return receipt.items;
    }
    const factor = total / rawSum;
    let accumulated = 0;
    return receipt.items.map((item, idx) => {
      let adjTotal: number;
      if (idx === receipt.items.length - 1) {
        adjTotal = total - accumulated;
      } else {
        adjTotal = Math.round(item.total_price * factor);
        accumulated += adjTotal;
      }
      const adjUnit = Math.max(1, Math.round(adjTotal / item.quantity));
      return {
        ...item,
        unit_price: adjUnit,
        total_price: adjTotal,
      };
    });
  }, [receipt]);

  const [mergedNeeds, setMergedNeeds] = useState(false);
  const [mergedWants, setMergedWants] = useState(false);
  const [needMergeCategory, setNeedMergeCategory] = useState<string>('keperluan');
  const [wantMergeCategory, setWantMergeCategory] = useState<string>('makan');
  const [needMergeTitle, setNeedMergeTitle] = useState<string>('');
  const [wantMergeTitle, setWantMergeTitle] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(todayISO());
  const [openPickerIndex, setOpenPickerIndex] = useState<number | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isOpen && receipt) {
      setMergedNeeds(false);
      setMergedWants(false);
      setOpenPickerIndex(null);
      setSelectedDate(receipt.receipt_date || todayISO());
      setNeedMergeTitle(`${receipt.store_name || 'Belanja'} (NEED)`);
      setWantMergeTitle(`${receipt.store_name || 'Belanja'} (WANT)`);
    }
  }, [isOpen, receiptId, receipt]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleOpenDatePicker = () => {
    const input = dateInputRef.current;
    if (!input) return;
    try {
      if ('showPicker' in input && typeof (input as HTMLInputElement & { showPicker?: () => void }).showPicker === 'function') {
        (input as HTMLInputElement & { showPicker: () => void }).showPicker();
      } else {
        input.focus();
      }
    } catch {
      input.focus();
    }
  };

  if (!receiptId || !receipt) return null;

  if (receipt.status === 'processing') {
    return (
      <BottomSheet isOpen={isOpen} onClose={onClose}>
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-white/20 border-t-white rounded-full animate-spin mb-4" />
          <p className="text-white/60 font-medium text-sm">Memproses struk dengan AI...</p>
        </div>
      </BottomSheet>
    );
  }

  const itemsWithIndex = effectiveItems.map((item, index) => ({ item, index }));
  
  const needItems = itemsWithIndex.filter(e => (e.item.confirmed_expense_type ?? e.item.suggested_expense_type) === 'NEED');
  const wantItems = itemsWithIndex.filter(e => (e.item.confirmed_expense_type ?? e.item.suggested_expense_type) === 'WANT');

  const includedNeedItems = needItems.filter(e => e.item.included);
  const includedWantItems = wantItems.filter(e => e.item.included);
  const totalIncluded = includedNeedItems.length + includedWantItems.length;

  const totalAmount = [...includedNeedItems, ...includedWantItems].reduce((sum, e) => sum + e.item.total_price, 0);

  const handleNext = () => {
    const mergeGroups: ReceiptMergeGroup[] = [];
    
    if (mergedNeeds && includedNeedItems.length > 0) {
      mergeGroups.push({
        type: 'NEED',
        category: needMergeCategory,
        itemIndices: includedNeedItems.map(e => e.index),
        mergedName: needMergeTitle.trim() || `${receipt.store_name || 'Gabungan'} (NEED)`,
      });
    }
    
    if (mergedWants && includedWantItems.length > 0) {
      mergeGroups.push({
        type: 'WANT',
        category: wantMergeCategory,
        itemIndices: includedWantItems.map(e => e.index),
        mergedName: wantMergeTitle.trim() || `${receipt.store_name || 'Gabungan'} (WANT)`,
      });
    }

    const expensesToReview = getExpensesFromReceiptMerged(receipt.id, mergeGroups, selectedDate);
    if (expensesToReview.length === 0) return;

    // Start sequential review via AddExpenseSheet!
    useReceiptStore.getState().startReviewSequence(receipt.id, expensesToReview);
    onClose();
  };

  const renderItem = ({ item, index }: { item: ReceiptLineItem, index: number }) => {
    const isExcluded = !item.included;
    const catSlug = item.confirmed_category ?? item.suggested_category;
    const type = item.confirmed_expense_type ?? item.suggested_expense_type;
    const isNeed = type === 'NEED';
    const isPickerOpen = openPickerIndex === index;

    return (
      <div
        key={index}
        style={{ zIndex: isPickerOpen ? 1000 : 100 - index }}
        className={cn(
          "flex flex-col gap-2.5 p-3.5 bg-[#1C1C1E] border border-white/[0.08] rounded-xl transition-all duration-200 animate-card-pop relative",
          isPickerOpen && "z-[1000]",
          isExcluded && "opacity-35 bg-white/[0.02] border-dashed border-white/[0.06] grayscale-[30%]"
        )}
      >
        <div className="flex items-start gap-3">
          {/* Minimalist Ultra-Clean Checkbox */}
          <button 
            type="button"
            className={cn(
              "w-5 h-5 shrink-0 rounded-full flex items-center justify-center mt-0.5 border transition-all duration-200 cursor-pointer active:scale-90",
              item.included
                ? "bg-white border-white text-black shadow-sm"
                : "bg-transparent border-white/20 hover:border-white/40 text-transparent"
            )}
            onClick={() => toggleItemIncluded(receipt.id, index)}
            aria-label={item.included ? "Keluarkan item" : "Sertakan item"}
          >
            {item.included && <Check size={12} strokeWidth={3.5} />}
          </button>
          
          {/* Title & Qty */}
          <div className="flex-1 min-w-0">
            <p className={cn(
              "text-sm font-semibold leading-snug break-words transition-all duration-200",
              isExcluded ? "line-through text-white/35" : "text-white/95"
            )}>
              {compactItemName(item.name)}
            </p>
            <p className={cn(
              "text-xs font-medium mt-0.5 transition-all duration-200",
              isExcluded ? "line-through text-white/25" : "text-white/40"
            )}>
              {item.quantity} × {formatCurrency(item.unit_price, receipt.currency)}
            </p>
          </div>

          {/* Total Price */}
          <div className="text-right shrink-0 pl-2">
            <p className={cn(
              "text-sm font-bold tracking-tight transition-all duration-200",
              isExcluded ? "line-through text-white/35" : "text-white"
            )}>
              {formatCurrency(item.total_price, receipt.currency)}
            </p>
          </div>
        </div>

        {/* Category Picker & Type Toggle */}
        <div className={cn("flex items-center justify-between gap-2 pl-8 pt-1 transition-all duration-200", isExcluded && "opacity-40 pointer-events-none")}>
          <div className="flex-1 max-w-[160px]">
            <CategoryPicker
              label=""
              value={catSlug}
              categories={categories}
              onChange={(val) => updateLineItem(receipt.id, index, { confirmed_category: val })}
              onOpenChange={(open) => setOpenPickerIndex(open ? index : null)}
              buttonClassName="!min-h-0 !h-[30px] !py-0 !px-2.5 !rounded-xl !bg-white/[0.06] hover:!bg-white/[0.1] !border-white/10 text-xs text-white/90 font-medium transition-all duration-200"
            />
          </div>
          
          {/* Segmented NEED / WANT Switch Toggle */}
          <div className="inline-flex p-0.5 rounded-xl bg-black/40 border border-white/[0.08] shrink-0">
            <button
              type="button"
              onClick={() => updateLineItem(receipt.id, index, { confirmed_expense_type: 'NEED' })}
              className={cn(
                "h-6.5 px-3 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all duration-200 ease-out active:scale-95 flex items-center gap-1",
                isNeed
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/35 shadow-[0_0_10px_rgba(59,130,246,0.2)]"
                  : "text-white/35 hover:text-white/60 border border-transparent"
              )}
            >
              NEED
            </button>
            <button
              type="button"
              onClick={() => updateLineItem(receipt.id, index, { confirmed_expense_type: 'WANT' })}
              className={cn(
                "h-6.5 px-3 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all duration-200 ease-out active:scale-95 flex items-center gap-1",
                !isNeed
                  ? "bg-pink-500/20 text-pink-400 border border-pink-500/35 shadow-[0_0_10px_rgba(236,72,153,0.2)]"
                  : "text-white/35 hover:text-white/60 border border-transparent"
              )}
            >
              WANT
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderSection = (
    title: string,
    type: 'NEED' | 'WANT',
    items: typeof needItems,
    isMerged: boolean,
    setMerged: (val: boolean) => void,
    mergeCat: string,
    setMergeCat: (val: string) => void,
    mergeTitle: string,
    setMergeTitle: (val: string) => void
  ) => {
    if (items.length === 0) return null;
    
    const isNeed = type === 'NEED';
    const includedCount = items.filter(e => e.item.included).length;
    const totalSecAmount = items.filter(e => e.item.included).reduce((sum, e) => sum + e.item.total_price, 0);
    const hasActiveCardInSection = items.some(e => e.index === openPickerIndex);

    return (
      <div
        style={{ zIndex: hasActiveCardInSection ? 1000 : undefined }}
        className={cn("mb-5 flex flex-col gap-2.5 relative transition-all duration-200", hasActiveCardInSection && "z-[1000]")}
      >
        {/* Section Header */}
        <div className="flex items-center justify-between px-0.5">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className={cn("w-2 h-2 rounded-full", isNeed ? "bg-blue-400" : "bg-pink-400")} />
              <span className={cn("text-xs font-black uppercase tracking-wider", isNeed ? "text-blue-400" : "text-pink-400")}>
                {title}
              </span>
            </div>
            <span className="text-xs text-white/40 font-medium">· {items.length} item</span>
          </div>

          {includedCount > 1 && !isMerged && (
            <button
              type="button"
              onClick={() => setMerged(true)}
              className="text-xs font-semibold text-white/60 hover:text-white flex items-center gap-1 transition-colors px-2 py-1 rounded-lg hover:bg-white/[0.06] active:scale-95"
            >
              <Merge size={13} />
              Gabungkan ({includedCount})
            </button>
          )}
        </div>

        {/* Merged View vs List View */}
        {isMerged ? (
          <div className="p-4 bg-[#1C1C1E] border border-white/[0.1] rounded-2xl flex flex-col gap-3 relative transition-all duration-200 animate-card-pop">
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-white/40 font-bold uppercase tracking-wider">Judul Pengeluaran:</span>
              <div className="flex items-center justify-between gap-2">
                <input
                  type="text"
                  value={mergeTitle}
                  onChange={(e) => setMergeTitle(e.target.value)}
                  className="flex-1 font-bold text-white text-sm bg-white/[0.06] border border-white/10 rounded-xl px-3 py-1.5 focus:outline-none focus:border-white/30 transition-all"
                  placeholder="Judul Pengeluaran"
                />
                <p className="font-extrabold text-white shrink-0 bg-white/10 px-2.5 py-1.5 rounded-xl text-sm">
                  {formatCurrency(totalSecAmount, receipt.currency)}
                </p>
              </div>
              <p className="text-xs text-white/50 mt-1 leading-relaxed">
                {items.filter(e => e.item.included).map(e => {
                  const cName = compactItemName(e.item.name);
                  return e.item.quantity > 1 ? `${e.item.quantity}x ${cName}` : cName;
                }).join(', ')}
              </p>
            </div>
            
            {/* CategoryPicker & Cancel in Merge Mode */}
            <div className="flex items-center justify-between gap-2 mt-1 pt-3 border-t border-white/[0.08]">
              <div className="flex-1 max-w-[160px]">
                <CategoryPicker
                  label=""
                  value={mergeCat}
                  categories={categories}
                  onChange={setMergeCat}
                  buttonClassName="!min-h-0 !h-[30px] !py-0 !px-2.5 !rounded-xl !bg-white/[0.06] hover:!bg-white/[0.1] !border-white/10 text-xs text-white/90 font-medium"
                />
              </div>
              <button 
                type="button"
                onClick={() => setMerged(false)}
                className="h-[30px] px-3 rounded-xl bg-white/10 hover:bg-white/15 text-white/70 hover:text-white text-xs font-semibold flex items-center gap-1 transition-all duration-200 active:scale-95"
              >
                <X size={13} /> Batal
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 animate-card-pop">
            {items.map(renderItem)}
          </div>
        )}
      </div>
    );
  };

  return (
    <BottomSheet 
      isOpen={isOpen} 
      onClose={onClose}
      containPageOverscroll
      footer={
        <div className="flex gap-2 pt-2">
          {/* Close & Preserve Edits Button */}
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-12 rounded-xl bg-white/[0.08] hover:bg-white/[0.12] text-white font-semibold text-sm transition-all active:scale-[0.98]"
          >
            Tutup
          </button>
          
          {/* Next Button -> Opens AddExpenseSheet review sequence */}
          <button
            type="button"
            onClick={handleNext}
            disabled={totalIncluded === 0}
            className="flex-1 h-12 rounded-xl bg-white text-black hover:bg-white/90 font-extrabold text-sm flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all disabled:opacity-40 shadow-lg"
          >
            <span>Lanjut ({totalIncluded} item)</span>
            <ChevronRight size={16} strokeWidth={2.5} />
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-5 pb-4">
        {/* Header */}
        <div className="flex flex-col items-center text-center pt-1">
          <div className="w-11 h-11 bg-white/[0.06] border border-white/10 rounded-2xl flex items-center justify-center mb-2.5 text-white/70">
            {receipt.suggested_type === 'income' ? <Package size={22} /> : <ShoppingBag size={22} />}
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight mb-1">
            {receipt.store_name || 'Struk Tanpa Nama'}
          </h2>

          {/* Interactive Date Picker Pill - Directly Editable on Click */}
          <button
            type="button"
            onClick={handleOpenDatePicker}
            className="relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] active:bg-white/[0.16] border border-white/10 hover:border-white/20 active:scale-95 transition-all duration-200 mb-3.5 cursor-pointer group"
          >
            <Calendar size={13} className="text-white/60 group-hover:text-white/90 transition-colors" />
            <span className="text-xs font-semibold text-white/80 group-hover:text-white transition-colors">
              {formatDate(selectedDate)}
            </span>
            <Pencil size={10} className="text-white/40 group-hover:text-white/70 transition-colors ml-0.5" />
            <input
              ref={dateInputRef}
              type="date"
              value={selectedDate}
              onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full pointer-events-auto"
            />
          </button>

          {/* Total Display */}
          <div className="inline-flex flex-col items-center justify-center">
            <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest mb-0.5">Total</span>
            <span className="text-2xl font-black text-white tracking-tight">
              {formatCurrency(totalAmount, receipt.currency)}
            </span>
          </div>
        </div>

        {/* Line Items Sections */}
        <div className="mt-1">
          {renderSection('NEED', 'NEED', needItems, mergedNeeds, setMergedNeeds, needMergeCategory, setNeedMergeCategory, needMergeTitle, setNeedMergeTitle)}
          {renderSection('WANT', 'WANT', wantItems, mergedWants, setMergedWants, wantMergeCategory, setWantMergeCategory, wantMergeTitle, setWantMergeTitle)}
        </div>
      </div>
    </BottomSheet>
  );
};

export { ReceiptReviewSheet };
export default ReceiptReviewSheet;
