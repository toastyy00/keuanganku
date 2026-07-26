import type { Category, ReceiptAIResponse } from '../types';
import type { AiProvider } from '../store/useSettingsStore';

// ============================================================
//  AI RECEIPT SCANNING SERVICE
//
//  Sends a receipt/invoice image to the configured AI provider
//  (OpenRouter or OpenAI-compatible API) using vision capabilities.
//  Returns structured JSON with extracted line items.
//
//  Image compression happens client-side to keep payloads small
//  (~10MB camera photo → ~400KB compressed JPEG).
// ============================================================

export interface ReceiptAiConfig {
  provider: AiProvider;
  apiKey: string;
  openrouterModel: string;
}

// ── Image Compression ─────────────────────────────────────────

const MAX_IMAGE_DIMENSION = 1500;
const JPEG_QUALITY = 0.8;

/**
 * Compresses an image file by resizing and re-encoding as JPEG.
 * Returns a base64 data URL string ready for the vision API.
 */
export async function compressImageToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;

      // Scale down to fit within MAX_IMAGE_DIMENSION
      if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
        const scale = MAX_IMAGE_DIMENSION / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Gagal membuat canvas untuk kompresi gambar.'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      // Convert to JPEG base64
      const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      resolve(dataUrl);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Gagal memuat gambar. Pastikan file adalah gambar yang valid.'));
    };

    img.src = objectUrl;
  });
}

// ── Prompt Construction ───────────────────────────────────────

function buildReceiptPrompt(categories: Category[]): string {
  const today = new Date().toISOString().slice(0, 10);
  const categoryList = categories
    .map((c) => `${c.slug} (${c.label} ${c.emoji})`)
    .join(', ');

  return `You are a Senior Financial Accountant who specialises in reading every kind of receipt, invoice, and order summary — from thermal minimarket rolls to food-delivery app screenshots.

TASK
Extract ONLY the purchased products/menu items from this image into JSON.

─────────────────────────────────────────────
RULE 1 — WHAT TO EXTRACT (items array)
─────────────────────────────────────────────
• Include ONLY real products or menu items the user bought.
• DO NOT include any of these as separate line items:
  – Service fees, handling fees (Biaya Penanganan)
  – Delivery fees (Ongkir, Biaya Pengiriman)
  – Platform fees, packaging fees, tax lines
  – Discounts, vouchers, promo lines
  – Payment method lines, change lines
  These are already factored into the "total" field.

─────────────────────────────────────────────
RULE 2 — ITEM NAMING (name field)
─────────────────────────────────────────────
PRINCIPLE: The name should contain ONLY the words needed to identify
this specific product on a shelf. Strip ANY word that merely describes
the product's general category, type, or form if the brand or variant
already makes the product identifiable.

Target: 2–4 words max. Structure: [Brand] [Variant] [Size/Pack]

ASK YOURSELF: "If I remove this word, can a human still identify the product?"
If YES → strip it.  If NO → keep it.

Examples across categories:
  "Yakult Minuman Fermentasi Light Less Sugar 5x65ml" → "Yakult Light (Isi 5)"
  "Le Minerale Air Mineral 600ml" → "Le Minerale 600ml"
  "Tango Wafer Long Vanilla Milk 100g" → "Tango Vanilla 100g"
  "Japota Potato Chips Nipis Pedas 65g" → "Japota Nipis Pedas 65g"
  "Sari Roti Roti Tawar Kupas Jumbo" → "Sari Roti Kupas Jumbo"
  "Sedaap Mie Mie Instant Ayam Bawang 5X71G" → "Mie Sedaap Ayam Bawang (Isi 5)"
  "Kapal Api Kopi Bubuk Special 165g" → "Kapal Api Special 165g"
  "Lifebuoy Sabun Mandi Total 10 100g" → "Lifebuoy Total 10 100g"
  "Chitato Keripik Kentang Sapi Panggang 68g" → "Chitato Sapi Panggang 68g"
  "Indomie Mie Goreng Rendang 91g" → "Indomie Goreng Rendang"
  "SunLight Sabun Cuci Piring Jeruk Nipis 755ml" → "SunLight Jeruk Nipis 755ml"
  "Pepsodent Pasta Gigi Action 123 190g" → "Pepsodent Action 123 190g"
  "Paseo Tisu Wajah Soft Pack 250s" → "Paseo Soft Pack 250s"
  "Rinso Deterjen Bubuk Anti Noda 770g" → "Rinso Anti Noda 770g"
  "ABC Kecap Manis 600ml" → "ABC Kecap Manis 600ml"
  "Regal Marie Biskuit 120g" → "Regal Marie 120g"
  "Ultra Milk Susu UHT Full Cream 1L" → "Ultra Milk Full Cream 1L"
  Multipack: convert "5X71GR" or "5x65ml" → "(Isi 5)"
• For restaurant/food items, keep the full menu name as-is.
• If receipt text is truncated or abbreviated, infer the full product name.

─────────────────────────────────────────────
RULE 3 — PRICES & MATH (unit_price, total_price)
─────────────────────────────────────────────
• total_price = quantity × unit_price.  ALWAYS.
• Reading "Q pcs x Rp P" or "Q x P":
  P is the UNIT price.  total_price = Q × P.
  Example: "2 pcs x Rp22.400" → unit_price=22400, total_price=44800.
  NEVER divide P by Q. NEVER set total_price = P when Q > 1.
• If individual item prices are not listed (common in food-delivery apps),
  try to infer from the subtotal. If impossible, split the product subtotal
  equally among items and set each item's total_price accordingly.
• The "total" field must be the FINAL AMOUNT PAID by the user
  (after discounts, fees, tax — the actual money out of pocket).
• IMPORTANT: The sum of total_price across items should match the "total" (grand total paid).
  If there are net delivery fees, service fees, or promo discounts (e.g. GoFood, ShopeeFood, GrabFood),
  distribute net fees/discounts proportionally across item prices so total matches the user's actual money spent.

─────────────────────────────────────────────
RULE 4 — CLASSIFICATION
─────────────────────────────────────────────
• currency: "IDR" or "USD" (default IDR)
• suggested_category: pick from ${categoryList}
• suggested_expense_type: "NEED" or "WANT"
  – NEED = staples, water, toiletries, medicine, basic groceries
  – WANT = snacks, fast food, delivery food, drinks, entertainment
• suggested_unit: "item"

─────────────────────────────────────────────
RULE 5 — METADATA
─────────────────────────────────────────────
• store_name: the merchant or restaurant name.
  For delivery apps (GoFood, GrabFood, ShopeeFood), use the RESTAURANT name, not "GoFood".
• date: YYYY-MM-DD from receipt. Default ${today}.
• suggested_type: "expense" (unless it is clearly an income/refund).
• If the image is NOT a receipt or invoice → store_name: "Bukan struk/nota", items: [].

Return ONLY valid JSON (no markdown, no explanation):
{
  "store_name": "string",
  "date": "YYYY-MM-DD",
  "currency": "IDR" | "USD",
  "suggested_type": "expense" | "income",
  "total": number,
  "items": [
    {
      "name": "string",
      "quantity": number,
      "unit_price": number,
      "total_price": number,
      "suggested_category": "string",
      "suggested_expense_type": "NEED" | "WANT",
      "suggested_unit": "item"
    }
  ]
}`;
}

// ── AI Vision API Calls ───────────────────────────────────────

async function callVisionOpenAI(
  imageBase64: string,
  prompt: string,
  apiKey: string,
): Promise<string | null> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: imageBase64, detail: 'high' },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
      max_tokens: 2000,
      temperature: 0,
    }),
  });

  if (!res.ok) throw new Error(await buildProviderError('OpenAI', res));
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content ?? '').trim() || null;
}

async function callVisionOpenRouter(
  imageBase64: string,
  prompt: string,
  apiKey: string,
  model: string,
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
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: imageBase64, detail: 'high' },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
      max_tokens: 2000,
      temperature: 0,
    }),
  });

  if (!res.ok) throw new Error(await buildProviderError('OpenRouter', res));
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content ?? '').trim() || null;
}

// ── Error Handling ────────────────────────────────────────────

async function buildProviderError(provider: string, response: Response): Promise<string> {
  const fallback = `${provider} error ${response.status}`;
  try {
    const data = await response.json();
    const message =
      data?.error?.message ||
      data?.message ||
      data?.detail ||
      fallback;

    // Detect vision-not-supported errors
    if (
      response.status === 400 &&
      (typeof message === 'string') &&
      (message.toLowerCase().includes('vision') ||
       message.toLowerCase().includes('image') ||
       message.toLowerCase().includes('multimodal'))
    ) {
      return `Model tidak support gambar (vision). Ganti ke model yang support vision di Settings (contoh: GPT-4o, Gemini, Claude).`;
    }

    return `${fallback}: ${message}`;
  } catch {
    return fallback;
  }
}

// ── Response Parsing ──────────────────────────────────────────

function parseJsonFromResponse(raw: string | null): unknown {
  if (!raw) {
    throw new Error('AI tidak mengembalikan respons.');
  }

  // Try direct parse first
  try {
    return JSON.parse(raw);
  } catch {
    // Try extracting JSON from markdown code blocks or mixed text
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

function normalizeReceiptResponse(value: unknown): ReceiptAIResponse {
  const obj = value as Record<string, unknown>;
  const today = new Date().toISOString().slice(0, 10);

  const itemsRaw = Array.isArray(obj?.items) ? obj.items : [];

  const items = itemsRaw.map((item: Record<string, unknown>) => {
    const rawName = typeof item?.name === 'string' ? item.name.trim() : 'Item';
    const quantity = typeof item?.quantity === 'number' && item.quantity > 0 ? item.quantity : 1;
    let unit_price = typeof item?.unit_price === 'number' ? item.unit_price : 0;
    let total_price = typeof item?.total_price === 'number' ? item.total_price : 0;

    // MATH SAFEGUARD & AUTO-CORRECTION:
    // If quantity > 1 and total_price === unit_price (or total_price < quantity * unit_price),
    // AI mistakenly assigned single unit price to line total_price! Fix: total_price = quantity * unit_price.
    if (quantity > 1 && unit_price > 0 && (total_price === unit_price || total_price < unit_price * quantity)) {
      total_price = quantity * unit_price;
    } else if (quantity > 1 && total_price > 0 && (unit_price === 0 || total_price !== quantity * unit_price)) {
      unit_price = Math.round(total_price / quantity);
    } else if (unit_price > 0 && total_price === 0) {
      total_price = quantity * unit_price;
    }

    return {
      name: rawName,
      quantity,
      unit_price,
      total_price,
      suggested_category: typeof item?.suggested_category === 'string'
        ? item.suggested_category.trim()
        : 'keperluan',
      suggested_expense_type:
        item?.suggested_expense_type === 'WANT' ? ('WANT' as const) : ('NEED' as const),
      suggested_unit: typeof item?.suggested_unit === 'string' ? item.suggested_unit : 'item',
    };
  });

  const grandTotalFromAI = typeof obj?.total === 'number' && obj.total > 0 ? obj.total : 0;
  let calculatedTotal = items.reduce((sum, item) => sum + item.total_price, 0);

  // GRAND TOTAL DISCREPANCY RECONCILER & NET FEE/DISCOUNT BALANCER:
  // If grandTotalFromAI > 0 and differs from calculatedTotal (e.g. GoFood delivery fees / discounts),
  // distribute the net difference proportionally across items so that sum(total_price) == grandTotalFromAI.
  if (grandTotalFromAI > 0 && calculatedTotal > 0 && Math.abs(grandTotalFromAI - calculatedTotal) > 0 && items.length > 0) {
    const factor = grandTotalFromAI / calculatedTotal;
    let accumulatedNewTotal = 0;

    items.forEach((item, i) => {
      if (i === items.length - 1) {
        item.total_price = grandTotalFromAI - accumulatedNewTotal;
      } else {
        item.total_price = Math.round(item.total_price * factor);
        accumulatedNewTotal += item.total_price;
      }
      item.unit_price = Math.max(1, Math.round(item.total_price / item.quantity));
    });
    calculatedTotal = grandTotalFromAI;
  }

  const total = grandTotalFromAI > 0 ? grandTotalFromAI : calculatedTotal;

  return {
    store_name: typeof obj?.store_name === 'string' && obj.store_name.trim()
      ? obj.store_name.trim()
      : 'Tidak diketahui',
    date: typeof obj?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.date)
      ? obj.date
      : today,
    currency: obj?.currency === 'USD' ? 'USD' : 'IDR',
    suggested_type: obj?.suggested_type === 'income' ? 'income' : 'expense',
    total,
    items,
  };
}

// ── Main Entry Point ──────────────────────────────────────────

/**
 * Scans a receipt/invoice image using the configured AI provider.
 *
 * 1. Compresses the image client-side (~10MB → ~400KB)
 * 2. Sends to AI provider with a structured extraction prompt
 * 3. Parses and normalizes the response
 *
 * @param imageFile - The receipt image file from the user
 * @param categories - User's category list for accurate mapping
 * @param config - AI provider configuration (from useSettingsStore)
 * @returns Structured receipt data with line items
 */
export async function scanReceipt(
  imageFile: File,
  categories: Category[],
  config: ReceiptAiConfig,
): Promise<ReceiptAIResponse> {
  if (!config.apiKey) {
    throw new Error('API key AI belum diatur di Settings.');
  }

  // Step 1: Compress image
  const imageBase64 = await compressImageToBase64(imageFile);

  // Step 2: Build extraction prompt with user's categories
  const prompt = buildReceiptPrompt(categories);

  // Step 3: Call AI provider with vision
  let raw: string | null;

  if (config.provider === 'openai') {
    raw = await callVisionOpenAI(imageBase64, prompt, config.apiKey);
  } else {
    raw = await callVisionOpenRouter(
      imageBase64,
      prompt,
      config.apiKey,
      config.openrouterModel,
    );
  }

  // Step 4: Parse and normalize
  const parsed = parseJsonFromResponse(raw);
  const result = normalizeReceiptResponse(parsed);

  const isInvalidStore =
    result.store_name === 'Bukan struk/nota' ||
    result.store_name.toLowerCase().includes('bukan struk') ||
    result.store_name.toLowerCase().includes('not a receipt') ||
    result.store_name.toLowerCase().includes('bukan nota');

  if (isInvalidStore || result.items.length === 0) {
    throw new Error('Gambar yang diunggah bukan struk atau nota pembayaran yang valid.');
  }

  return result;
}
