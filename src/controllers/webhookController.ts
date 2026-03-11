import { Request, Response } from 'express';
import { parseWebhook } from '../services/WhatsAppService';
import { handleIncomingMessage } from '../services/BotService';
import { logger } from '../utils/logger';

export async function zapiWebhook(req: Request, res: Response): Promise<void> {
  res.status(200).send();
  const parsed = parseWebhook(req.body);
  if (!parsed) {
    logger.warn('Webhook body invalid or missing phone', req.body);
    return;
  }
  if (parsed.fromMe) {
    logger.info('Ignoring message fromMe', parsed.phone);
    return;
  }
  try {
    await handleIncomingMessage(parsed.phone, parsed.text);
  } catch (e) {
    logger.error('handleIncomingMessage error', e);
  }
}
