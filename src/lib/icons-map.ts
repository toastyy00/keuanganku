import React from 'react';
import {
  IconBolt,
  IconShoppingBag,
  IconSoup,
  IconCar,
  IconPill,
  IconShirt,
  IconDeviceMobile,
  IconDeviceLaptop,
  IconHeart,
  IconGift,
  IconUsers,
  IconTag,
  IconBurger,
  IconPizza,
  IconShoppingCart,
  IconHome,
  IconDeviceGamepad,
  IconSparkles,
  IconDeviceTv,
  IconCurrencyBitcoin,
  IconSchool,
  IconBriefcase,
  IconBarbell,
  IconPlane,
  IconMusic,
  IconPaw,
  IconLeaf,
  IconBuilding,
  IconParachute,
  IconChartBar,
  IconDroplet,
  IconLock,
  IconTrendingUp,
  IconCash,
  IconCoins,
} from '@tabler/icons-react';

// Static registry mapping legacy unicode emojis to named components
const EMOJI_ICON_MAP: Record<string, React.ComponentType<any>> = {
  // Category Preset Emojis
  '⚡': IconBolt,
  '🛍️': IconShoppingBag,
  '🍜': IconSoup,
  '🚗': IconCar,
  '💊': IconPill,
  '👟': IconShirt,
  '📱': IconDeviceMobile,
  '💻': IconDeviceLaptop,
  '🤲': IconHeart,
  '🎁': IconGift,
  '👨‍👩‍👧': IconUsers,
  
  // Settings Picker Emojis
  '🍔': IconBurger,
  '🍕': IconPizza,
  '🛒': IconShoppingCart,
  '🏠': IconHome,
  '🎮': IconDeviceGamepad,
  '✨': IconSparkles,
  '📺': IconDeviceTv,
  '₿': IconCurrencyBitcoin,
  '🎓': IconSchool,
  '💼': IconBriefcase,
  '🏋️': IconBarbell,
  '✈️': IconPlane,
  '🎵': IconMusic,
  '🐾': IconPaw,
  '🌿': IconLeaf,

  // Income Preset Emojis
  '🏢': IconBuilding,
  '🪂': IconParachute,
  '📊': IconChartBar,
  '💧': IconDroplet,
  '🔒': IconLock,
  '📈': IconTrendingUp,
  '💵': IconCash,
};

// Static registry mapping string icon names directly to their component references
const TABLER_ICON_REGISTRY: Record<string, React.ComponentType<any>> = {
  IconBolt,
  IconShoppingBag,
  IconSoup,
  IconCar,
  IconPill,
  IconShirt,
  IconDeviceMobile,
  IconDeviceLaptop,
  IconHeart,
  IconGift,
  IconUsers,
  IconTag,
  IconBurger,
  IconPizza,
  IconShoppingCart,
  IconHome,
  IconDeviceGamepad,
  IconSparkles,
  IconDeviceTv,
  IconCurrencyBitcoin,
  IconSchool,
  IconBriefcase,
  IconBarbell,
  IconPlane,
  IconMusic,
  IconPaw,
  IconLeaf,
  IconBuilding,
  IconParachute,
  IconChartBar,
  IconDroplet,
  IconLock,
  IconTrendingUp,
  IconCash,
  IconCoins,
};

// Text label mapping for income sources
const INCOME_SOURCE_MAP: Record<string, React.ComponentType<any>> = {
  'gaji': IconBuilding,
  'salary': IconBuilding,
  'freelance': IconBriefcase,
  'trading': IconChartBar,
  'airdrop': IconParachute,
  'staking': IconLock,
  'lp reward': IconDroplet,
  'lp dlmm': IconDroplet,
  'investasi': IconTrendingUp,
  'hadiah': IconGift,
  'fiat cash': IconCash,
};

/**
 * Returns a Tabler Icon component based on an emoji character or a Tabler Icon name string.
 * Falls back to IconTag if no match is found.
 */
export function getTablerIconByEmoji(emojiOrName: string): React.ComponentType<any> {
  if (!emojiOrName) return IconTag;
  const clean = emojiOrName.trim();
  
  // 1. Direct match on legacy unicode emoji
  if (EMOJI_ICON_MAP[clean]) {
    return EMOJI_ICON_MAP[clean];
  }
  
  // 2. Direct match on Tabler Icon name string (e.g. "IconBolt")
  if (TABLER_ICON_REGISTRY[clean]) {
    return TABLER_ICON_REGISTRY[clean];
  }
  
  // Fallback
  return IconTag;
}

/**
 * Returns a Tabler Icon component based on an income source label.
 * Falls back to IconCoins if no match is found.
 */
export function getTablerIconBySource(sourceLabel: string): React.ComponentType<any> {
  if (!sourceLabel) return IconCoins;
  const key = sourceLabel.trim().toLowerCase();
  
  // 1. Match on text label
  if (INCOME_SOURCE_MAP[key]) {
    return INCOME_SOURCE_MAP[key];
  }
  
  // 2. Match on legacy unicode emoji if present in the label
  if (EMOJI_ICON_MAP[sourceLabel.trim()]) {
    return EMOJI_ICON_MAP[sourceLabel.trim()];
  }
  
  // Fallback
  return IconCoins;
}
