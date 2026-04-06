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
  aiKey: string;
  /** Only used when provider is openrouter */
  openrouterModel: string;

  lastSynced: string | null;

  // ── Actions ──────────────────────────────────────────────
  setAiProvider: (v: AiProvider) => void;
  setAiKey: (v: string) => void;
  setOpenrouterModel: (v: string) => void;
  setLastSynced: (v: string | null) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      aiProvider: 'openrouter',
      aiKey: '',
      openrouterModel: 'mistralai/mistral-7b-instruct:free',
      lastSynced: null,

      setAiProvider: (aiProvider) => set({ aiProvider }),
      setAiKey: (aiKey) => set({ aiKey }),
      setOpenrouterModel: (openrouterModel) => set({ openrouterModel }),
      setLastSynced: (lastSynced) => set({ lastSynced }),
    }),
    {
      name: 'keuanganku-settings',
      partialize: (state) => ({
        aiProvider: state.aiProvider,
        aiKey: state.aiKey,
        openrouterModel: state.openrouterModel,
        lastSynced: state.lastSynced,
      }),
    }
  )
);
