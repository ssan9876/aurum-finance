/**
 * Receipt scanning: a photo of a receipt in, transaction fields out.
 *
 * Uses Claude's vision input plus structured outputs, so the model is
 * constrained to a JSON schema rather than asked politely for JSON — no
 * markdown fences to strip, no half-parsed replies.
 *
 * The renderer already stores receipts as data URLs on `Transaction.receiptImage`,
 * so the same string it would save is what gets scanned here. Nothing is
 * persisted by this module: it returns a draft for the user to confirm in the
 * transaction dialog.
 */
import { client } from './ai';
import type { DataService } from './data-service';

/** Matches the renderer's own 2 MB receipt cap (TransactionDialog). */
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export interface ReceiptLineItem {
  name: string;
  amount: number;
}

export interface ReceiptDraft {
  merchant: string;
  /** Grand total, positive. 0 when it couldn't be read. */
  amount: number;
  /** yyyy-MM-dd, or '' when the receipt doesn't show one. */
  date: string;
  description: string;
  lineItems: ReceiptLineItem[];
}

const SCHEMA = {
  type: 'object',
  properties: {
    merchant: { type: 'string', description: 'Store or vendor name, cleanly capitalized.' },
    amount: { type: 'number', description: 'Grand total actually paid, positive. 0 if unreadable.' },
    date: { type: 'string', description: 'Purchase date as yyyy-MM-dd, or "" if not shown.' },
    description: { type: 'string', description: 'Short summary of what was bought, or "".' },
    lineItems: {
      type: 'array',
      description: 'Individual purchased items, if legible. May be empty.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          amount: { type: 'number' },
        },
        required: ['name', 'amount'],
        additionalProperties: false,
      },
    },
  },
  required: ['merchant', 'amount', 'date', 'description', 'lineItems'],
  additionalProperties: false,
} as const;

const SYSTEM = `You read receipts. Extract only what is actually printed on the image.

- amount is the FINAL total paid, after tax and any discount — not the subtotal.
- Use the receipt's own date. If no date is printed, return "" rather than today's.
- If the image is not a receipt, or is too blurry to read, return merchant "" and amount 0.
- Never invent a merchant, total or line item you cannot see.`;

/** Split a `data:image/png;base64,…` URL into its parts, with validation. */
function parseDataUrl(dataUrl: string): { mediaType: string; data: string } {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) throw new Error('That does not look like an image.');
  const mediaType = match[1].toLowerCase();
  if (!ALLOWED.has(mediaType)) throw new Error('Receipts must be a PNG, JPEG, GIF or WebP image.');
  const data = match[2];
  // base64 encodes 3 bytes per 4 chars.
  if (Math.floor((data.length * 3) / 4) > MAX_BYTES) {
    throw new Error('Receipt images must be under 2 MB.');
  }
  return { mediaType, data };
}

export async function scanReceipt(service: DataService, imageDataUrl: string): Promise<ReceiptDraft> {
  const { mediaType, data } = parseDataUrl(String(imageDataUrl ?? ''));
  const { anthropic, model } = await client(service);

  const response = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    system: SYSTEM,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType as any, data } },
          { type: 'text', text: 'Extract this receipt.' },
        ],
      },
    ],
  } as any);

  if (response.stop_reason === 'refusal') throw new Error('Claude declined to read that image.');

  const text = response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');

  let draft: ReceiptDraft;
  try {
    draft = JSON.parse(text);
  } catch {
    throw new Error('Could not read that receipt — try a sharper photo.');
  }

  const amount = Number(draft.amount) || 0;
  const merchant = String(draft.merchant ?? '').trim();
  if (!merchant && amount <= 0) throw new Error("That doesn't look like a readable receipt.");

  return {
    merchant,
    amount: Math.abs(Math.round(amount * 100) / 100),
    // Keep only a plausible calendar date; the dialog fills today otherwise.
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(draft.date ?? '')) ? draft.date : '',
    description: String(draft.description ?? '').trim(),
    lineItems: Array.isArray(draft.lineItems)
      ? draft.lineItems
          .filter((i) => i && typeof i.name === 'string')
          .map((i) => ({ name: i.name.trim(), amount: Math.abs(Number(i.amount) || 0) }))
      : [],
  };
}
