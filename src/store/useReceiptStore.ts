import { create } from 'zustand';
import type {
  ReceiptInboxItem,
  ReceiptLineItem,
  ReceiptAIResponse,
  ReceiptMergeGroup,
  Category,
} from '../types';
import { scanReceipt, type ReceiptAiConfig } from '../lib/receiptAi';
import { getSupabaseClientAsync } from '../lib/supabase';
import { getActiveDataScope, GUEST_DATA_SCOPE } from '../lib/dataScope';
import { useUIStore } from './useAppStore';
import { useExpenseStore } from './useExpenseStore';
import { syncWithSupabaseIfNeeded } from '../lib/sync-engine';

// ============================================================
//  RECEIPT INBOX STORE
//
//  Manages the lifecycle of receipt scanning:
//  upload → AI processing → inbox → review → confirm as expenses
// ============================================================

export interface ReceiptReviewItem {
  name: string;
  amount: number;
  currency: 'IDR' | 'USD';
  category: string;
  type: 'NEED' | 'WANT' | 'TRANSFER';
  date: string;
  note?: string;
  is_recurring: boolean;
}

export interface ReceiptReviewSequence {
  receiptId: string;
  items: ReceiptReviewItem[];
  currentIndex: number;
}

export interface ReceiptScanProgress {
  current: number;
  total: number;
  lastCount: number;
}

interface ReceiptStoreState {
  inboxItems: ReceiptInboxItem[];
  isUploading: boolean;
  error: string | null;
  _hasLoaded: boolean;
  reviewSequence: ReceiptReviewSequence | null;
  scanProgress: ReceiptScanProgress | null;
  latestScannedItem: ReceiptInboxItem | null;
  latestImagePreviewUrl: string | null;
}

interface ReceiptStoreActions {
  /** Clear latest scan cache and revoke preview blob URL */
  clearLatestScanCache: () => void;

  /** Load pending/ready inbox items from Supabase */
  loadInbox: () => Promise<void>;

  /**
   * Upload an image, scan it with AI, and add the result to the inbox.
   * The image is compressed client-side and discarded after processing.
   */
  uploadAndScan: (file: File, categories: Category[], config: ReceiptAiConfig) => Promise<void>;

  /**
   * Upload multiple images, scan them sequentially with AI, and add results to inbox.
   */
  uploadAndScanMultiple: (files: File[], categories: Category[], config: ReceiptAiConfig) => Promise<number>;

  /** Update a line item's properties during review */
  updateLineItem: (inboxId: string, itemIndex: number, updates: Partial<ReceiptLineItem>) => void;

  /** Toggle a line item's type between NEED and WANT */
  toggleItemType: (inboxId: string, itemIndex: number) => void;

  /** Toggle a line item's included status */
  toggleItemIncluded: (inboxId: string, itemIndex: number) => void;

  /** Set all items in a receipt to the same expense type */
  setAllItemsType: (inboxId: string, type: 'NEED' | 'WANT') => void;

  /**
   * Confirm a receipt and create individual expenses.
   * Returns the created expense data for the caller to pass to addExpense().
   */
  getExpensesFromReceipt: (inboxId: string, overrideDate?: string) => ReceiptReviewItem[];

  /**
   * Confirm a receipt with merge groups.
   * Some items become individual expenses, merged items become single expenses.
   */
  getExpensesFromReceiptMerged: (
    inboxId: string,
    mergeGroups: ReceiptMergeGroup[],
    overrideDate?: string,
  ) => ReceiptReviewItem[];

  /** Start a step-by-step review sequence using AddExpenseSheet */
  startReviewSequence: (receiptId: string, items: ReceiptReviewItem[]) => void;

  /** Advance to the next item in the review sequence. Returns true if more remain. */
  advanceReviewSequence: () => Promise<boolean>;

  /** Cancel active review sequence */
  cancelReviewSequence: () => void;

  /** Mark a receipt inbox item as confirmed */
  markConfirmed: (inboxId: string) => Promise<void>;

  /** Dismiss a receipt (user doesn't want to process it) */
  dismissItem: (inboxId: string) => Promise<void>;

  /** Retry a failed scan */
  retryScan: (inboxId: string, file: File, categories: Category[], config: ReceiptAiConfig) => Promise<void>;

  /** Clear error state */
  clearError: () => void;
}

type ReceiptStore = ReceiptStoreState & ReceiptStoreActions;

// ── Helpers ───────────────────────────────────────────────────

export function inferUnitName(name: string, suggestedUnit?: string): string {
  if (suggestedUnit && !['pcs', 'item', 'buah'].includes(suggestedUnit.toLowerCase())) {
    return suggestedUnit;
  }
  const lower = name.toLowerCase();
  if (lower.includes('15l') || lower.includes('19l') || lower.includes('galon')) return 'galon';
  if (lower.includes('botol') || lower.includes('450ml') || lower.includes('600ml') || lower.includes('1.5l') || lower.includes('330ml')) return 'botol';
  if (lower.includes('kotak') || lower.includes('uht') || lower.includes('tetra') || lower.includes('full cream') || lower.includes('1l')) return 'kotak';
  if (lower.includes('kaleng') || lower.includes('can')) return 'kaleng';
  if (lower.includes('mie') || lower.includes('indomie') || lower.includes('sedaap') || lower.includes('snack') || lower.includes('chips') || lower.includes('biskuit') || lower.includes('wafer')) return 'bungkus';
  if (lower.includes('tisu') || lower.includes('tissue') || lower.includes('pack') || lower.includes('wipes')) return 'pack';
  if (lower.includes('telur')) return 'butir';
  if (lower.includes('sepatu') || lower.includes('kaos kaki')) return 'pasang';

  return suggestedUnit || 'item';
}

export function compactItemName(rawName: string): string {
  if (!rawName) return '';
  // AI handles all naming intelligence via prompt — this is just a whitespace safety net
  return rawName.replace(/\s+/g, ' ').trim();
}

function mapDbRowToInboxItem(row: Record<string, unknown>): ReceiptInboxItem {
  const aiResult = (row.ai_result ?? {}) as Record<string, unknown>;
  const items = Array.isArray(aiResult.items) ? aiResult.items : [];

  return {
    id: row.id as string,
    store_name: (row.store_name as string) ?? null,
    receipt_date: row.receipt_date ? String(row.receipt_date) : null,
    total: typeof row.total === 'number' ? row.total : null,
    currency: (row.currency as 'IDR' | 'USD') ?? 'IDR',
    suggested_type: (row.suggested_type as 'expense' | 'income') ?? 'expense',
    items: items.map((item: Record<string, unknown>) => ({
      name: compactItemName(String(item.name ?? 'Item')),
      quantity: Number(item.quantity ?? 1),
      unit_price: Number(item.unit_price ?? 0),
      total_price: Number(item.total_price ?? 0),
      suggested_category: String(item.suggested_category ?? 'keperluan'),
      suggested_expense_type: item.suggested_expense_type === 'WANT' ? 'WANT' as const : 'NEED' as const,
      suggested_unit: item.suggested_unit ? String(item.suggested_unit) : undefined,
      included: true,
    })),
    status: (row.status as ReceiptInboxItem['status']) ?? 'processing',
    error_message: (row.error_message as string) ?? undefined,
    created_at: String(row.created_at ?? new Date().toISOString()),
  };
}

function aiResponseToDbFields(result: ReceiptAIResponse) {
  return {
    ai_result: result,
    store_name: result.store_name,
    receipt_date: result.date,
    total: result.total,
    currency: result.currency,
    suggested_type: result.suggested_type,
    item_count: result.items.length,
    status: 'ready' as const,
  };
}

// ── Store ─────────────────────────────────────────────────────

export const useReceiptStore = create<ReceiptStore>((set, get) => ({
  inboxItems: [],
  isUploading: false,
  error: null,
  _hasLoaded: false,
  reviewSequence: null,
  scanProgress: null,
  latestScannedItem: null,
  latestImagePreviewUrl: null,

  clearLatestScanCache: () => {
    const currentPreview = get().latestImagePreviewUrl;
    if (currentPreview && currentPreview.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(currentPreview);
      } catch {}
    }
    set({ latestScannedItem: null, latestImagePreviewUrl: null, scanProgress: null });
  },

  loadInbox: async () => {
    const scope = getActiveDataScope();
    if (scope === GUEST_DATA_SCOPE) return; // No inbox in guest mode

    const supabase = await getSupabaseClientAsync();
    if (!supabase) return;

    try {
      const { data, error } = await supabase
        .from('receipt_inbox')
        .select('*')
        .in('status', ['processing', 'ready', 'error'])
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      const items = (data ?? []).map(mapDbRowToInboxItem);
      set({ inboxItems: items, _hasLoaded: true });
    } catch (err) {
      console.error('[ReceiptStore] loadInbox failed:', err);
    }
  },

  uploadAndScan: async (file, categories, config) => {
    const scope = getActiveDataScope();
    if (scope === GUEST_DATA_SCOPE) {
      set({ error: 'Scan struk tidak tersedia di mode demo.' });
      return;
    }

    // Revoke old blob URL and clear previous scan progress/cache if single scan
    const isMultiScan = Boolean(get().scanProgress && get().scanProgress!.total > 1);
    if (!isMultiScan) {
      get().clearLatestScanCache();
    }

    let previewUrl: string | null = null;
    try {
      previewUrl = URL.createObjectURL(file);
    } catch {}

    set({
      isUploading: true,
      error: null,
      scanProgress: isMultiScan ? get().scanProgress : null,
      latestImagePreviewUrl: previewUrl,
      latestScannedItem: null,
    });

    const supabase = await getSupabaseClientAsync();
    let inboxId: string | null = null;

    try {
      // Step 1: Create placeholder row in Supabase (status: processing)
      if (supabase) {
        const { data: user } = await supabase.auth.getUser();
        if (user?.user?.id) {
          const { data: row, error: insertError } = await supabase
            .from('receipt_inbox')
            .insert({
              user_id: user.user.id,
              ai_result: {},
              status: 'processing',
            })
            .select('id')
            .single();

          if (insertError) throw insertError;
          inboxId = row?.id ?? null;
        }
      }

      // Add a temporary processing item to local state
      const tempId = inboxId ?? `temp-${Date.now()}`;
      const tempItem: ReceiptInboxItem = {
        id: tempId,
        store_name: null,
        receipt_date: null,
        total: null,
        currency: 'IDR',
        suggested_type: 'expense',
        items: [],
        status: 'processing',
        created_at: new Date().toISOString(),
      };
      set((state) => ({
        inboxItems: [tempItem, ...state.inboxItems],
      }));

      // Step 2: Compress image and scan with AI
      const result = await scanReceipt(file, categories, config);

      // Step 3: Update Supabase row with results
      if (supabase && inboxId) {
        const { error: updateError } = await supabase
          .from('receipt_inbox')
          .update(aiResponseToDbFields(result))
          .eq('id', inboxId);

        if (updateError) throw updateError;
      }

      // Step 4: Update local state
      const readyItem: ReceiptInboxItem = {
        id: tempId,
        store_name: result.store_name,
        receipt_date: result.date,
        total: result.total,
        currency: result.currency,
        suggested_type: result.suggested_type,
        items: result.items.map((item) => ({
          ...item,
          name: compactItemName(item.name),
          suggested_unit: item.suggested_unit,
          included: true,
        })),
        status: 'ready',
        created_at: tempItem.created_at,
      };

      set((state) => ({
        inboxItems: state.inboxItems.map((i) => (i.id === tempId ? readyItem : i)),
        isUploading: false,
        latestScannedItem: readyItem,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal memproses struk.';
      set((state) => ({
        inboxItems: state.inboxItems.map((i) =>
          i.id === (inboxId ?? `temp-${Date.now()}`)
            ? { ...i, status: 'error' as const, error_message: message }
            : i,
        ),
        isUploading: false,
        error: message,
      }));
    }
  },

  uploadAndScanMultiple: async (files, categories, config) => {
    const scope = getActiveDataScope();
    if (scope === GUEST_DATA_SCOPE) {
      set({ error: 'Scan struk tidak tersedia di mode demo.' });
      return 0;
    }

    if (!files || files.length === 0) return 0;

    const total = files.length;
    set({
      isUploading: true,
      error: null,
      scanProgress: { current: 1, total, lastCount: total },
    });

    let successCount = 0;

    for (let i = 0; i < total; i++) {
      set({
        scanProgress: { current: i + 1, total, lastCount: total },
      });

      try {
        await get().uploadAndScan(files[i], categories, config);
        successCount++;
      } catch (err) {
        console.error(`[ReceiptStore] Multi-scan failed for file ${i + 1}:`, err);
      }
    }

    set({
      isUploading: false,
      scanProgress: { current: total, total, lastCount: successCount || total },
    });

    return successCount;
  },

  updateLineItem: (inboxId, itemIndex, updates) => {
    set((state) => ({
      inboxItems: state.inboxItems.map((item) => {
        if (item.id !== inboxId) return item;
        const newItems = [...item.items];
        if (newItems[itemIndex]) {
          newItems[itemIndex] = { ...newItems[itemIndex], ...updates };
        }
        return { ...item, items: newItems };
      }),
    }));
  },

  toggleItemType: (inboxId, itemIndex) => {
    set((state) => ({
      inboxItems: state.inboxItems.map((item) => {
        if (item.id !== inboxId) return item;
        const newItems = [...item.items];
        if (newItems[itemIndex]) {
          const current = newItems[itemIndex].confirmed_expense_type
            ?? newItems[itemIndex].suggested_expense_type;
          newItems[itemIndex] = {
            ...newItems[itemIndex],
            confirmed_expense_type: current === 'NEED' ? 'WANT' : 'NEED',
          };
        }
        return { ...item, items: newItems };
      }),
    }));
  },

  toggleItemIncluded: (inboxId, itemIndex) => {
    set((state) => ({
      inboxItems: state.inboxItems.map((item) => {
        if (item.id !== inboxId) return item;
        const newItems = [...item.items];
        if (newItems[itemIndex]) {
          newItems[itemIndex] = {
            ...newItems[itemIndex],
            included: !newItems[itemIndex].included,
          };
        }
        return { ...item, items: newItems };
      }),
    }));
  },

  setAllItemsType: (inboxId, type) => {
    set((state) => ({
      inboxItems: state.inboxItems.map((item) => {
        if (item.id !== inboxId) return item;
        return {
          ...item,
          items: item.items.map((li) => ({
            ...li,
            confirmed_expense_type: type,
          })),
        };
      }),
    }));
  },

  getExpensesFromReceipt: (inboxId, overrideDate) => {
    const item = get().inboxItems.find((i) => i.id === inboxId);
    if (!item) return [];

    const dateToUse = overrideDate || item.receipt_date || new Date().toISOString().slice(0, 10);
    const total = item.total ?? 0;
    const rawSum = item.items.reduce((sum, li) => sum + li.total_price, 0);
    const factor = total > 0 && rawSum > 0 && total !== rawSum ? total / rawSum : 1;

    return item.items
      .filter((li) => li.included)
      .map((li) => ({
        name: compactItemName(li.name),
        amount: Math.round(li.total_price * factor),
        currency: item.currency,
        category: li.confirmed_category ?? li.suggested_category,
        type: (li.confirmed_expense_type ?? li.suggested_expense_type) as 'NEED' | 'WANT' | 'TRANSFER',
        date: dateToUse,
        note: li.quantity > 1 ? `${li.quantity} item` : undefined,
        is_recurring: false,
      }));
  },

  getExpensesFromReceiptMerged: (inboxId, mergeGroups, overrideDate) => {
    const item = get().inboxItems.find((i) => i.id === inboxId);
    if (!item) return [];

    const dateToUse = overrideDate || item.receipt_date || new Date().toISOString().slice(0, 10);
    const total = item.total ?? 0;
    const rawSum = item.items.reduce((sum, li) => sum + li.total_price, 0);
    const factor = total > 0 && rawSum > 0 && total !== rawSum ? total / rawSum : 1;

    const expenses: Array<{
      name: string;
      amount: number;
      currency: 'IDR' | 'USD';
      category: string;
      type: 'NEED' | 'WANT' | 'TRANSFER';
      date: string;
      note?: string;
      is_recurring: boolean;
    }> = [];

    // Track which items are part of a merge group
    const mergedIndices = new Set<number>();
    for (const group of mergeGroups) {
      for (const idx of group.itemIndices) {
        mergedIndices.add(idx);
      }
    }

    // Add individual (non-merged) items
    item.items.forEach((li, idx) => {
      if (!li.included || mergedIndices.has(idx)) return;
      expenses.push({
        name: compactItemName(li.name),
        amount: Math.round(li.total_price * factor),
        currency: item.currency,
        category: li.confirmed_category ?? li.suggested_category,
        type: (li.confirmed_expense_type ?? li.suggested_expense_type) as 'NEED' | 'WANT' | 'TRANSFER',
        date: dateToUse,
        note: li.quantity > 1 ? `${li.quantity} item` : undefined,
        is_recurring: false,
      });
    });

    // Add merged groups
    for (const group of mergeGroups) {
      const groupItems = group.itemIndices
        .map((idx) => item.items[idx])
        .filter((li) => li && li.included);

      if (groupItems.length === 0) continue;

      const totalAmount = Math.round(groupItems.reduce((sum, li) => sum + li.total_price, 0) * factor);
      const mergedName = group.mergedName
        ?? (item.store_name ? `${item.store_name} (${group.type})` : `Gabungan ${group.type}`);
      
      // Compact notation for merged list: e.g. "2x Le Minerale 15L, Regal Marie, 3x Indomie Goreng"
      const itemNames = groupItems
        .map((li) => {
          const cName = compactItemName(li.name);
          return li.quantity > 1 ? `${li.quantity}x ${cName}` : cName;
        })
        .join(', ');

      expenses.push({
        name: mergedName,
        amount: totalAmount,
        currency: item.currency,
        category: group.category,
        type: group.type,
        date: dateToUse,
        note: itemNames,
        is_recurring: false,
      });
    }

    return expenses;
  },

  startReviewSequence: (receiptId, items) => {
    if (!items || items.length === 0) return;
    set({
      reviewSequence: {
        receiptId,
        items,
        currentIndex: 0,
      },
    });
    // Open AddExpenseSheet with first item prefilled
    useUIStore.getState().openAddSheet(items[0]);
  },

  advanceReviewSequence: async () => {
    const seq = get().reviewSequence;
    if (!seq) return false;

    const nextIndex = seq.currentIndex + 1;
    if (nextIndex < seq.items.length) {
      set({
        reviewSequence: {
          ...seq,
          currentIndex: nextIndex,
        },
      });
      // Open AddExpenseSheet prefilled with next item
      useUIStore.getState().openAddSheet(seq.items[nextIndex]);
      return true;
    }

    // Sequence completed!
    await get().markConfirmed(seq.receiptId);
    set({ reviewSequence: null });
    await useExpenseStore.getState().loadExpenses({ force: true });
    void syncWithSupabaseIfNeeded({ force: true });
    return false;
  },

  cancelReviewSequence: () => {
    set({ reviewSequence: null });
  },

  markConfirmed: async (inboxId) => {
    const supabase = await getSupabaseClientAsync();
    if (supabase) {
      try {
        await supabase
          .from('receipt_inbox')
          .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
          .eq('id', inboxId);
      } catch { /* best-effort */ }
    }

    set((state) => ({
      inboxItems: state.inboxItems.filter((i) => i.id !== inboxId),
    }));
  },

  dismissItem: async (inboxId) => {
    const supabase = await getSupabaseClientAsync();
    if (supabase) {
      try {
        await supabase
          .from('receipt_inbox')
          .update({ status: 'dismissed' })
          .eq('id', inboxId);
      } catch { /* best-effort */ }
    }

    set((state) => ({
      inboxItems: state.inboxItems.filter((i) => i.id !== inboxId),
    }));
  },

  retryScan: async (inboxId, file, categories, config) => {
    // Remove the old error item
    set((state) => ({
      inboxItems: state.inboxItems.filter((i) => i.id !== inboxId),
    }));

    // Delete old row if it's a real ID
    const supabase = await getSupabaseClientAsync();
    if (supabase && !inboxId.startsWith('temp-')) {
      try {
        await supabase
          .from('receipt_inbox')
          .delete()
          .eq('id', inboxId);
      } catch { /* best-effort */ }
    }

    // Re-run upload and scan
    await get().uploadAndScan(file, categories, config);
  },

  clearError: () => set({ error: null }),
}));
