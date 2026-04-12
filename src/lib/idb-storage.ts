/**
 * idb-storage.ts
 * ─────────────────────────────────────────────────────────────
 * Drop-in replacement for localStorage read/write helpers using
 * IndexedDB via idb-keyval.
 *
 * Benefits over localStorage:
 *  • No 5 MB cap — browser-allocated quota (typically hundreds of MB)
 *  • Asynchronous — never blocks the main thread / UI rendering
 *  • Works in Web Workers and Service Workers
 *
 * Backward-compatible:
 *  • On first run, existing localStorage data is automatically copied to
 *    IndexedDB and the localStorage keys are then removed so there is no
 *    duplicate state. Subsequent launches skip the migration.
 */

import { get, set, del, createStore } from 'idb-keyval';

// ── Dedicated IDB store so we don't pollute the default keyval store ────────

const appStore = createStore('keuanganku-db', 'app-store');

// ── Migration flag key (stored in IDB itself) ────────────────────────────────

const MIGRATION_DONE_KEY = '__ls_migration_done__';

// ── localStorage keys that we want to migrate ───────────────────────────────

const LS_KEYS_TO_MIGRATE = ['expenses', 'categories', 'recurring'] as const;

// ── One-time migration: localStorage → IndexedDB ────────────────────────────

let migrationPromise: Promise<void> | null = null;

async function runMigrationOnce(): Promise<void> {
  if (migrationPromise) return migrationPromise;

  migrationPromise = (async () => {
    try {
      const alreadyDone = await get<boolean>(MIGRATION_DONE_KEY, appStore);
      if (alreadyDone) return;

      for (const key of LS_KEYS_TO_MIGRATE) {
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            await set(key, parsed, appStore);
            localStorage.removeItem(key);
          } catch {
            // Corrupted entry — skip silently
          }
        }
      }

      // Migrate the zustand persist snapshot too
      const zustandKey = 'keuanganku-expense-store';
      const zustandRaw = localStorage.getItem(zustandKey);
      if (zustandRaw) {
        try {
          const parsed = JSON.parse(zustandRaw);
          await set(zustandKey, parsed, appStore);
          localStorage.removeItem(zustandKey);
        } catch {
          // Ignore
        }
      }

      await set(MIGRATION_DONE_KEY, true, appStore);
    } catch (err) {
      // If IDB is unavailable (private browsing in some browsers), fail silently
      console.warn('[idb-storage] Migration failed, falling back to localStorage:', err);
    }
  })();

  return migrationPromise;
}

// ── Public read / write helpers (mirrors old localStorage API) ───────────────

/**
 * Read a JSON array from IndexedDB.
 * Falls back to localStorage if IDB is unexpectedly unavailable.
 */
export async function readIDB<T>(key: string): Promise<T[]> {
  await runMigrationOnce();
  try {
    const value = await get<T[]>(key, appStore);
    return value ?? [];
  } catch {
    // IDB unavailable (e.g. Safari private mode) — degrade gracefully
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T[]) : [];
    } catch {
      return [];
    }
  }
}

/**
 * Write a JSON array to IndexedDB.
 * Falls back to localStorage if IDB is unexpectedly unavailable.
 */
export async function writeIDB<T>(key: string, data: T[]): Promise<void> {
  await runMigrationOnce();
  try {
    await set(key, data, appStore);
  } catch {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      // Storage quota exceeded — nothing we can do
    }
  }
}

/**
 * Delete a key from IndexedDB.
 */
export async function deleteIDB(key: string): Promise<void> {
  try {
    await del(key, appStore);
  } catch {
    localStorage.removeItem(key);
  }
}

// ── Zustand persist storage adapter (StateStorage compatible) ────────────────

export const idbZustandStorage = {
  getItem: async (name: string): Promise<string | null> => {
    await runMigrationOnce();
    try {
      const value = await get<unknown>(name, appStore);
      if (value === undefined) return null;
      // Zustand expects a JSON string
      return JSON.stringify(value);
    } catch {
      return localStorage.getItem(name);
    }
  },

  setItem: async (name: string, value: string): Promise<void> => {
    try {
      // Store parsed object so IDB holds a proper object (not a JSON string)
      await set(name, JSON.parse(value), appStore);
    } catch {
      localStorage.setItem(name, value);
    }
  },

  removeItem: async (name: string): Promise<void> => {
    try {
      await del(name, appStore);
    } catch {
      localStorage.removeItem(name);
    }
  },
};
