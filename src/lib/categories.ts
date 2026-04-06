import type { Category } from '../types';

// ============================================================
//  DEFAULT CATEGORIES — 11 Indonesian preset categories
//  is_default: false → user can freely delete any of them
// ============================================================

export const DEFAULT_CATEGORIES: Category[] = [
  {
    slug: 'tagihan',
    label: 'Tagihan',
    emoji: '⚡',
    is_default: false, // user can delete freely
  },
  {
    slug: 'dapur',
    label: 'Belanja',
    emoji: '🛒',
    is_default: false,
  },
  {
    slug: 'makan',
    label: 'Makan',
    emoji: '🍜',
    is_default: false,
  },
  {
    slug: 'transport',
    label: 'Transportasi',
    emoji: '🚗',
    is_default: false,
  },
  {
    slug: 'health',
    label: 'Kesehatan',
    emoji: '💊',
    is_default: false,
  },
  {
    slug: 'fashion',
    label: 'Fashion',
    emoji: '👕',
    is_default: false,
  },
  {
    slug: 'gadget',
    label: 'Gadget',
    emoji: '📱',
    is_default: false,
  },
  {
    slug: 'digital',
    label: 'Digital',
    emoji: '🎮',
    is_default: false,
  },
  {
    slug: 'donasi',
    label: 'Donasi',
    emoji: '🤲',
    is_default: false,
  },
  {
    slug: 'hadiah',
    label: 'Hadiah',
    emoji: '🎁',
    is_default: false,
  },
  {
    slug: 'keluarga',
    label: 'Keluarga',
    emoji: '👨‍👩‍👧',
    is_default: false,
  },
];

/**
 * Look up a category by slug.
 * Returns undefined if not found.
 */
export function getCategoryBySlug(
  categories: Category[],
  slug: string
): Category | undefined {
  return categories.find((c) => c.slug === slug);
}
