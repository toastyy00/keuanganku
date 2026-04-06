import { create } from 'zustand';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

// ============================================================
//  AUTH STORE — Supabase session management
//  No persist — session state is always loaded fresh from
//  Supabase on app start via loadSession().
// ============================================================

interface AuthState {
  user: User | null;
  session: Session | null;
  /** True while the initial session check is in-flight (prevents flash) */
  isInitializing: boolean;
  isLoading: boolean;
  error: string | null;
  /** True while a signUp is in progress — suppresses onAuthStateChange auto-login */
  isRegistering: boolean;

  // ── Actions ─────────────────────────────────────────────
  loadSession: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
  setRegistering: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  isInitializing: true,
  isLoading: false,
  error: null,
  isRegistering: false,

  // ── loadSession ──────────────────────────────────────────
  // Called once at app startup. Reads the existing session from
  // Supabase (persisted in localStorage by the Supabase SDK) and
  // subscribes to auth state changes for the lifetime of the app.
  loadSession: async () => {
    if (!supabase) {
      set({ isInitializing: false });
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      // -- CUSTOM ADMIN APPROVAL CHECK --
      // Jika email confirmation dimatikan, kita cek is_approved di metadata
      if (session?.user && session.user.user_metadata?.is_approved !== true) {
        await supabase.auth.signOut();
        set({ isInitializing: false });
        return;
      }

      set({
        session,
        user: session?.user ?? null,
        isInitializing: false,
      });
    } catch {
      set({ isInitializing: false });
    }

    // Subscribe to future auth state changes (login, logout, token refresh)
    supabase.auth.onAuthStateChange((_event, session) => {
      if (useAuthStore.getState().isRegistering) {
        return;
      }

      set({
        session,
        user: session?.user ?? null,
      });
    });
  },

  // ── login ────────────────────────────────────────────────
  login: async (email, password) => {
    if (!supabase) {
      set({ error: 'Supabase belum dikonfigurasi.' });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      
      if (error) {
        // Map Supabase error codes to Indonesian messages
        set({ error: mapAuthError(error.message) });
        return;
      }

      // -- CUSTOM ADMIN APPROVAL CHECK --
      if (data?.user && data.user.user_metadata?.is_approved !== true) {
        await supabase.auth.signOut(); // Batal masuk
        set({ error: 'Akun Anda sedang menunggu persetujuan admin.' });
        return;
      }

    } catch {
      set({ error: 'Terjadi kesalahan. Coba lagi.' });
    } finally {
      set({ isLoading: false });
    }
  },

  // ── register ─────────────────────────────────────────────
  register: async (email, password, displayName) => {
    if (!supabase) {
      set({ error: 'Supabase belum dikonfigurasi.' });
      return false;
    }

    set({ isLoading: true, error: null, isRegistering: true });
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // Tambahkan flag is_approved: false secara default
          data: { display_name: displayName, is_approved: false },
        },
      });
      
      if (error) {
        set({ error: mapAuthError(error.message) });
        return false;
      }

      // Jika Email Confirmation dimatikan di dashboard, user otomatis punya session.
      // Kita hapus session tersebut agar user tidak terdeteksi sudah login.
      if (data?.session) {
        await supabase.auth.signOut();
      }

      // On success: user is NOT logged in — they must wait for admin approval.
      return true;
    } catch {
      set({ error: 'Terjadi kesalahan. Coba lagi.' });
      return false;
    } finally {
      set({ isLoading: false });
      // Note: isRegistering is cleared by RegisterPage after the success screen
      // is shown, via setRegistering(false).
    }
  },

  // ── logout ───────────────────────────────────────────────
  logout: async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    set({ user: null, session: null });
  },

  // ── clearError ───────────────────────────────────────────
  clearError: () => set({ error: null }),

  // ── setRegistering ───────────────────────────────────────
  setRegistering: (value) => set({ isRegistering: value }),
}));

// ============================================================
//  AUTH ERROR MAPPER — Supabase → Indonesian
// ============================================================

function mapAuthError(message: string): string {
  const m = message.toLowerCase();

  if (m.includes('invalid login credentials') || m.includes('invalid credentials')) {
    return 'Email atau kata sandi salah.';
  }
  if (m.includes('email not confirmed')) {
    return 'Email belum dikonfirmasi. Tunggu persetujuan admin.';
  }
  if (m.includes('user already registered') || m.includes('already registered')) {
    return 'Email ini sudah terdaftar. Coba masuk.';
  }
  if (m.includes('password should be at least') || m.includes('password')) {
    return 'Kata sandi minimal 8 karakter.';
  }
  if (m.includes('unable to validate email address')) {
    return 'Format email tidak valid.';
  }
  if (m.includes('email rate limit exceeded') || m.includes('rate limit')) {
    return 'Terlalu banyak percobaan. Coba lagi nanti.';
  }
  if (m.includes('network') || m.includes('fetch')) {
    return 'Gagal terhubung ke server. Periksa koneksi internet.';
  }

  return message;
}
