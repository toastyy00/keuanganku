export interface IncomeSourcePreset {
  label: string;
  emoji: string;
}

export const DEFAULT_SOURCE_PRESETS: IncomeSourcePreset[] = [
  { label: 'Salary',     emoji: '🏢' },
  { label: 'Freelance',  emoji: '💼' },
  { label: 'Airdrop',    emoji: '🪂' },
  { label: 'Trading',    emoji: '📊' },
  { label: 'LP Reward',  emoji: '💧' },
  { label: 'LP DLMM',    emoji: '💧' },
  { label: 'Staking',    emoji: '🔒' },
  { label: 'Investment', emoji: '📈' },
  { label: 'Gift',       emoji: '🎁' },
];

export function getSourceEmoji(label: string): string {
  if (!label) return '✨';
  try {
    const customJson = localStorage.getItem('keuanganku_custom_source_emojis');
    if (customJson) {
      const customMap = JSON.parse(customJson);
      const key = label.trim().toLowerCase();
      if (customMap[key]) {
        return customMap[key];
      }
    }
  } catch (e) {
    console.error('Error reading custom source emojis', e);
  }

  return DEFAULT_SOURCE_PRESETS.find(
    (p) => p.label.toLowerCase() === label.trim().toLowerCase()
  )?.emoji ?? '✨';
}

export function saveSourceEmoji(label: string, emoji: string): void {
  if (!label) return;
  try {
    const customJson = localStorage.getItem('keuanganku_custom_source_emojis') || '{}';
    const customMap = JSON.parse(customJson);
    customMap[label.trim().toLowerCase()] = emoji;
    localStorage.setItem('keuanganku_custom_source_emojis', JSON.stringify(customMap));
    window.dispatchEvent(new Event('custom-source-emoji-changed'));
  } catch (e) {
    console.error('Error saving custom source emoji', e);
  }
}
