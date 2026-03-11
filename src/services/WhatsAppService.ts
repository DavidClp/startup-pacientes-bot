import { env, normalizePhone } from '../config/env';
import { logger } from '../utils/logger';
import type { ZApiWebhookPayload, ParsedWebhook } from '../bot/types';

const sendTextUrl = () =>
  `${env.ZAPI_BASE_URL}/instances/${env.ZAPI_INSTANCE_ID}/token/${env.ZAPI_TOKEN}/send-text`;

const sendButtonsUrl = () =>
  `${env.ZAPI_BASE_URL}/instances/${env.ZAPI_INSTANCE_ID}/token/${env.ZAPI_TOKEN}/send-button-actions`;

const sendListUrl = () =>
  `${env.ZAPI_BASE_URL}/instances/${env.ZAPI_INSTANCE_ID}/token/${env.ZAPI_TOKEN}/send-option-list`;

const sendContactUrl = () =>
  `${env.ZAPI_BASE_URL}/instances/${env.ZAPI_INSTANCE_ID}/token/${env.ZAPI_TOKEN}/send-contact`;

export async function sendText(phone: string, message: string): Promise<void> {
  const normalized = normalizePhone(phone);
  const url = sendTextUrl();
  const body = { 
    phone: normalized, 
    message,
    delayTyping: 3,
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'client-Token': env.ZAPI_CLIENT_TOKEN,
      },
      body: JSON.stringify(body),
    });


    if (!res.ok) {
      const text = await res.text();
      logger.error('Z-API sendText failed', res.status, text);
      throw new Error(`Z-API sendText: ${res.status} ${text}`);
    }

    const data = (await res.json()) as { zaapId?: string; messageId?: string };
  } catch (e) {
    logger.error('sendText error', e);
    throw e;
  }
}

export interface ButtonOption {
  id: string;
  text: string;
}

export interface ListSection {
  title: string;
  rows: Array<{ id: string; title: string; description?: string }>;
}

export async function sendButtons(
  phone: string,
  message: string,
  buttons: ButtonOption[]
): Promise<void> {
  const normalized = normalizePhone(phone);
  const url = sendButtonsUrl();
  
  // Z-API permite até 3 botões do tipo REPLY
  const buttonsToSend = buttons.slice(0, 3);
  
  // Formato correto da Z-API: buttonActions com type: "REPLY"
  const body = {
    phone: normalized,
    message,
    buttonActions: buttonsToSend.map((btn) => ({
      id: btn.id,
      type: 'REPLY' as const,
      label: btn.text,
    })),
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': env.ZAPI_CLIENT_TOKEN,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error('Z-API sendButtons failed', { status: res.status, response: text, body });
      throw new Error(`Z-API sendButtons: ${res.status} ${text}`);
    }

    const data = (await res.json()) as { zaapId?: string; messageId?: string };
  } catch (e) {
    logger.error('sendButtons error', e);
    throw e;
  }
}

export async function sendListMessage(
  phone: string,
  title: string,
  description: string,
  buttonText: string,
  sections: ListSection[]
): Promise<void> {
  const normalized = normalizePhone(phone);
  const url = sendListUrl();

  // Converter sections para options (formato da Z-API)
  const options: Array<{ id: string; title: string; description: string }> = [];
  for (const section of sections) {
    for (const row of section.rows) {
      options.push({
        id: row.id,
        title: row.title,
        description: row.description || '',
      });
    }
  }

  // Formato correto da Z-API para listas de opções
  const body = {
    phone: normalized,
    message: description,
    optionList: {
      title: title,
      buttonLabel: buttonText,
      options: options,
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': env.ZAPI_CLIENT_TOKEN,
      },
      body: JSON.stringify(body),
    });

    const responseText = await res.text();
    
    if (!res.ok) {
      logger.error('Z-API sendListMessage failed', { status: res.status, response: responseText, body });
      throw new Error(`Z-API sendListMessage: ${res.status} ${responseText}`);
    }

    let data: { zaapId?: string; messageId?: string } = {};
    try {
      data = JSON.parse(responseText) as { zaapId?: string; messageId?: string };
    } catch (e) {
      logger.warn('Could not parse response as JSON', { response: responseText });
    }
    
  } catch (e) {
    logger.error('sendListMessage error', { error: e, body });
    throw e;
  }
}

export async function sendContact(
  phone: string,
  contactName: string,
  contactPhone: string
): Promise<void> {
  const normalized = normalizePhone(phone);
  const normalizedContactPhone = normalizePhone(contactPhone).replace(/\D/g, '');
  const url = sendContactUrl();
  const body = {
    phone: normalized,
    contactName,
    contactPhone: normalizedContactPhone,
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': env.ZAPI_CLIENT_TOKEN,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error('Z-API sendContact failed', res.status, text);
      throw new Error(`Z-API sendContact: ${res.status} ${text}`);
    }

    const data = (await res.json()) as { zaapId?: string; messageId?: string };
  } catch (e) {
    logger.error('sendContact error', e);
    throw e;
  }
}

export function parseWebhook(body: unknown): ParsedWebhook | null {
  const b = body as Record<string, unknown> | undefined;
  if (!b || typeof b !== 'object') return null;

  const phone = b.phone;
  const isGroup = b.isGroup;
  if (!phone || typeof phone !== 'string') return null;

  // Verificar se é resposta de botão ou lista
  const buttonReply = b.buttonReply as { id: string; title: string } | undefined;
  const listReply = b.listReply as { id: string; title: string } | undefined;
  const listResponseMessage = b.listResponseMessage as { selectedRowId?: string; id?: string; title?: string } | undefined;
  const pollResponseMessage = b.pollResponseMessage as
    | { votes?: Array<{ name?: string }>; selectedOptions?: string[]; selectedOption?: string; name?: string }
    | undefined;
  const optionReply = b.optionReply as { id: string; title: string } | undefined;
  const optionList = b.optionList as { id: string; title: string } | undefined;
  
  // A Z-API envia lista de opções em listResponseMessage.selectedRowId
  const selectedId = (
    b.selectedId || 
    b.selectedRowId || 
    buttonReply?.id || 
    listReply?.id || 
    listResponseMessage?.selectedRowId || 
    listResponseMessage?.id ||
    // Enquete (nome/option)
    pollResponseMessage?.selectedOption ||
    (Array.isArray(pollResponseMessage?.selectedOptions) ? pollResponseMessage?.selectedOptions.join(',') : undefined) ||
    pollResponseMessage?.name ||
    optionReply?.id || 
    optionList?.id
  ) as string | undefined;

  if (buttonReply || listReply || listResponseMessage || pollResponseMessage || optionReply || optionList || selectedId) {
    const id = (
      buttonReply?.id || 
      listReply?.id || 
      listResponseMessage?.selectedRowId || 
      listResponseMessage?.id ||
      pollResponseMessage?.selectedOption ||
      (Array.isArray(pollResponseMessage?.selectedOptions) ? pollResponseMessage?.selectedOptions.join(',') : undefined) ||
      pollResponseMessage?.name ||
      optionReply?.id || 
      optionList?.id || 
      selectedId || 
      ''
    );
    
    return {
      phone: normalizePhone(phone),
      text: id,
      fromMe: Boolean(b.fromMe),
      isGroup: Boolean(isGroup),
      selectedId: id,
      isButtonReply: Boolean(buttonReply),
      isListReply: Boolean(listReply || listResponseMessage || optionReply || optionList),
    };
  }

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
    isGroup: Boolean(isGroup),
  };
}
