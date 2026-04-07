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

export interface ExpenseInsightContext {
  monthLabel: string;
  currency: 'IDR' | 'USD';
  filterLabel?: string;
  totals: {
    spending: number;
    transfers: number;
    transactionCount: number;
    needs: number;
    wants: number;
    needsPct: number;
    wantsPct: number;
  };
  familySupport?: {
    total: number;
    personalTotal: number;
    personalNeedsTotal: number;
    personalWantsTotal: number;
    familySupportBudget?: number;
    personalBudget?: number;
  };
  previousMonth?: {
    monthLabel: string;
    spending: number;
    delta: number;
    deltaPct: number | null;
  };
  topCategories: Array<{
    slug: string;
    label: string;
    amount: number;
    pct: number;
  }>;
  recurringExpenses: Array<{
    name: string;
    amount: number;
    type: 'NEED' | 'WANT' | 'TRANSFER';
    category: string;
  }>;
  recentTransactions: Array<{
    date: string;
    name: string;
    amount: number;
    type: 'NEED' | 'WANT' | 'TRANSFER';
    category: string;
    note?: string;
  }>;
  transactions?: Array<{
    date: string;
    name: string;
    amount: number;
    currency: 'IDR' | 'USD';
    type: 'NEED' | 'WANT' | 'TRANSFER';
    category: string;
    destination?: string;
    note?: string;
  }>;
}

export type ExpenseInsightIntent =
  | 'summary'
  | 'transaction_insights'
  | 'deep_analysis';

export interface ExpenseInsightRequest {
  intent: ExpenseInsightIntent;
  context: ExpenseInsightContext;
}

export interface ExpenseInsightResponse {
  title: string;
  summary: string;
  highlights: string[];
  actions: string[];
  follow_up_suggestions: string[];
}

const EXPENSE_INSIGHT_SYSTEM_PROMPT = `You are a smart personal finance assistant embedded in an Indonesian expense tracker app called Keuanganku.

Your core role:
- Deliver sharp, concrete spending insights based solely on the provided data.
- Call out specific transaction names (e.g. "Le Minerale", "Steam Games", "Ortu"), category patterns, and recurring behaviors.
- Always separate family/parental support (kategori keluarga, ortu, orang tua, bapak, ibu, mama, papa) from personal spending — never lump them together as personal overspending.
- TRANSFER transactions (USDT, PINTU, crypto, tarik, withdraw) are liquidity movements, NOT direct consumption. Treat them accordingly.
- If personal or family budgets are provided, reference them concretely: state whether the user is over/under budget and by how much.
- If data is thin (< 3 transactions), acknowledge it briefly and provide what insight you can.
- Multi-currency context: amounts may be in IDR or USD. Do NOT convert — just reference amounts as given.

Hard rules:
- Never invent transactions, categories, amounts, or trends not in the data.
- No legal, tax, investment, debt, or medical advice.
- Do not act as a formal financial advisor.
- Do not repeat the same point across title, summary, highlights, and actions.

Response style:
- Use natural, conversational Bahasa Indonesia — like a savvy friend reviewing your spending, not a corporate audit.
- Be direct and scan-friendly for mobile. Short sentences. No fluff.
- Mention specific names, amounts, and categories when they make the insight more useful.
- Action items must be practical and grounded in the actual data — not generic advice.
- Avoid motivational filler ("kamu pasti bisa!", "tetap semangat!") and vague phrases ("kelola keuangan dengan bijak").

Return ONLY valid JSON with this exact schema:
{
  "title": "string (concise, descriptive — max 8 words)",
  "summary": "string (2-4 sentences, the most important pattern this month)",
  "highlights": ["string (3-5 specific callouts — use names, numbers, categories)"],
  "actions": ["string (2-4 actionable, data-grounded recommendations)"],
  "follow_up_suggestions": ["string (1-2 questions user might want to explore next)"]
}`;

const QUICK_PROMPT_BY_INTENT: Record<ExpenseInsightIntent, string> = {
  summary:
    'Give a concise spending summary for this month in natural Bahasa Indonesia. Cover: total spending, top 1-2 categories with names and amounts, needs vs wants ratio, any notable pattern. Reference specific transaction names where helpful. Keep it to 2-4 sentences in the summary field.',
  transaction_insights:
    'Analyze the transaction list in natural Bahasa Indonesia. Surface: the single largest expense and why it matters, any repeated transaction names (and how often), top 2 categories, notable transfer activity. Use exact transaction names, notes, and destinations from the data. Make the highlights feel like discoveries, not dashboard echoes.',
  deep_analysis:
    'Perform a thorough, specific analysis of this month\'s full transaction list in natural Bahasa Indonesia. Go beyond surface numbers — look for: (1) any single transaction or category that dominates and why that matters, (2) repeated spending habits by name (e.g. "Le Minerale muncul 4x"), (3) whether TRANSFER activity represents liquidity movement vs real spending, (4) the realistic split between family/parental responsibility and personal spending, (5) one-off large expenses vs recurring costs, (6) whether the user is above or below budget (if provided) and which specific category is the main driver. For actions, suggest only changes that are grounded in the actual data — avoid generic advice. Reference specific transaction names and amounts wherever useful.',
};

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
      return (await callOpenAI(prompt, config.apiKey))?.toLowerCase() ?? null;
    } else {
      return (await callOpenRouter(prompt, config.apiKey, config.openrouterModel))?.toLowerCase() ?? null;
    }
  } catch {
    return null;
  }
}

export async function generateExpenseInsight(
  request: ExpenseInsightRequest,
  config: AiConfig
): Promise<ExpenseInsightResponse> {
  if (!config.apiKey) {
    throw new Error('API key AI belum diatur di Settings.');
  }

  const prompt = `User intent: ${request.intent}

Instruction:
${QUICK_PROMPT_BY_INTENT[request.intent]}

Selected month data:
${JSON.stringify(request.context, null, 2)}

Return JSON only.`;

  const raw =
    config.provider === 'openai'
      ? await callOpenAI(prompt, config.apiKey, EXPENSE_INSIGHT_SYSTEM_PROMPT, 1200)
      : await callOpenRouter(
        prompt,
        config.apiKey,
        config.openrouterModel,
        EXPENSE_INSIGHT_SYSTEM_PROMPT,
        1200
      );

  const parsed = parseJsonObject(raw);
  return normalizeInsightResponse(parsed);
}

async function callOpenAI(
  prompt: string,
  apiKey: string,
  systemPrompt?: string,
  maxTokens = 20
): Promise<string | null> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: prompt },
      ],
      max_tokens: maxTokens,
      temperature: 0,
    }),
  });

  if (!res.ok) throw new Error(await buildProviderError('OpenAI', res));
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content ?? '').trim() || null;
}

async function callOpenRouter(
  prompt: string,
  apiKey: string,
  model: string,
  systemPrompt?: string,
  maxTokens = 20
): Promise<string | null> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model.trim(),
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: prompt },
      ],
      max_tokens: maxTokens,
      temperature: 0,
    }),
  });

  if (!res.ok) throw new Error(await buildProviderError('OpenRouter', res));
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content ?? '').trim() || null;
}

/**
 * Tests the AI connection by sending a simple "hello" prompt.
 * Returns true if the provider responds without error.
 */
export async function testAiConnection(config: AiConfig): Promise<boolean> {
  if (!config.apiKey) return false;
  try {
    if (config.provider === 'openai') {
      const result = await callOpenAI('Reply with exactly: ok', config.apiKey);
      return (result ?? '').trim().toLowerCase().includes('ok');
    } else {
      const result = await callOpenRouter('Reply with exactly: ok', config.apiKey, config.openrouterModel);
      return (result ?? '').trim().toLowerCase().includes('ok');
    }
  } catch {
    return false;
  }
}

export async function testAiConnectionDetailed(config: AiConfig): Promise<{ ok: boolean; message: string }> {
  if (!config.apiKey) {
    return { ok: false, message: 'API key belum diisi.' };
  }

  try {
    if (config.provider === 'openai') {
      const result = await callOpenAI('Reply with exactly: ok', config.apiKey);
      return (result ?? '').trim().toLowerCase().includes('ok')
        ? { ok: true, message: 'Koneksi OpenAI berhasil.' }
        : { ok: false, message: 'OpenAI merespons, tapi hasil test tidak sesuai.' };
    }

    const result = await callOpenRouter('Reply with exactly: ok', config.apiKey, config.openrouterModel);
    return (result ?? '').trim().toLowerCase().includes('ok')
      ? { ok: true, message: 'Koneksi OpenRouter berhasil.' }
      : { ok: false, message: 'OpenRouter merespons, tapi hasil test tidak sesuai.' };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Gagal menghubungkan AI provider.';
    const friendlyMessage = rawMessage === 'Failed to fetch' && config.provider === 'openrouter'
      ? 'OpenRouter gagal dijangkau dari browser. Ini biasanya terkait CORS, jaringan, atau endpoint yang diblokir.'
      : rawMessage;
    return {
      ok: false,
      message: friendlyMessage,
    };
  }
}

async function buildProviderError(provider: string, response: Response): Promise<string> {
  const fallback = `${provider} error ${response.status}`;
  try {
    const data = await response.json();
    const message =
      data?.error?.message ||
      data?.message ||
      data?.detail ||
      fallback;
    return `${fallback}: ${message}`;
  } catch {
    return fallback;
  }
}

function parseJsonObject(raw: string | null): unknown {
  if (!raw) {
    throw new Error('AI tidak mengembalikan respons.');
  }

  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error('Respons AI bukan JSON yang valid.');
    }
    try {
      return JSON.parse(match[0]);
    } catch {
      throw new Error('Respons AI tidak bisa diproses.');
    }
  }
}

function normalizeInsightResponse(value: unknown): ExpenseInsightResponse {
  const obj = value as Record<string, unknown>;

  return {
    title: typeof obj?.title === 'string' && obj.title.trim()
      ? obj.title.trim()
      : 'Ringkasan pengeluaran',
    summary: typeof obj?.summary === 'string' && obj.summary.trim()
      ? obj.summary.trim()
      : 'Belum ada ringkasan yang bisa ditampilkan untuk periode ini.',
    highlights: normalizeStringList(obj?.highlights, 3),
    actions: normalizeStringList(obj?.actions, 3),
    follow_up_suggestions: normalizeStringList(obj?.follow_up_suggestions, 3),
  };
}

function normalizeStringList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}
