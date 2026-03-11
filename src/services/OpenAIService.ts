import OpenAI from 'openai';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `Você é um assistente de saúde que responde dúvidas simples sobre cuidados e saúde.
Responda de forma curta e clara. Não substitui orientação médica.
Se a dúvida for complexa ou urgente, recomende procurar um médico.`;

export async function answerHealthQuestion(question: string): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: question },
      ],
      max_tokens: 500,
    });

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) {
      return 'Não foi possível obter uma resposta. Tente reformular sua pergunta.';
    }
    return content;
  } catch (e) {
    logger.error('OpenAI error', e);
    return 'Desculpe, ocorreu um erro ao processar sua pergunta. Tente novamente mais tarde.';
  }
}
