/**
 * Claude API plumbing for the self-hosted server.
 *
 * The API key lives in the `setting` table under `ai.apiKey` and NEVER leaves
 * the server: `/api/data` redacts it (see SENSITIVE_SETTING_KEYS in index.ts),
 * and every Claude request is made from here. The renderer only ever learns
 * whether a key is configured, not what it is.
 *
 * This is the shared foundation for the AI features on the roadmap — the chat
 * assistant, receipt scanning and the weekly digest all call `complete()` or
 * build on `client()` rather than talking to Anthropic directly.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { DataService } from './data-service';
import type { Setting } from '../src/shared/types';

export const API_KEY_SETTING = 'ai.apiKey';
export const MODEL_SETTING = 'ai.model';

/** Opus 4.8 — the most capable model; overridable in Settings. */
export const DEFAULT_MODEL = 'claude-opus-4-8';

/** Models offered in the Settings picker. */
export const AI_MODELS = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', hint: 'Most capable' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', hint: 'Faster, cheaper' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', hint: 'Fastest' },
] as const;

async function settings(service: DataService): Promise<Setting[]> {
  return (await service.handle('list', { entity: 'setting' })) as Setting[];
}

const valueOf = (rows: Setting[], key: string) => rows.find((s) => s.key === key)?.value ?? '';

export async function aiConfig(service: DataService) {
  const rows = await settings(service);
  const apiKey = valueOf(rows, API_KEY_SETTING);
  const model = valueOf(rows, MODEL_SETTING) || DEFAULT_MODEL;
  return { apiKey, model, configured: !!apiKey };
}

export async function aiConfigured(service: DataService): Promise<boolean> {
  return (await aiConfig(service)).configured;
}

/** An Anthropic client bound to the stored key. Throws when unconfigured. */
export async function client(service: DataService): Promise<{ anthropic: Anthropic; model: string }> {
  const { apiKey, model, configured } = await aiConfig(service);
  if (!configured) throw new Error('Claude is not connected — add an API key in Settings.');
  return { anthropic: new Anthropic({ apiKey }), model };
}

/** Anthropic's typed errors, turned into something worth showing a user. */
export function friendlyError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'That API key was rejected by Anthropic.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'That key lacks access to this model.';
  if (err instanceof Anthropic.NotFoundError) return 'That model does not exist or is unavailable to this key.';
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by Anthropic — try again shortly.';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API.';
  if (err instanceof Anthropic.APIError) return err.message;
  return err instanceof Error ? err.message : 'The Claude request failed.';
}

/** Concatenated text of a response, ignoring thinking and tool blocks. */
export function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

export interface CompleteOptions {
  system?: string;
  maxTokens?: number;
  /** Adaptive thinking is worth the latency on analysis; off for quick calls. */
  think?: boolean;
  model?: string;
}

/**
 * One-shot text completion. Streaming isn't used: every caller today asks for
 * a short, bounded answer, and `max_tokens` stays well under the level where
 * non-streaming requests risk an HTTP timeout.
 */
export async function complete(
  service: DataService,
  prompt: string,
  opts: CompleteOptions = {}
): Promise<string> {
  const { anthropic, model } = await client(service);
  const message = await anthropic.messages.create({
    model: opts.model ?? model,
    max_tokens: opts.maxTokens ?? 2048,
    ...(opts.system ? { system: opts.system } : {}),
    ...(opts.think ? { thinking: { type: 'adaptive' as const } } : {}),
    messages: [{ role: 'user', content: prompt }],
  });
  return textOf(message);
}

/* ------------------------------- endpoints -------------------------------- */

export async function aiStatus(service: DataService) {
  const { configured, model } = await aiConfig(service);
  return { configured, model, models: AI_MODELS };
}

/**
 * Verify a key with the cheapest possible real request, then store it. An
 * unverified key would fail later, somewhere less obvious.
 */
export async function aiConnect(service: DataService, apiKey: string, model?: string) {
  const key = apiKey.trim();
  if (!key) throw new Error('Paste your Anthropic API key first.');
  const chosen = model?.trim() || DEFAULT_MODEL;

  const anthropic = new Anthropic({ apiKey: key });
  await anthropic.messages.create({
    model: chosen,
    max_tokens: 16,
    messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
  });

  await service.handle('setSetting', { key: API_KEY_SETTING, value: key });
  await service.handle('setSetting', { key: MODEL_SETTING, value: chosen });
  return { configured: true, model: chosen };
}

export async function aiDisconnect(service: DataService) {
  await service.handle('setSetting', { key: API_KEY_SETTING, value: '' });
  return { configured: false };
}

/** Round-trips the stored key so the user can confirm it still works. */
export async function aiTest(service: DataService) {
  const reply = await complete(service, 'Reply with the single word: ok', { maxTokens: 16 });
  return { ok: true, reply };
}
