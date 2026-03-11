import { env, normalizePhone } from '../config/env';
import { logger } from '../utils/logger';
import type { ZApiWebhookPayload, ParsedWebhook } from '../bot/types';

const sendTextUrl = () =>
  `${env.ZAPI_BASE_URL}/instances/${env.ZAPI_INSTANCE_ID}/token/${env.ZAPI_TOKEN}/send-text`;

export async function sendText(phone: string, message: string): Promise<void> {
  const normalized = normalizePhone(phone);
  const url = sendTextUrl();
  const body = { phone: normalized, message };

  console.log('normalized', normalized);
  console.log('sendText', url, body);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'client-Token': env.ZAPI_CLIENT_TOKEN,
      },
      body: JSON.stringify(body),
    });

    console.log('res', res);

    if (!res.ok) {
      const text = await res.text();
      logger.error('Z-API sendText failed', res.status, text);
      throw new Error(`Z-API sendText: ${res.status} ${text}`);
    }

    const data = (await res.json()) as { zaapId?: string; messageId?: string };
    console.log('data', data);
    logger.info('Message sent', { phone: normalized, zaapId: data.zaapId });
  } catch (e) {
    logger.error('sendText error', e);
    throw e;
  }
}

export function parseWebhook(body: unknown): ParsedWebhook | null {
  const b = body as ZApiWebhookPayload | undefined;
  if (!b || typeof b !== 'object') return null;

  const phone = b.phone;
  if (!phone || typeof phone !== 'string') return null;

  const text =
    (typeof b.text === 'object' && b.text !== null && typeof (b.text as { message?: string }).message === 'string'
      ? (b.text as { message: string }).message
      : typeof b.message === 'string'
        ? b.message
        : '') ?? '';

  const fromMe = Boolean(b.fromMe);

  return {
    phone: normalizePhone(phone),
    text: text.trim(),
    fromMe,
  };
}
