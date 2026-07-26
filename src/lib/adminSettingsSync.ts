import { getSupabaseClientAsync } from './supabase';
import { getActiveDataScope, GUEST_DATA_SCOPE } from './dataScope';

export type AiProvider = 'openrouter' | 'openai';

// ============================================================
//  ADMIN SETTINGS SYNC — Surgical module to sync AI API keys
//  across devices specifically for users with is_admin = true.
// ============================================================

interface AiSettingsPayload {
  aiProvider?: AiProvider;
  openaiKey?: string;
  openrouterKey?: string;
  openrouterModel?: string;
}

let isPulling = false;
let isPushing = false;

/**
 * Pulls AI API keys from Supabase `profiles` table if the current user is an admin.
 * Populates local settings store so the admin doesn't need to manually re-enter keys on new devices.
 */
export async function pullAdminSettings(): Promise<boolean> {
  const scope = getActiveDataScope();
  if (scope === GUEST_DATA_SCOPE || isPulling) return false;

  const supabase = await getSupabaseClientAsync();
  if (!supabase) return false;

  try {
    isPulling = true;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('is_admin, ai_settings')
      .eq('id', user.id)
      .maybeSingle();

    if (error || !profile || !profile.is_admin) return false;

    const serverAiSettings = (profile.ai_settings ?? {}) as AiSettingsPayload;

    // Dynamically import store to avoid circular module evaluation dependency
    const { useSettingsStore } = await import('../store/useSettingsStore');
    const store = useSettingsStore.getState();

    const hasServerKeys = Boolean(serverAiSettings.openaiKey || serverAiSettings.openrouterKey);
    const hasLocalKeys = Boolean(store.openaiKey || store.openrouterKey);

    // Case 1: Server has keys -> pull into local store
    if (hasServerKeys) {
      let updated = false;

      if (serverAiSettings.aiProvider && serverAiSettings.aiProvider !== store.aiProvider) {
        store.setAiProvider(serverAiSettings.aiProvider);
        updated = true;
      }
      if (typeof serverAiSettings.openaiKey === 'string' && serverAiSettings.openaiKey !== store.openaiKey) {
        store.setOpenaiKey(serverAiSettings.openaiKey);
        updated = true;
      }
      if (typeof serverAiSettings.openrouterKey === 'string' && serverAiSettings.openrouterKey !== store.openrouterKey) {
        store.setOpenrouterKey(serverAiSettings.openrouterKey);
        updated = true;
      }
      if (typeof serverAiSettings.openrouterModel === 'string' && serverAiSettings.openrouterModel !== store.openrouterModel) {
        store.setOpenrouterModel(serverAiSettings.openrouterModel);
        updated = true;
      }

      return updated;
    }

    // Case 2: Server has no keys, but local store HAS keys -> auto-push to seed server
    if (!hasServerKeys && hasLocalKeys) {
      isPulling = false; // Reset before push call
      await pushAdminSettings();
      return true;
    }

    return false;
  } catch (err) {
    console.error('[AdminSettingsSync] pull failed:', err);
    return false;
  } finally {
    isPulling = false;
  }
}

/**
 * Pushes local AI API keys to Supabase `profiles` table if the current user is an admin.
 */
export async function pushAdminSettings(): Promise<boolean> {
  const scope = getActiveDataScope();
  if (scope === GUEST_DATA_SCOPE || isPushing || isPulling) return false;

  const supabase = await getSupabaseClientAsync();
  if (!supabase) return false;

  try {
    isPushing = true;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    // Verify admin status
    const { data: profile, error: checkErr } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();

    if (checkErr || !profile || !profile.is_admin) return false;

    const { useSettingsStore } = await import('../store/useSettingsStore');
    const store = useSettingsStore.getState();
    const payload: AiSettingsPayload = {
      aiProvider: store.aiProvider,
      openaiKey: store.openaiKey,
      openrouterKey: store.openrouterKey,
      openrouterModel: store.openrouterModel,
    };

    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ ai_settings: payload })
      .eq('id', user.id);

    if (updateErr) throw updateErr;

    return true;
  } catch (err) {
    console.error('[AdminSettingsSync] push failed:', err);
    return false;
  } finally {
    isPushing = false;
  }
}
