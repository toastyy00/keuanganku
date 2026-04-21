import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { GUEST_DATA_SCOPE, getActiveDataScope } from '../lib/dataScope';

// ============================================================
//  SETTINGS STORE - scoped by active account (guest/user)
// ============================================================

export type AiProvider = 'openrouter' | 'openai';

interface ScopedSettingsSnapshot {
  aiProvider: AiProvider;
  openaiKey: string;
  openrouterKey: string;
  openrouterModel: string;
  personalMonthlyBudget: number;
  familySupportMonthlyBudget: number;
  lastSynced: string | null;
}

const DEFAULT_SCOPED_SETTINGS: ScopedSettingsSnapshot = {
  aiProvider: 'openrouter',
  openaiKey: '',
  openrouterKey: '',
  openrouterModel: 'mistralai/mistral-7b-instruct:free',
  personalMonthlyBudget: 0,
  familySupportMonthlyBudget: 0,
  lastSynced: null,
};

interface SettingsState extends ScopedSettingsSnapshot {
  currentScope: string;
  settingsByScope: Record<string, ScopedSettingsSnapshot>;

  setAiProvider: (v: AiProvider) => void;
  setOpenaiKey: (v: string) => void;
  setOpenrouterKey: (v: string) => void;
  setOpenrouterModel: (v: string) => void;
  setPersonalMonthlyBudget: (v: number) => void;
  setFamilySupportMonthlyBudget: (v: number) => void;
  setLastSynced: (v: string | null) => void;
  ensureScope: (scope: string) => void;
}

function snapshotFromState(state: SettingsState): ScopedSettingsSnapshot {
  return {
    aiProvider: state.aiProvider,
    openaiKey: state.openaiKey,
    openrouterKey: state.openrouterKey,
    openrouterModel: state.openrouterModel,
    personalMonthlyBudget: state.personalMonthlyBudget,
    familySupportMonthlyBudget: state.familySupportMonthlyBudget,
    lastSynced: state.lastSynced,
  };
}

function withScopedPatch(
  state: SettingsState,
  patch: Partial<ScopedSettingsSnapshot>,
): Pick<SettingsState, keyof ScopedSettingsSnapshot | 'settingsByScope'> {
  const nextSnapshot: ScopedSettingsSnapshot = {
    ...snapshotFromState(state),
    ...patch,
  };

  return {
    ...patch,
    settingsByScope: {
      ...state.settingsByScope,
      [state.currentScope]: nextSnapshot,
    },
  } as Pick<SettingsState, keyof ScopedSettingsSnapshot | 'settingsByScope'>;
}

function toScopedSnapshot(raw: Partial<ScopedSettingsSnapshot> | undefined): ScopedSettingsSnapshot {
  return {
    aiProvider: raw?.aiProvider === 'openai' ? 'openai' : 'openrouter',
    openaiKey: typeof raw?.openaiKey === 'string' ? raw.openaiKey : '',
    openrouterKey: typeof raw?.openrouterKey === 'string' ? raw.openrouterKey : '',
    openrouterModel: typeof raw?.openrouterModel === 'string'
      ? raw.openrouterModel
      : DEFAULT_SCOPED_SETTINGS.openrouterModel,
    personalMonthlyBudget: typeof raw?.personalMonthlyBudget === 'number'
      ? raw.personalMonthlyBudget
      : 0,
    familySupportMonthlyBudget: typeof raw?.familySupportMonthlyBudget === 'number'
      ? raw.familySupportMonthlyBudget
      : 0,
    lastSynced: typeof raw?.lastSynced === 'string' || raw?.lastSynced === null
      ? raw.lastSynced
      : null,
  };
}

const initialScope = getActiveDataScope();
const initialSnapshot = { ...DEFAULT_SCOPED_SETTINGS };

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...initialSnapshot,
      currentScope: initialScope,
      settingsByScope: {
        [initialScope]: initialSnapshot,
      },

      setAiProvider: (aiProvider) => set((state) => withScopedPatch(state, { aiProvider })),
      setOpenaiKey: (openaiKey) => set((state) => withScopedPatch(state, { openaiKey })),
      setOpenrouterKey: (openrouterKey) => set((state) => withScopedPatch(state, { openrouterKey })),
      setOpenrouterModel: (openrouterModel) => set((state) => withScopedPatch(state, { openrouterModel })),
      setPersonalMonthlyBudget: (personalMonthlyBudget) =>
        set((state) => withScopedPatch(state, { personalMonthlyBudget })),
      setFamilySupportMonthlyBudget: (familySupportMonthlyBudget) =>
        set((state) => withScopedPatch(state, { familySupportMonthlyBudget })),
      setLastSynced: (lastSynced) => set((state) => withScopedPatch(state, { lastSynced })),

      ensureScope: (scope) => set((state) => {
        if (state.currentScope === scope) return state;

        const currentSnapshot = snapshotFromState(state);
        const nextByScope: Record<string, ScopedSettingsSnapshot> = {
          ...state.settingsByScope,
          [state.currentScope]: currentSnapshot,
        };
        const targetSnapshot = nextByScope[scope] ?? { ...DEFAULT_SCOPED_SETTINGS };
        nextByScope[scope] = targetSnapshot;

        return {
          ...targetSnapshot,
          currentScope: scope,
          settingsByScope: nextByScope,
        };
      }),
    }),
    {
      name: 'keuanganku-settings',
      version: 2,
      migrate: (persistedState, version) => {
        const raw = (persistedState ?? {}) as Partial<SettingsState>;

        if (version < 2 || !raw.settingsByScope) {
          const legacySnapshot = toScopedSnapshot(raw);
          const legacyScope = typeof raw.currentScope === 'string'
            ? raw.currentScope
            : GUEST_DATA_SCOPE;

          return {
            ...legacySnapshot,
            currentScope: legacyScope,
            settingsByScope: {
              [legacyScope]: legacySnapshot,
            },
          } satisfies Partial<SettingsState>;
        }

        const migratedByScope = Object.fromEntries(
          Object.entries(raw.settingsByScope).map(([scope, snapshot]) => [
            scope,
            toScopedSnapshot(snapshot),
          ])
        );

        const currentScope = typeof raw.currentScope === 'string'
          ? raw.currentScope
          : GUEST_DATA_SCOPE;
        const currentSnapshot = migratedByScope[currentScope] ?? { ...DEFAULT_SCOPED_SETTINGS };
        migratedByScope[currentScope] = currentSnapshot;

        return {
          ...currentSnapshot,
          currentScope,
          settingsByScope: migratedByScope,
        } satisfies Partial<SettingsState>;
      },
      partialize: (state) => ({
        aiProvider: state.aiProvider,
        openaiKey: state.openaiKey,
        openrouterKey: state.openrouterKey,
        openrouterModel: state.openrouterModel,
        personalMonthlyBudget: state.personalMonthlyBudget,
        familySupportMonthlyBudget: state.familySupportMonthlyBudget,
        lastSynced: state.lastSynced,
        currentScope: state.currentScope,
        settingsByScope: state.settingsByScope,
      }),
    }
  )
);
