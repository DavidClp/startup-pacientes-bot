import cron from 'node-cron';
import { getTasksDueNow } from '../services/PlanService';
import { sendText } from '../services/WhatsAppService';
import { setReminderState } from '../services/BotService';
import { REMINDER_PREFIX } from '../bot/states';
import { logger } from '../utils/logger';

export function startRemindersCron(): void {
  cron.schedule('* * * * *', async () => {
    try {
      const tasks = await getTasksDueNow();
      for (const t of tasks) {
        const phone = t.plan.patient.phone;
        const message = `${REMINDER_PREFIX}${t.title}`;
        await sendText(phone, message);
        setReminderState(phone, t.id);
        logger.info('Reminder sent', { phone, taskId: t.id, title: t.title });
      }
    } catch (e) {
      logger.error('Reminders cron error', e);
    }
  });
  logger.info('Cron reminders scheduled (every minute)');
}
