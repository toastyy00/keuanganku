import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================================
//  SETTINGS STORE — AI provider settings
//  Persists to 'keuanganku-settings' in localStorage.
//  Supabase credentials are now baked in at build time (.env).
// ============================================================

export type AiProvider = 'openrouter' | 'openai';

interface SettingsState {
  aiProvider: AiProvider;
  openaiKey: string;
  openrouterKey: string;
  /** Only used when provider is openrouter */
  openrouterModel: string;
  personalMonthlyBudget: number;
  familySupportMonthlyBudget: number;

  lastSynced: string | null;

  // ── Actions ──────────────────────────────────────────────
  setAiProvider: (v: AiProvider) => void;
  setOpenaiKey: (v: string) => void;
  setOpenrouterKey: (v: string) => void;
  setOpenrouterModel: (v: string) => void;
  setPersonalMonthlyBudget: (v: number) => void;
  setFamilySupportMonthlyBudget: (v: number) => void;
  setLastSynced: (v: string | null) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      aiProvider: 'openrouter',
      openaiKey: '',
      openrouterKey: '',
      openrouterModel: 'mistralai/mistral-7b-instruct:free',
      personalMonthlyBudget: 0,
      familySupportMonthlyBudget: 0,
      lastSynced: null,

      setAiProvider: (aiProvider) => set({ aiProvider }),
      setOpenaiKey: (openaiKey) => set({ openaiKey }),
      setOpenrouterKey: (openrouterKey) => set({ openrouterKey }),
      setOpenrouterModel: (openrouterModel) => set({ openrouterModel }),
      setPersonalMonthlyBudget: (personalMonthlyBudget) => set({ personalMonthlyBudget }),
      setFamilySupportMonthlyBudget: (familySupportMonthlyBudget) => set({ familySupportMonthlyBudget }),
      setLastSynced: (lastSynced) => set({ lastSynced }),
    }),
    {
      name: 'keuanganku-settings',
      partialize: (state) => ({
        aiProvider: state.aiProvider,
        openaiKey: state.openaiKey,
        openrouterKey: state.openrouterKey,
        openrouterModel: state.openrouterModel,
        personalMonthlyBudget: state.personalMonthlyBudget,
        familySupportMonthlyBudget: state.familySupportMonthlyBudget,
        lastSynced: state.lastSynced,
      }),
    }
  )
);
