import type { Category } from '../types';
import type { AiProvider } from '../store/useSettingsStore';

// ============================================================
//  AI CATEGORY SUGGESTION SERVICE
// ============================================================

interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  openrouterModel: string;
}

/**
 * Calls the configured AI provider to suggest a category slug
 * for the given expense name.
 *
 * Returns a category slug string, or null if unavailable/failed.
 */
export async function suggestCategory(
  itemName: string,
  categories: Category[],
  config: AiConfig
): Promise<string | null> {
  if (!config.apiKey || !itemName.trim()) return null;

  const categoryList = categories
    .map((c) => `${c.slug} (${c.label})`)
    .join(', ');

  const prompt = `You are a personal expense categorizer. Given an expense item name, return ONLY the most appropriate category slug from this list: ${categoryList}. Item: "${itemName}". Reply with just the slug, nothing else.`;

  try {
    if (config.provider === 'openai') {
      return await callOpenAI(prompt, config.apiKey);
    } else {
      return await callOpenRouter(prompt, config.apiKey, config.openrouterModel);
    }
  } catch {
    return null;
  }
}

async function callOpenAI(
  prompt: string,
  apiKey: string
): Promise<string | null> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 20,
      temperature: 0,
    }),
  });

  if (!res.ok) throw new Error(`OpenAI error ${res.status}`);
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content ?? '').trim().toLowerCase() || null;
}

async function callOpenRouter(
  prompt: string,
  apiKey: string,
  model: string
): Promise<string | null> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': window.location.origin,
      'X-Title': 'Keuanganku',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 20,
      temperature: 0,
    }),
  });

  if (!res.ok) throw new Error(`OpenRouter error ${res.status}`);
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content ?? '').trim().toLowerCase() || null;
}

/**
 * Tests the AI connection by sending a simple "hello" prompt.
 * Returns true if the provider responds without error.
 */
export async function testAiConnection(config: AiConfig): Promise<boolean> {
  if (!config.apiKey) return false;
  try {
    const prompt = 'Reply with exactly: ok';
    let result: string | null;
    if (config.provider === 'openai') {
      result = await callOpenAI(prompt, config.apiKey);
    } else {
      result = await callOpenRouter(prompt, config.apiKey, config.openrouterModel);
    }
    return result !== null;
  } catch {
    return false;
  }
}
