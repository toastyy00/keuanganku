import { useAuthStore } from '../store/useAuthStore';

export const GUEST_DATA_SCOPE = '__guest__';

export function getActiveDataScope(): string {
  return useAuthStore.getState().user?.id ?? GUEST_DATA_SCOPE;
}

export function scopedDataKey(baseKey: string, scope: string = getActiveDataScope()): string {
  return `${baseKey}::${scope}`;
}

