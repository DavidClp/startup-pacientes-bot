import cron from 'node-cron';
import { getTasksDueNow, getFamilyMembers } from '../services/PlanService';
import { sendText, sendListMessage } from '../services/WhatsAppService';
import { setReminderState } from '../services/BotService';
import { logger } from '../utils/logger';
import type { ListSection } from '../services/WhatsAppService';

export function startRemindersCron(): void {
  cron.schedule('* * * * *', async () => {
    try {
      const tasks = await getTasksDueNow();
      for (const t of tasks) {
        const phone = t.plan.patient.phone;
        
        // Mensagem mais amigável
        const friendlyMessage = `👋 Olá! É hora de realizar uma tarefa do seu plano de cuidados.\n\n*${t.title}*\n\nPor favor, marque como você realizou esta tarefa:`;
        
        // Criar lista com as opções
        const sections: ListSection[] = [
          {
            title: 'Status da tarefa',
            rows: [
              { id: 'action_1', title: '✅ Realizado', description: 'Tarefa foi realizada com sucesso' },
              { id: 'action_2', title: '❌ Não Realizado', description: 'Tarefa não foi realizada' },
              { id: 'action_3', title: '🚫 Recusado', description: 'Tarefa foi recusada' },
              { id: 'action_4', title: '⚠️ Alerta de ocorrência', description: 'Reportar uma ocorrência' },
            ],
          },
        ];
        
        // Enviar mensagem amigável
        await sendText(phone, friendlyMessage);
        
        // Pequeno delay antes de enviar a lista
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Enviar lista com opções
        await sendListMessage(
          phone,
          'Registrar tarefa',
          'Selecione o status da tarefa:',
          'Ver opções',
          sections
        );
        
        setReminderState(phone, t.id);
        
        // Enviar lembrete para familiares
        try {
          const familyMembers = await getFamilyMembers(t.plan.patientId);
          const familyMessage = `⏰ *Lembrete do Plano de Cuidados*\n\n👤 *Paciente:* ${t.plan.patient.name ?? 'N/A'}\n\n📌 *Tarefa:* ${t.title}\n\n⏱️ É hora de realizar esta tarefa do plano de cuidados.`;
          
          for (const family of familyMembers) {
            try {
              await sendText(family.phone, familyMessage);
            } catch (error) {
              logger.error('Error sending family reminder', { familyPhone: family.phone, error });
            }
          }
        } catch (error) {
          logger.error('Error fetching family members for reminder', { patientId: t.plan.patientId, error });
        }
      }
    } catch (e) {
      logger.error('Reminders cron error', e);
    }
  });
  logger.info('Cron reminders scheduled (every minute)');
}
