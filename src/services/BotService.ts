import { TaskLogStatus } from '@prisma/client';
import { env, normalizePhone } from '../config/env';
import type { ConversationState, PatientState, AdminState, ParsedWebhook } from '../bot/types';
import { prisma } from '../database/client';
import {
  REGISTER_WELCOME,
  REGISTER_ASK_COMPLETE_PROFILE,
  REGISTER_DONE,
  PATIENT_MENU,
  ADMIN_MENU,
  BACK_TO_MENU_HINT,
  ADMIN_BACK_HINT,
  ASK_ACTION_TASK,
  ACTION_CHOICES,
  ACTION_RECORDED,
  ASK_QUESTION,
  ASK_OCCURRENCE,
  OCCURRENCE_RECORDED,
  ASK_CONTACT_MESSAGE,
  CONTACT_SENT,
  ADMIN_ASK_PHONE_STATUS,
  ADMIN_ASK_PHONE_PLAN,
  ADMIN_ASK_TASKS,
  ADMIN_PLAN_CREATED,
  ADMIN_ASK_PLAN_ID_EDIT,
  ADMIN_EDIT_INSTRUCTIONS,
  ADMIN_ASK_TASK_SELECTION,
  ADMIN_ASK_TASK_INTERVAL,
  ADMIN_ASK_MEDICATION_DETAILS,
  ADMIN_ASK_OTHER_TASK_DETAILS,
  ADMIN_ASK_FAMILY_DETAILS,
  ADMIN_FAMILY_ADDED,
  ADMIN_FAMILY_INVALID_FORMAT,
  ADMIN_TASK_SELECTION_INVALID,
  ADMIN_ASK_PATIENT_SELECTION,
  ADMIN_PATIENT_SELECTION_INVALID,
  ADMIN_WELCOME,
} from '../bot/states';
import * as PlanService from './PlanService';
import { sendText, sendListMessage, sendButtons, sendContact, type ListSection } from './WhatsAppService';
import { answerHealthQuestion } from './OpenAIService';
import { logger } from '../utils/logger';

const patientStates = new Map<string, ConversationState>();
const adminStates = new Map<string, ConversationState>();

function getPatientState(phone: string): ConversationState | undefined {
  return patientStates.get(phone);
}

function setPatientState(phone: string, state: ConversationState): void {
  patientStates.set(phone, state);
}

function clearPatientState(phone: string): void {
  patientStates.delete(phone);
}

function getAdminState(phone: string): ConversationState | undefined {
  return adminStates.get(phone);
}

function setAdminState(phone: string, state: ConversationState): void {
  adminStates.set(phone, state);
}

function setAwaitActionForTask(phone: string, taskId: string): void {
  setPatientState(phone, {
    state: 'AWAIT_ACTION_CHOICE',
    data: { taskId },
  });
}

export function setReminderState(phone: string, taskId: string): void {
  setPatientState(phone, {
    state: 'AWAIT_ACTION_CHOICE',
    data: { taskId },
  });
}

function isBackToMenu(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === '0' || t === 'voltar ao menu';
}

async function sendAdminMenu(phone: string): Promise<void> {
  // Usar lista de opções que permite todas as 4 opções
  await sendListMessage(
    phone,
    'Menu Enfermeiro 👨‍⚕️',
    'Menu Enfermeiro 👨‍⚕️\nSelecione uma opção:',
    'Ver Menu',
    [
      {
        title: 'Opções',
        rows: [
          { id: '1', title: '👥 Listar pacientes', description: 'Ver todos os pacientes cadastrados' },
          { id: '2', title: '🔍 Ver status paciente', description: 'Consultar status de um paciente' },
          { id: '3', title: '🆕 Criar plano paciente', description: 'Criar novo plano de cuidados' },
          { id: '4', title: '🔄 Editar plano paciente', description: 'Editar plano existente' },
          { id: '5', title: '👨‍👩‍👧 Vincular familiar', description: 'Vincular familiar a um paciente' },
        ],
      },
    ]
  );
}

function parsePlanTasksInput(text: string): { title: string; time: string }[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const tasks: { title: string; time: string }[] = [];
  const timeRegex = /^(\d{1,2}:\d{2})\s+(.+)$/;
  for (const line of lines) {
    const m = line.match(timeRegex);
    if (m) tasks.push({ time: m[1], title: m[2] });
  }
  return tasks;
}

export async function handleIncomingMessage(
  phone: string, 
  text: string, 
  parsed?: ParsedWebhook
): Promise<void> {
  const isAdmin = phone === env.DOCTOR_PHONE;

  if (isAdmin) {
    await handleAdminMessage(phone, text, parsed);
    return;
  }

  // Verificar se é um familiar (não tem ação, apenas recebe notificações)
  const normalizedPhone = normalizePhone(phone);
  try {
    // @ts-ignore - Prisma client será regenerado após migration
    const isFamilyMember = await prisma.familyMember.findFirst({
      where: { phone: normalizedPhone },
    });
    
    if (isFamilyMember) {
      return;
    }
  } catch (error) {
    // Se o modelo ainda não existe no Prisma client, continuar normalmente
    logger.warn('Could not check family member', { error });
  }

  await handlePatientMessage(phone, text, parsed);
}

async function handlePatientMessage(
  phone: string, 
  text: string, 
  parsed?: { isButtonReply?: boolean; isListReply?: boolean; selectedId?: string }
): Promise<void> {
  const state = getPatientState(phone);
  const user = await PlanService.getUserByPhone(phone);

  console.log('user', user);
  console.log('text', text);
  console.log('phone', phone);

  if (!user) {
    if (state?.state === 'REGISTER_COMPLETE_PROFILE') {
      const parsedData = PlanService.parsePatientData(text);
      
      if (!parsedData.name || parsedData.name.trim().length === 0) {
        await sendText(phone, 'Por favor, informe pelo menos o seu nome. Envie novamente todas as informações:');
        await sendText(phone, REGISTER_ASK_COMPLETE_PROFILE);
        return;
      }
      
      const newUser = await PlanService.createUser(phone, parsedData.name.trim(), 'PATIENT');
      
      await PlanService.updatePatientProfile(newUser.id, {
        birthDate: parsedData.birthDate,
        age: parsedData.age,
        weight: parsedData.weight,
        gender: parsedData.gender,
        familyHistory: parsedData.familyHistory,
        medications: parsedData.medications,
        caregiverProfession: parsedData.caregiverProfession,
      });
      
      setPatientState(phone, { state: 'MENU' });
      await sendText(phone, REGISTER_DONE);
      await sendPatientMenu(phone);
      return;
    }

    await startRegistration(phone, text);
    return;
  }

  // Continua o cadastro mesmo se o profile já existir (ex.: após salvar idade)
  if (
    state?.state === 'REGISTER_NAME' ||
    !user.patientProfile
  ) {
    await continueRegistration(phone, text, state);
    return;
  }

  if (state?.state === 'AWAIT_ACTION_CHOICE' && state.data?.taskId) {
    if (isBackToMenu(text)) {
      clearPatientState(phone);
      setPatientState(phone, { state: 'MENU' });
      await sendPatientMenu(phone);

      return;
    }
    
    // Processar resposta da lista ou texto digitado
    let choice = text.trim();
    
    // Se for resposta de lista (action_1, action_2, etc.)
    if (parsed?.isListReply && parsed.selectedId) {
      const match = parsed.selectedId.match(/^action_(\d+)$/);
      if (match) {
        choice = match[1];
      }
    }
    
    // Processar opção 4 (Alerta de ocorrência) - antes de registrar log
    if (choice === '4' || parsed?.selectedId === 'action_4') {
      setPatientState(phone, { state: 'AWAIT_OCCURRENCE', data: { taskId: state.data.taskId } });
      await sendText(phone, ASK_OCCURRENCE + BACK_TO_MENU_HINT);
      return;
    }
    
    if (choice === '1' || choice === '2' || choice === '3') {
      const status: TaskLogStatus = choice === '1' ? 'DONE' : choice === '2' ? 'NOT_DONE' : 'REFUSED';
      await PlanService.recordTaskLog(state.data.taskId, new Date(), status);
      
      // Buscar tarefa para notificar familiares
      const task = await prisma.planTask.findUnique({
        where: { id: state.data.taskId },
        include: { plan: { include: { patient: true } } },
      });
      
      if (task) {
        const statusText = status === 'DONE' ? '✅ Realizado' : status === 'NOT_DONE' ? '❌ Não Realizado' : '🚫 Recusado';
        const notificationMessage = `📋 *Atualização do Plano de Cuidados*\n\n👤 *Paciente:* ${task.plan.patient.name ?? 'N/A'}\n📌 *Tarefa:* ${task.title}\n✅ *Status:* ${statusText}`;
        await notifyFamilyMembers(task.plan.patientId, notificationMessage);
      }
      
      await sendText(phone, ACTION_RECORDED);

      // Após registrar, verificar adesão e possível alerta de risco
      const todayStatus = await PlanService.getPatientStatus(user.id, new Date());
      if (todayStatus.plan && todayStatus.tasks.length > 0) {
        const logs = todayStatus.logs;
        const tasks = todayStatus.tasks;

        // Só calcular adesão e disparar alerta se houver pelo menos 3 tarefas registradas
        const registeredTasksCount = logs.length;
        if (registeredTasksCount < 3) {
          // Ainda não há dados suficientes para calcular adesão
          setPatientState(phone, { state: 'MENU' });
          await sendPatientMenu(phone);
          return;
        }

        // Mapear status textual
        const statusLines = tasks.map((t) => {
          const log = logs.find((l) => l.taskId === t.id);
          let st = '-';
          if (log) {
            if (log.status === 'DONE') st = 'REALIZADO';
            else if (log.status === 'NOT_DONE') st = 'NÃO REALIZADO';
            else if (log.status === 'REFUSED') st = 'RECUSADO';
          }
          return `${t.time} ${t.title}: ${st}`;
        });

        // Regra simples de risco: adesão < 50% ou 3 tarefas seguidas NÃO FEITAS/RECUSADAS
        let consecutiveBad = 0;
        let maxConsecutiveBad = 0;
        for (const t of tasks) {
          const log = logs.find((l) => l.taskId === t.id);
          const bad = log && (log.status === 'NOT_DONE' || log.status === 'REFUSED');
          if (bad) {
            consecutiveBad += 1;
          } else {
            consecutiveBad = 0;
          }
          if (consecutiveBad > maxConsecutiveBad) maxConsecutiveBad = consecutiveBad;
        }

        if (todayStatus.adherencePercent < 50 || maxConsecutiveBad >= 3) {
          const alertMsg = `⚠ ALERTA DE ADESÃO\n\nPaciente: ${
            user.name ?? user.phone
          }\nTel: ${phone}\n\nHoje:\n${statusLines.join(
            '\n'
          )}\n\nAdesão hoje: ${todayStatus.adherencePercent}%`;
          await sendText(env.DOCTOR_PHONE, alertMsg);
        }
      }

      setPatientState(phone, { state: 'MENU' });
      await sendPatientMenu(phone);
      return;
    }

    // Resposta inválida para o registro da ação
    await sendText(
      phone,
      `Não entendi.\nSelecione uma opção da lista ou digite *1*, *2*, *3* ou *4* para registrar a ação.\n\n${ACTION_CHOICES}\n\nOu digite 0 para voltar ao menu.`
    );
    
    // Reenviar lista de opções
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
    
    await sendListMessage(
      phone,
      'Registrar tarefa',
      'Selecione o status da tarefa:',
      'Ver opções',
      sections
    );
    return;
  }

  if (state?.state === 'AWAIT_QUESTION') {
    if (isBackToMenu(text)) {
      await handleReturnToMenu(phone);
      return;
    }
    const answer = await answerHealthQuestion(text);
    await sendText(phone, answer);

    await handleReturnToMenu(phone);
    
    return;
  }

  if (state?.state === 'AWAIT_OCCURRENCE') {
    if (isBackToMenu(text)) {
      await handleReturnToMenu(phone);
      return;
    }

    const description = text.trim();
    if (!description) {
      await sendText(phone, 'A descrição da ocorrência não pode ser vazia. Por favor, descreva o que aconteceu:');
      return;
    }

    // Salvar ocorrência no banco
    await PlanService.createOccurrence(user.id, description);

    // Se veio de um lembrete (tem taskId), registrar como NOT_DONE e buscar nome da tarefa
    let taskInfo = '';
    if (state.data?.taskId) {
      await PlanService.recordTaskLog(state.data.taskId, new Date(), 'NOT_DONE');
      
      // Buscar nome da tarefa
      const task = await prisma.planTask.findUnique({
        where: { id: state.data.taskId },
        select: { title: true },
      });
      
      if (task) {
        taskInfo = `\nTarefa relacionada: ${task.title}`;
      }
    }
    
    const msg = `*⚠️ Alerta de ocorrência ⚠️*\n\nPaciente: *${user.name ?? 'N/A'}*\nTel: *${phone}*${taskInfo}\n\nOcorrência:\n${description}`;
    await sendText(env.DOCTOR_PHONE, msg);
    
    // Notificar familiares
    const familyNotification = `⚠️ *Alerta de Ocorrência* ⚠️\n\n👤 *Paciente:* ${user.name ?? 'N/A'}${taskInfo}\n\n📝 *Ocorrência:*\n${description}`;
    await notifyFamilyMembers(user.id, familyNotification);
    
    // Enviar lista de ações para o enfermeiro
    const occurrenceSections: ListSection[] = [
      {
        title: 'Ações disponíveis',
        rows: [
          { id: 'occurrence_action_1', title: '📊 Ver status do paciente', description: 'Visualizar status atual do paciente' },
          { id: 'occurrence_action_2', title: '📋 Ver ficha completa', description: 'Visualizar perfil completo do paciente' },
          { id: 'occurrence_action_3', title: '💬 Abrir WhatsApp do paciente', description: 'Iniciar conversa com o paciente' },
          { id: 'occurrence_action_4', title: '🏠 Voltar ao menu principal', description: 'Retornar ao menu do enfermeiro' },
        ],
      },
    ];
    
    // Salvar estado para processar a resposta
    setAdminState(env.DOCTOR_PHONE, {
      state: 'AWAIT_OCCURRENCE_ACTION',
      data: {
        occurrencePatientId: user.id,
        occurrencePatientPhone: phone,
      },
    });
    
    await sendListMessage(
      env.DOCTOR_PHONE,
      'Ações disponíveis',
      'Selecione uma ação:',
      'Ver opções',
      occurrenceSections
    );

    await sendText(phone, OCCURRENCE_RECORDED);
    await handleReturnToMenu(phone);
    return;
  }

  if (state?.state === 'AWAIT_CONTACT_MESSAGE') {
    if (isBackToMenu(text)) {
      await handleReturnToMenu(phone);
      return;
    }

    clearPatientState(phone);
    const msg = `Olá, você recebeu uma mensagem do Paciente: *${user.name ?? 'N/A'}*\nTel: *${phone}*\n\nMensagem: *${text}*`;
    await sendText(env.DOCTOR_PHONE, msg);
    
    // Notificar familiares
    const familyNotification = `💬 *Mensagem do Paciente*\n\n👤 *Paciente:* ${user.name ?? 'N/A'}\n\n📝 *Mensagem:*\n${text}`;
    await notifyFamilyMembers(user.id, familyNotification);
    
    // Enviar lista de ações para o enfermeiro (mesmo menu de ocorrência)
    const occurrenceSections: ListSection[] = [
      {
        title: 'Ações disponíveis',
        rows: [
          { id: 'occurrence_action_1', title: '📊 Ver status do paciente', description: 'Visualizar status atual do paciente' },
          { id: 'occurrence_action_2', title: '📋 Ver ficha completa', description: 'Visualizar perfil completo do paciente' },
          { id: 'occurrence_action_3', title: '💬 Abrir WhatsApp do paciente', description: 'Iniciar conversa com o paciente' },
          { id: 'occurrence_action_4', title: '🏠 Voltar ao menu principal', description: 'Retornar ao menu do enfermeiro' },
        ],
      },
    ];
    
    // Salvar estado para processar a resposta
    setAdminState(env.DOCTOR_PHONE, {
      state: 'AWAIT_OCCURRENCE_ACTION',
      data: {
        occurrencePatientId: user.id,
        occurrencePatientPhone: phone,
      },
    });
    
    await sendListMessage(
      env.DOCTOR_PHONE,
      'Ações disponíveis',
      'Selecione uma ação:',
      'Ver opções',
      occurrenceSections
    );
    
    await sendText(phone, CONTACT_SENT);
    setPatientState(phone, { state: 'MENU' });
    await sendPatientMenu(phone);
    return;
  }

  // Processar escolha do menu (lista interativa ou número digitado)
  let menuChoice = text.trim();
  
  // Se for resposta de lista interativa
  if (parsed?.isListReply && parsed.selectedId) {
    const match = parsed.selectedId.match(/^patient_menu_(\d+)$/);
    if (match) {
      menuChoice = match[1];
    }
  }
  
  if (menuChoice === '1') {
    const plan = await PlanService.getTodayPlan(user.id);
    if (!plan || plan.tasks.length === 0) {
      await sendText(phone, 'Você ainda não tem plano cadastrado ou não há tarefas para hoje.');
    } else {
      const lines = plan.tasks.map((t, i) => {
        const timeDisplay = formatTaskTime(t);
        return `${i + 1}. ${timeDisplay ? timeDisplay + ' - ' : ''}${t.title}`;
      });
      await sendText(phone, `*Plano de hoje*\n\n${lines.join('\n')}`);
    }
    await sendPatientMenu(phone);
    return;
  }

  if (menuChoice === '2') {
    const plan = await PlanService.getTodayPlan(user.id);
    if (!plan || plan.tasks.length === 0) {
      await sendText(phone, 'Não há tarefas no plano para registrar.');
      await sendPatientMenu(phone);
      return;
    }
    
    // Criar lista interativa de tarefas
    const taskSections: ListSection[] = [
      {
        title: 'Tarefas do plano',
        rows: plan.tasks.map((t, i) => {
          const timeDisplay = formatTaskTime(t);
          return {
            id: `task_${i}`,
            title: `${timeDisplay ? timeDisplay + ' - ' : ''}${t.title}`,
            description: 'Clique para registrar esta tarefa',
          };
        }),
      },
    ];
    
    setPatientState(phone, { state: 'AWAIT_ACTION_TASK_ID', data: { tasksList: plan.tasks } });
    await sendListMessage(
      phone,
      'Registrar tarefa',
      `${ASK_ACTION_TASK}${BACK_TO_MENU_HINT}`,
      'Ver tarefas',
      taskSections
    );
    return;
  }

  if (state?.state === 'AWAIT_ACTION_TASK_ID') {
    if (isBackToMenu(text)) {
      clearPatientState(phone);
      setPatientState(phone, { state: 'MENU' });
      await sendPatientMenu(phone);
      return;
    }
    
    const plan = await PlanService.getTodayPlan(user.id);
    const tasksList = state.data?.tasksList || plan?.tasks || [];
    
    if (!plan || tasksList.length === 0) {
      setPatientState(phone, { state: 'MENU' });
      await sendPatientMenu(phone);
      return;
    }
    
    let selectedTask;
    
    // Verificar se é resposta de lista interativa
    if (parsed?.isListReply && parsed.selectedId) {
      const match = parsed.selectedId.match(/^task_(\d+)$/);
      if (match) {
        const index = parseInt(match[1], 10);
        if (index >= 0 && index < tasksList.length) {
          selectedTask = tasksList[index];
        }
      }
    } else {
      // Fallback: processar número digitado
      const num = parseInt(text.trim(), 10);
      if (!Number.isNaN(num) && num >= 1 && num <= tasksList.length) {
        selectedTask = tasksList[num - 1];
      }
    }
    
    if (!selectedTask) {
      await sendText(phone, 'Tarefa inválida. Selecione uma tarefa da lista ou digite o número.');
      // Reenviar lista
      const taskSections: ListSection[] = [
        {
          title: 'Tarefas do plano',
          rows: tasksList.map((t: { id: string; time: string; title: string; intervalHours?: number | null }, i: number) => {
            const timeDisplay = formatTaskTime(t);
            return {
              id: `task_${i}`,
              title: `${timeDisplay ? timeDisplay + ' - ' : ''}${t.title}`,
              description: 'Clique para registrar esta tarefa',
            };
          }),
        },
      ];
      await sendListMessage(
        phone,
        'Selecione a tarefa',
        'Escolha a tarefa que deseja registrar:',
        'Ver tarefas',
        taskSections
      );
      return;
    }
    
    setPatientState(phone, { state: 'AWAIT_ACTION_CHOICE', data: { taskId: selectedTask.id } });
    
    // Formatar nome da tarefa com horário/intervalo
    const timeDisplay = formatTaskTime(selectedTask);
    const taskDisplayName = timeDisplay ? `${timeDisplay} - ${selectedTask.title}` : selectedTask.title;
    
    // Enviar lista de opções de ação
    const actionSections: ListSection[] = [
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
    
    await sendListMessage(
      phone,
      taskDisplayName,
      `Selecione o status para: ${taskDisplayName}`,
      'Ver opções',
      actionSections
    );
    return;
  }

  if (menuChoice === '3') {
    setPatientState(phone, { state: 'AWAIT_OCCURRENCE' });
    await sendText(phone, ASK_OCCURRENCE + BACK_TO_MENU_HINT);
    return;
  }

  if (menuChoice === '4') {
    setPatientState(phone, { state: 'AWAIT_CONTACT_MESSAGE' });
    await sendText(phone, ASK_CONTACT_MESSAGE + BACK_TO_MENU_HINT);
    return;
  }

  // Qualquer outra resposta fora das opções do menu
  setPatientState(phone, { state: 'MENU' });
  await sendText(phone, 'Não entendi. Por favor, escolha uma das opções do menu abaixo:');
  await sendPatientMenu(phone);
}

async function startRegistration(phone: string, _text: string): Promise<void> {
  console.log('startRegistration', phone, _text);
  setPatientState(phone, { state: 'REGISTER_COMPLETE_PROFILE' });
  await sendText(phone, REGISTER_WELCOME);
}

async function continueRegistration(
  phone: string,
  text: string,
  state: ConversationState | undefined
): Promise<void> {
  const current = (state?.state ?? 'REGISTER_COMPLETE_PROFILE') as PatientState;

  if (current === 'REGISTER_COMPLETE_PROFILE') {
    const user = await PlanService.getUserByPhone(phone);
    if (!user) {
      await startRegistration(phone, text);
      return;
    }

    const parsedData = PlanService.parsePatientData(text);
    
    // Atualizar perfil com todos os dados
    await PlanService.updatePatientProfile(user.id, {
      birthDate: parsedData.birthDate,
      age: parsedData.age,
      weight: parsedData.weight,
      gender: parsedData.gender,
      familyHistory: parsedData.familyHistory,
      medications: parsedData.medications,
      caregiverProfession: parsedData.caregiverProfession,
    });
    
    // Atualizar nome do usuário se fornecido e diferente do atual
    if (parsedData.name && parsedData.name.trim().length > 0 && parsedData.name.trim() !== user.name) {
      await prisma.user.update({
        where: { id: user.id },
        data: { name: parsedData.name.trim() },
      });
    }
    
    setPatientState(phone, { state: 'MENU' });
    await sendText(phone, REGISTER_DONE);
    await sendPatientMenu(phone);
    return;
  }

  // Se não estiver no estado esperado, reiniciar cadastro
  setPatientState(phone, { state: 'REGISTER_COMPLETE_PROFILE' });
  await sendText(phone, REGISTER_WELCOME);
}

async function handleAdminMessage(
  phone: string, 
  text: string, 
  parsed?: { isButtonReply?: boolean; isListReply?: boolean; selectedId?: string }
): Promise<void> {
  await PlanService.getOrCreateAdmin(phone);
  const state = getAdminState(phone);
  const choice = text.trim();
  
  // Primeira vez que o médico interage (sem estado)
  if (!state) {
    setAdminState(phone, { state: 'MENU' });
    await sendText(phone, ADMIN_WELCOME);
    // Pequeno delay para garantir que a mensagem anterior seja enviada
    await new Promise(resolve => setTimeout(resolve, 500));
    await sendAdminMenu(phone);
    return;
  }

  if (state.state === 'MENU') {
    // Verificar se é resposta de lista interativa
    let menuChoice = text.trim();
    if (parsed?.isListReply && parsed.selectedId) {
      menuChoice = parsed.selectedId;
    }
    // Normalizar choice para garantir comparação correta
    const normalizedChoice = String(menuChoice).trim();
    if (normalizedChoice === '1') {
      const patients = await PlanService.listPatients();
      if (patients.length === 0) {
        await sendText(phone, 'Nenhum paciente cadastrado.');
      } else {
        const lines = patients.map((p) => `${p.name ?? 'Sem nome'} - ${p.phone}`);
        await sendText(phone, `*Pacientes*\n\n${lines.join('\n')}`);
      }
      await sendAdminMenu(phone);
      return;
    }
    if (normalizedChoice === '2') {
      const patients = await PlanService.listPatients();
      if (patients.length === 0) {
        await sendText(phone, 'Nenhum paciente cadastrado.');
        await sendAdminMenu(phone);
        return;
      }
      const patientsList = patients.map((p) => ({
        id: p.id,
        phone: p.phone,
        name: p.name,
      }));
      
      const patientSections = [{
        title: 'Pacientes',
        rows: patients.map((p, index) => ({
          id: `patient_${index}`,
          title: `${p.name ?? 'Sem nome'}`,
          description: p.phone,
        })),
      }];
      
      setAdminState(phone, { 
        state: 'AWAIT_PATIENT_SELECTION', 
        data: { patientsList, selectionMode: 'STATUS' } 
      });
      await sendText(phone, `*Selecione o paciente para ver o status:*${ADMIN_BACK_HINT}`);
      await sendListMessage(
        phone,
        'Selecione o paciente',
        'Escolha um paciente da lista:',
        'Ver pacientes',
        patientSections
      );
      return;
    }
    if (normalizedChoice === '3') {
      const patients = await PlanService.listPatients();
      if (patients.length === 0) {
        await sendText(phone, 'Nenhum paciente cadastrado.');
        await sendAdminMenu(phone);
        return;
      }
      const patientsList = patients.map((p, index) => ({
        id: p.id,
        phone: p.phone,
        name: p.name,
      }));
      
      // Criar lista interativa de pacientes
      const patientSections = [{
        title: 'Pacientes',
        rows: patients.map((p, index) => ({
          id: `patient_${index}`,
          title: `${p.name ?? 'Sem nome'}`,
          description: p.phone,
        })),
      }];
      
      setAdminState(phone, { 
        state: 'AWAIT_PATIENT_SELECTION', 
        data: { patientsList, selectionMode: 'PLAN' } 
      });
      await sendText(phone, `*Selecione o paciente para criar o plano:*${ADMIN_BACK_HINT}`);
      await sendListMessage(
        phone,
        'Selecione o paciente',
        'Escolha um paciente da lista:',
        'Ver pacientes',
        patientSections
      );
      return;
    }
    if (normalizedChoice === '4') {
      const patients = await PlanService.listPatients();
      if (patients.length === 0) {
        await sendText(phone, 'Nenhum paciente cadastrado.');
        await sendAdminMenu(phone);
        return;
      }
      const patientsList = patients.map((p, index) => ({
        id: p.id,
        phone: p.phone,
        name: p.name,
      }));
      
      // Criar lista interativa de pacientes
      const patientSections = [{
        title: 'Pacientes',
        rows: patients.map((p, index) => ({
          id: `patient_${index}`,
          title: `${p.name ?? 'Sem nome'}`,
          description: p.phone,
        })),
      }];
      
      setAdminState(phone, { 
        state: 'AWAIT_PATIENT_SELECTION', 
        data: { patientsList, selectionMode: 'EDIT' } 
      });
      await sendText(phone, `*Selecione o paciente para editar o plano:*${ADMIN_BACK_HINT}`);
      await sendListMessage(
        phone,
        'Selecione o paciente',
        'Escolha um paciente da lista:',
        'Ver pacientes',
        patientSections
      );
      return;
    }
    if (normalizedChoice === '5') {
      // Vincular familiar ao paciente
      const patients = await PlanService.listPatients();
      if (patients.length === 0) {
        await sendText(phone, 'Nenhum paciente cadastrado.');
        await sendAdminMenu(phone);
        return;
      }
      const patientsList = patients.map((p, index) => ({
        id: p.id,
        phone: p.phone,
        name: p.name,
      }));
      
      // Criar lista interativa de pacientes
      const patientSections = [{
        title: 'Pacientes',
        rows: patients.map((p, index) => ({
          id: `patient_${index}`,
          title: `${p.name ?? 'Sem nome'}`,
          description: p.phone,
        })),
      }];
      
      setAdminState(phone, { 
        state: 'AWAIT_FAMILY_PATIENT_SELECTION',
        data: { patientsList, selectionMode: 'FAMILY' }
      });
      
      await sendListMessage(
        phone,
        'Vincular Familiar',
        'Selecione o paciente para vincular o familiar:',
        'Ver pacientes',
        patientSections
      );
      return;
    }
    // Qualquer outra resposta fora das opções do menu admin
    await sendText(phone, 'Não entendi. Por favor, escolha uma das opções do menu admin abaixo:');
    await sendAdminMenu(phone);
    return;
  }

  if (state.state === 'AWAIT_PATIENT_PHONE_STATUS') {
    if (isBackToMenu(text)) {
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }
    // Mantido apenas para compatibilidade, mas fluxo principal agora usa seleção por lista
    await sendText(phone, 'Fluxo atualizado. Use o menu para selecionar o paciente pela lista.');
    setAdminState(phone, { state: 'MENU' });
    await sendAdminMenu(phone);
    return;
  }

  if (state.state === 'AWAIT_PATIENT_SELECTION') {
    if (isBackToMenu(text)) {
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }
    
    const patientsList = state.data?.patientsList || [];
    const selectionMode = state.data?.selectionMode ?? 'PLAN';
    let selectedPatient;
    
    // Verificar se é resposta de lista interativa
    if (parsed?.isListReply && parsed.selectedId) {
      const match = parsed.selectedId.match(/^patient_(\d+)$/);
      if (match) {
        const index = parseInt(match[1], 10);
        if (index >= 0 && index < patientsList.length) {
          selectedPatient = patientsList[index];
        }
      }
    } else {
      // Fallback: processar número digitado
      const selectedNumber = parseInt(text.trim(), 10);
      if (!Number.isNaN(selectedNumber) && selectedNumber >= 1 && selectedNumber <= patientsList.length) {
        selectedPatient = patientsList[selectedNumber - 1];
      }
    }
    
    if (!selectedPatient) {
      await sendText(phone, ADMIN_PATIENT_SELECTION_INVALID + ADMIN_BACK_HINT);
      // Reenviar lista
      const patients = await PlanService.listPatients();
      const patientSections = [{
        title: 'Pacientes',
        rows: patients.map((p, index) => ({
          id: `patient_${index}`,
          title: `${p.name ?? 'Sem nome'}`,
          description: p.phone,
        })),
      }];
      await sendListMessage(
        phone,
        'Selecione o paciente',
        'Escolha um paciente da lista:',
        'Ver pacientes',
        patientSections
      );
      return;
    }
    
    const patient = await PlanService.getUserByPhone(selectedPatient.phone);
    
    if (!patient || patient.role !== 'PATIENT') {
      await sendText(phone, 'Paciente não encontrado.');
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }

    if (selectionMode === 'STATUS') {
      // Ver status do paciente (mesma lógica que antes, mas usando seleção por lista)
      const status = await PlanService.getPatientStatus(patient.id, new Date());
      const weeklyAdherence = await PlanService.getPatientWeeklyAdherence(patient.id, 7);
      setAdminState(phone, { state: 'MENU' });

      if (!status.plan) {
        await sendText(phone, 'Paciente sem plano cadastrado.');
      } else {
        const taskStatus = status.tasks.map((t) => {
          const log = status.logs.find((l) => l.taskId === t.id);
          const st = log
            ? log.status === 'DONE'
              ? 'FEZ'
              : log.status === 'NOT_DONE'
              ? 'NÃO FEZ'
              : 'RECUSOU'
            : '-';
          
          const timeDisplay = formatTaskTime(t);
          return `${timeDisplay ? timeDisplay + ' - ' : ''}${t.title}: ${st}`;
        });
        await sendText(
          phone,
          `*Status - ${patient.name ?? patient.phone}*\n\n${taskStatus.join(
            '\n'
          )}\n\nAdesão ao plano hoje: ${status.adherencePercent}%\nAdesão nos últimos 7 dias: ${weeklyAdherence}%`
        );
      }
      await sendAdminMenu(phone);
      return;
    }

    if (selectionMode === 'EDIT') {
      // Editar plano do paciente selecionado
      const plans = await PlanService.getPlansByPatientPhone(patient.phone);
      if (plans.length === 0) {
        await sendText(phone, 'Paciente sem plano cadastrado.');
        setAdminState(phone, { state: 'MENU' });
        await sendAdminMenu(phone);
        return;
      }
      
      // Pegar o plano mais recente
      const plan = plans[0];
      const taskList = plan.tasks.map((t, i) => {
        const timeDisplay = formatTaskTime(t);
        return `${i + 1}. ${timeDisplay ? timeDisplay + ' - ' : ''}${t.title}`;
      }).join('\n');
      
      setAdminState(phone, { state: 'AWAIT_EDIT_MENU', data: { planId: plan.id } });
      await sendText(phone, `*Plano: ${plan.title}*\n\n*Paciente: ${patient.name ?? patient.phone}*\n\n*Tarefas atuais:*\n${taskList}\n\nSelecione uma ação:`);
      
      // Enviar menu de edição
      const editSections: ListSection[] = [
        {
          title: 'Ações de edição',
          rows: [
            { id: 'edit_add', title: '➕ Adicionar tarefa', description: 'Adicionar novas tarefas ao plano' },
            { id: 'edit_remove', title: '➖ Remover tarefa', description: 'Remover tarefas do plano' },
            { id: 'edit_schedule', title: '⏰ Editar agendamento', description: 'Alterar horário/intervalo de uma tarefa' },
            { id: 'edit_cancel', title: '❌ Cancelar e voltar', description: 'Cancelar edição e voltar ao menu principal' },
          ],
        },
      ];
      
      await sendListMessage(
        phone,
        'Editar plano',
        'Selecione uma ação:',
        'Ver opções',
        editSections
      );
      return;
    }

    if (selectionMode === 'FAMILY') {
      // Vincular familiar ao paciente selecionado
      setAdminState(phone, {
        state: 'AWAIT_FAMILY_DETAILS',
        data: { patientPhone: patient.phone, patientId: patient.id },
      });
      await sendText(phone, ADMIN_ASK_FAMILY_DETAILS + ADMIN_BACK_HINT);
      return;
    }

    // Modo padrão: criar plano para o paciente selecionado
    setAdminState(phone, {
      state: 'AWAIT_TASK_SELECTION',
      data: { patientPhone: patient.phone, selectedTasks: [], taskIntervals: {} },
    });

    const tasksList = PlanService.PREDEFINED_TASKS.map((task, index) => `${index + 1}. ${task}`).join('\n');

    await sendText(
      phone,
      `*Paciente selecionado: ${patient.name ?? selectedPatient.phone}*\n\n` +
        '*Tarefas disponíveis:*\n' +
        `${tasksList}\n\n` +
        '*Digite os números das tarefas separados por vírgula ou espaço*\n' +
        'Exemplo: 1,3,5 ou 1 3 5\n\n' +
        'Após enviar, vamos configurar os horários.'
    );
    return;
  }

  if (state.state === 'AWAIT_FAMILY_PATIENT_SELECTION') {
    if (isBackToMenu(text)) {
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }
    
    const patientsList = state.data?.patientsList || [];
    let selectedPatient;
    
    // Verificar se é resposta de lista interativa
    if (parsed?.isListReply && parsed.selectedId) {
      const match = parsed.selectedId.match(/^patient_(\d+)$/);
      if (match) {
        const index = parseInt(match[1], 10);
        if (index >= 0 && index < patientsList.length) {
          selectedPatient = patientsList[index];
        }
      }
    } else {
      // Fallback: processar número digitado
      const selectedNumber = parseInt(text.trim(), 10);
      if (!Number.isNaN(selectedNumber) && selectedNumber >= 1 && selectedNumber <= patientsList.length) {
        selectedPatient = patientsList[selectedNumber - 1];
      }
    }
    
    if (!selectedPatient) {
      await sendText(phone, ADMIN_PATIENT_SELECTION_INVALID + ADMIN_BACK_HINT);
      // Reenviar lista
      const patients = await PlanService.listPatients();
      const patientSections = [{
        title: 'Pacientes',
        rows: patients.map((p, index) => ({
          id: `patient_${index}`,
          title: `${p.name ?? 'Sem nome'}`,
          description: p.phone,
        })),
      }];
      await sendListMessage(
        phone,
        'Vincular Familiar',
        'Selecione o paciente para vincular o familiar:',
        'Ver pacientes',
        patientSections
      );
      return;
    }
    
    const patient = await PlanService.getUserByPhone(selectedPatient.phone);
    
    if (!patient || patient.role !== 'PATIENT') {
      await sendText(phone, 'Paciente não encontrado.');
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }

    // Vincular familiar ao paciente selecionado
    setAdminState(phone, {
      state: 'AWAIT_FAMILY_DETAILS',
      data: { patientPhone: patient.phone, patientId: patient.id },
    });
    await sendText(phone, ADMIN_ASK_FAMILY_DETAILS + ADMIN_BACK_HINT);
    return;
  }

  if (state.state === 'AWAIT_FAMILY_DETAILS') {
    if (isBackToMenu(text)) {
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }

    // Processar nome e telefone (primeira linha: nome, segunda linha: telefone)
    const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    if (lines.length < 2) {
      await sendText(phone, ADMIN_FAMILY_INVALID_FORMAT + ADMIN_BACK_HINT);
      return;
    }

    const familyName = lines[0];
    const familyPhone = lines[1];
    const patientId = state.data?.patientId;

    if (!patientId) {
      await sendText(phone, 'Erro: paciente não encontrado.');
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }

    try {
      await PlanService.createFamilyMember(patientId, familyName, familyPhone);
      await sendText(phone, ADMIN_FAMILY_ADDED);
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
    } catch (error) {
      logger.error('Error creating family member', error);
      await sendText(phone, 'Erro ao vincular familiar. Tente novamente.');
    }
    return;
  }

  if (state.state === 'AWAIT_TASK_SELECTION') {
    if (isBackToMenu(text)) {
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }

    // Processar números: 1,3,5 ou 1 3 5
    const selectedNumbers = text
      .split(/[,\s]+/)
      .map((n) => parseInt(n.trim(), 10))
      .filter((n) => !Number.isNaN(n) && n >= 1 && n <= PlanService.PREDEFINED_TASKS.length);

    if (selectedNumbers.length === 0) {
      await sendText(
        phone,
        'Não entendi. Digite os números das tarefas separados por vírgula ou espaço.\nExemplo: 1,3,5 ou 1 3 5'
      );
      return;
    }

    // Processar tarefas selecionadas e ir direto para configurar horários
    const newTasks = selectedNumbers.map((n) => PlanService.PREDEFINED_TASKS[n - 1]);
    const allTasks = [...new Set(newTasks)]; // Remover duplicatas

    if (allTasks.length === 0) {
      await sendText(phone, 'Nenhuma tarefa válida foi selecionada. Tente novamente.');
      return;
    }

    // Ir direto para configurar intervalos de todas as tarefas
    const taskIntervals: Record<string, number | null> = {};
    setAdminState(phone, {
      state: 'AWAIT_TASK_INTERVAL',
      data: {
        patientPhone: state.data?.patientPhone || '',
        selectedTasks: allTasks,
        taskIntervals,
        currentTaskIndex: 0,
      },
    });

    await sendText(
      phone,
      `✓ ${allTasks.length} tarefa(s) selecionada(s):\n${allTasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nAgora vamos configurar os intervalos de alerta.`
    );
    
    await processNextTaskInterval(phone, state.data?.patientPhone || '', allTasks, 0, taskIntervals);
    return;
  }

  if (state.state === 'AWAIT_TASK_INTERVAL') {
    if (isBackToMenu(text)) {
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }
    
    const currentIndex = state.data?.currentTaskIndex ?? 0;
    const selectedTasks = state.data?.selectedTasks || [];
    const taskIntervals = state.data?.taskIntervals || {};
    const currentTask = selectedTasks[currentIndex];
    
    if (!currentTask) {
      await finalizePlanCreation(phone, state.data?.patientPhone || '', selectedTasks, taskIntervals);
      return;
    }
    
    // Verificar se é "Horários de medicação" ou "Outra coisa" - essas vão direto para seus fluxos
    if (currentTask === 'Horários de medicação') {
      setAdminState(phone, {
        state: 'AWAIT_MEDICATION_DETAILS',
        data: {
          patientPhone: state.data?.patientPhone,
          selectedTasks,
          taskIntervals,
          currentTaskIndex: currentIndex,
        },
      });
      await sendText(phone, ADMIN_ASK_MEDICATION_DETAILS + ADMIN_BACK_HINT);
      return;
    } else if (currentTask === 'Outra coisa') {
      setAdminState(phone, {
        state: 'AWAIT_OTHER_TASK_DETAILS',
        data: {
          patientPhone: state.data?.patientPhone,
          selectedTasks,
          taskIntervals,
          currentTaskIndex: currentIndex,
        },
      });
      await sendText(phone, ADMIN_ASK_OTHER_TASK_DETAILS + ADMIN_BACK_HINT);
      return;
    }
    
    // Processar intervalo para tarefas normais
    let interval: number | null = null;
    
    if (parsed?.isListReply && parsed.selectedId) {
      // Resposta de lista
      interval = PlanService.parseIntervalFromList(parsed.selectedId);
    } else if (parsed?.isButtonReply && parsed.selectedId) {
      // Resposta de botão (fallback)
      interval = PlanService.parseIntervalFromButton(parsed.selectedId);
    } else {
      // Fallback: processar texto digitado
      const intervalText = text.trim();
      if (intervalText && intervalText !== '0') {
        interval = PlanService.parseInterval(intervalText);
        if (interval === null) {
          await sendText(phone, 'Formato inválido. Selecione uma opção da lista ou use "Xh" (ex: 12h) ou "0" para pular alerta.');
          // Reenviar lista
          const sections = PlanService.formatIntervalListSections();
          await sendListMessage(
            phone,
            'Selecione o intervalo',
            'Escolha o intervalo de alerta:',
            'Ver opções',
            sections
          );
          return;
        }
      }
    }
    
    taskIntervals[currentTask] = interval;
    
    // Próxima tarefa
    const nextIndex = currentIndex + 1;
    setAdminState(phone, {
      state: 'AWAIT_TASK_INTERVAL',
      data: {
        patientPhone: state.data?.patientPhone,
        selectedTasks,
        taskIntervals,
        currentTaskIndex: nextIndex,
      },
    });
    await processNextTaskInterval(phone, state.data?.patientPhone || '', selectedTasks, nextIndex, taskIntervals);
    return;
  }

  if (state.state === 'AWAIT_MEDICATION_DETAILS') {
    if (isBackToMenu(text)) {
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }
    
    const currentIndex = state.data?.currentTaskIndex ?? 0;
    const selectedTasks = [...(state.data?.selectedTasks || [])];
    const taskIntervals = { ...(state.data?.taskIntervals || {}) };
    
    if (text.trim() !== '0') {
      // Processar lista de remédios (separados por vírgula ou espaço)
      const medicationNames = text
        .split(/[,\s]+/)
        .map(m => m.trim())
        .filter(Boolean);
      
      if (medicationNames.length === 0) {
        await sendText(phone, 'Nenhum remédio informado. Digite os nomes dos remédios separados por vírgula ou espaço.');
        return;
      }
      
      // Criar tasks de medicação
      const medications = medicationNames.map(name => `Medicação: ${name}`);
      
      // Substituir "Horários de medicação" pelos medicamentos individuais
      selectedTasks.splice(currentIndex, 1, ...medications);
    } else {
      // Se digitou 0, remover "Horários de medicação"
      selectedTasks.splice(currentIndex, 1);
    }
    
    // Continuar com próxima tarefa para configurar intervalos
    // Se substituímos "Horários de medicação" por medicamentos, o índice atual já está no primeiro medicamento
    // Vamos processar os intervalos dos medicamentos agora
    const hasMedications = selectedTasks.some(t => t.startsWith('Medicação: '));
    
    if (hasMedications && currentIndex < selectedTasks.length && selectedTasks[currentIndex].startsWith('Medicação: ')) {
      // Agora vamos configurar intervalos para cada medicamento
      setAdminState(phone, {
        state: 'AWAIT_TASK_INTERVAL',
        data: {
          patientPhone: state.data?.patientPhone,
          selectedTasks,
          taskIntervals,
          currentTaskIndex: currentIndex, // Começar do primeiro medicamento
        },
      });
      await processNextTaskInterval(phone, state.data?.patientPhone || '', selectedTasks, currentIndex, taskIntervals);
    } else {
      // Se pulou (digitou 0) ou não tem medicamentos, continuar normalmente
      setAdminState(phone, {
        state: 'AWAIT_TASK_INTERVAL',
        data: {
          patientPhone: state.data?.patientPhone,
          selectedTasks,
          taskIntervals,
          currentTaskIndex: currentIndex,
        },
      });
      await processNextTaskInterval(phone, state.data?.patientPhone || '', selectedTasks, currentIndex, taskIntervals);
    }
    return;
  }

  if (state.state === 'AWAIT_OTHER_TASK_DETAILS') {
    if (isBackToMenu(text)) {
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }
    
    const currentIndex = state.data?.currentTaskIndex ?? 0;
    const selectedTasks = state.data?.selectedTasks || [];
    const taskIntervals = state.data?.taskIntervals || {};
    
    // Processar "Outra coisa"
    const match = text.match(/^(.+?)(?:\s*-\s*(\d+h?))?$/i);
    if (match) {
      const taskName = match[1].trim();
      const intervalStr = match[2]?.trim();
      const interval = intervalStr ? (PlanService.parseInterval(intervalStr) || parseInt(intervalStr, 10)) : null;
      
      // Substituir "Outra coisa" pelo nome real da tarefa
      selectedTasks[currentIndex] = taskName;
      taskIntervals[taskName] = interval;
    }
    
    // Continuar com próxima tarefa
    const nextIndex = currentIndex + 1;
    setAdminState(phone, {
      state: 'AWAIT_TASK_INTERVAL',
      data: {
        patientPhone: state.data?.patientPhone,
        selectedTasks,
        taskIntervals,
        currentTaskIndex: nextIndex,
      },
    });
    await processNextTaskInterval(phone, state.data?.patientPhone || '', selectedTasks, nextIndex, taskIntervals);
    return;
  }

  if (state.state === 'AWAIT_OCCURRENCE_ACTION') {
    if (isBackToMenu(text)) {
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }
    
    const patientId = state.data?.occurrencePatientId;
    const patientPhone = state.data?.occurrencePatientPhone;
    
    if (!patientId || !patientPhone) {
      setAdminState(phone, { state: 'MENU' });
      await sendText(phone, 'Erro: informações do paciente não encontradas.');
      await sendAdminMenu(phone);
      return;
    }
    
    // Função auxiliar para reenviar o menu de ocorrência
    const sendOccurrenceMenu = async () => {
      const occurrenceSections: ListSection[] = [
        {
          title: 'Ações disponíveis',
          rows: [
            { id: 'occurrence_action_1', title: '📊 Ver status do paciente', description: 'Visualizar status atual do paciente' },
            { id: 'occurrence_action_2', title: '📋 Ver ficha completa', description: 'Visualizar perfil completo do paciente' },
            { id: 'occurrence_action_3', title: '💬 Abrir WhatsApp do paciente', description: 'Iniciar conversa com o paciente' },
            { id: 'occurrence_action_4', title: '🏠 Voltar ao menu principal', description: 'Retornar ao menu do enfermeiro' },
          ],
        },
      ];
      
      await sendListMessage(
        phone,
        'Ações disponíveis',
        'Selecione uma ação:',
        'Ver opções',
        occurrenceSections
      );
    };
    
    // Processar resposta da lista ou texto digitado
    let actionChoice = text.trim();
    
    // Se for resposta de lista interativa
    if (parsed?.isListReply && parsed.selectedId) {
      const match = parsed.selectedId.match(/^occurrence_action_(\d+)$/);
      if (match) {
        actionChoice = match[1];
      }
    }
    
    if (actionChoice === '1' || parsed?.selectedId === 'occurrence_action_1') {
      // Ver status do paciente
      const patient = await PlanService.getUserByPhone(patientPhone);
      if (!patient) {
        await sendText(phone, 'Paciente não encontrado.');
        setAdminState(phone, { state: 'MENU' });
        await sendAdminMenu(phone);
        return;
      }
      
      const status = await PlanService.getPatientStatus(patient.id, new Date());
      const weeklyAdherence = await PlanService.getPatientWeeklyAdherence(patient.id, 7);
      
      if (!status.plan) {
        await sendText(phone, 'Paciente sem plano cadastrado.');
      } else {
        const taskStatus = status.tasks.map((t) => {
          const log = status.logs.find((l) => l.taskId === t.id);
          const st = log
            ? log.status === 'DONE'
              ? 'FEZ'
              : log.status === 'NOT_DONE'
              ? 'NÃO FEZ'
              : 'RECUSOU'
            : '-';
          
          const timeDisplay = formatTaskTime(t);
          return `${timeDisplay ? timeDisplay + ' - ' : ''}${t.title}: ${st}`;
        });
        
        await sendText(
          phone,
          `*Status - ${patient.name ?? patient.phone}*\n\n${taskStatus.join(
            '\n'
          )}\n\nAdesão ao plano hoje: ${status.adherencePercent}%\nAdesão nos últimos 7 dias: ${weeklyAdherence}%`
        );
      }
      
      // Voltar ao menu de ocorrência
      await sendOccurrenceMenu();
      return;
    }
    
    if (actionChoice === '2' || parsed?.selectedId === 'occurrence_action_2') {
      // Ver ficha completa do paciente
      const patient = await PlanService.getUserByPhone(patientPhone);
      if (!patient) {
        await sendText(phone, 'Paciente não encontrado.');
        setAdminState(phone, { state: 'MENU' });
        await sendAdminMenu(phone);
        return;
      }
      
      const profile = await PlanService.getPatientProfile(patient.id);
      
      if (!profile) {
        await sendText(phone, 'Perfil do paciente não encontrado.');
      } else {
        const profileLines = [
          `*Ficha Completa - ${patient.name ?? 'N/A'}*`,
          `\n*Dados Pessoais:*`,
          `Nome: ${patient.name ?? 'N/A'}`,
          `Telefone: ${patientPhone}`,
          profile.birthDate ? `Data de nascimento: ${new Date(profile.birthDate).toLocaleDateString('pt-BR')}` : '',
          profile.age ? `Idade: ${profile.age} anos` : '',
          profile.weight ? `Peso: ${profile.weight}` : '',
          profile.gender ? `Sexo: ${profile.gender}` : '',
          `\n*Histórico Médico:*`,
          profile.familyHistory ? `Histórico familiar: ${profile.familyHistory}` : 'Histórico familiar: Não informado',
          profile.medications ? `Medicamentos: ${profile.medications}` : 'Medicamentos: Não informado',
          profile.caregiverProfession ? `Profissão do cuidador: ${profile.caregiverProfession}` : 'Profissão do cuidador: Não informado',
          profile.condition ? `Condição: ${profile.condition}` : '',
        ].filter(Boolean);
        
        await sendText(phone, profileLines.join('\n'));
      }
      
      // Voltar ao menu de ocorrência
      await sendOccurrenceMenu();
      return;
    }
    
    if (actionChoice === '3' || parsed?.selectedId === 'occurrence_action_3') {
      // Enviar contato do paciente
      const patient = await PlanService.getUserByPhone(patientPhone);
      const contactName = patient?.name ?? 'Paciente';
      
      await sendContact(phone, contactName, patientPhone);
      
      // Voltar ao menu de ocorrência
      await sendOccurrenceMenu();
      return;
    }
    
    if (actionChoice === '4' || parsed?.selectedId === 'occurrence_action_4') {
      // Voltar ao menu principal
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }
    
    // Resposta inválida
    await sendText(phone, 'Opção inválida. Selecione uma opção da lista.');
    await sendOccurrenceMenu();
    return;
  }

  if (state.state === 'AWAIT_EDIT_PLAN_ID') {
    // Redirecionar para seleção por lista (fluxo atualizado)
    if (isBackToMenu(text)) {
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }
    
    const patients = await PlanService.listPatients();
    if (patients.length === 0) {
      await sendText(phone, 'Nenhum paciente cadastrado.');
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }
    
    const patientsList = patients.map((p, index) => ({
      id: p.id,
      phone: p.phone,
      name: p.name,
    }));
    
    const patientSections = [{
      title: 'Pacientes',
      rows: patients.map((p, index) => ({
        id: `patient_${index}`,
        title: `${p.name ?? 'Sem nome'}`,
        description: p.phone,
      })),
    }];
    
    setAdminState(phone, { 
      state: 'AWAIT_PATIENT_SELECTION', 
      data: { patientsList, selectionMode: 'EDIT' } 
    });
    await sendText(phone, `*Selecione o paciente para editar o plano:*${ADMIN_BACK_HINT}`);
    await sendListMessage(
      phone,
      'Selecione o paciente',
      'Escolha um paciente da lista:',
      'Ver pacientes',
      patientSections
    );
    return;
  }

  if (state.state === 'AWAIT_EDIT_MENU') {
    if (isBackToMenu(text)) {
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }
    
    const planId = state.data?.planId;
    if (!planId) {
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }
    
    // Função auxiliar para reenviar o menu de edição
    const sendEditMenu = async () => {
      const plan = await PlanService.getPlanById(planId);
      if (!plan) {
        setAdminState(phone, { state: 'MENU' });
        await sendAdminMenu(phone);
        return;
      }
      
      const taskList = plan.tasks.map((t, i) => {
        const timeDisplay = formatTaskTime(t);
        return `${i + 1}. ${timeDisplay ? timeDisplay + ' - ' : ''}${t.title}`;
      }).join('\n');
      
      await sendText(phone, `*Tarefas atuais:*\n${taskList}\n\nSelecione uma ação:`);
      
      const editSections: ListSection[] = [
        {
          title: 'Ações de edição',
          rows: [
            { id: 'edit_add', title: '➕ Adicionar tarefa', description: 'Adicionar novas tarefas ao plano' },
            { id: 'edit_remove', title: '➖ Remover tarefa', description: 'Remover tarefas do plano' },
            { id: 'edit_schedule', title: '⏰ Editar agendamento', description: 'Alterar horário/intervalo de uma tarefa' },
            { id: 'edit_cancel', title: '❌ Cancelar e voltar', description: 'Cancelar edição e voltar ao menu principal' },
          ],
        },
      ];
      
      await sendListMessage(
        phone,
        'Editar plano',
        'Selecione uma ação:',
        'Ver opções',
        editSections
      );
    };
    
    // Processar resposta da lista ou texto digitado
    let actionChoice = text.trim();
    
    if (parsed?.isListReply && parsed.selectedId) {
      if (parsed.selectedId === 'edit_add') {
        actionChoice = 'add';
      } else if (parsed.selectedId === 'edit_remove') {
        actionChoice = 'remove';
      } else if (parsed.selectedId === 'edit_schedule') {
        actionChoice = 'schedule';
      } else if (parsed.selectedId === 'edit_cancel') {
        actionChoice = 'cancel';
      }
    }
    
    if (actionChoice === 'cancel' || actionChoice === '4' || parsed?.selectedId === 'edit_cancel') {
      // Cancelar e voltar ao menu principal
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }
    
    if (actionChoice === 'add' || actionChoice === '1') {
      // Adicionar tarefa - mostrar tarefas que não estão no plano
      const plan = await PlanService.getPlanById(planId);
      if (!plan) {
        setAdminState(phone, { state: 'MENU' });
        await sendAdminMenu(phone);
        return;
      }
      
      const existingTasks = plan.tasks.map(t => t.title);
      const availableTasks = PlanService.PREDEFINED_TASKS.filter(task => !existingTasks.includes(task));
      
      if (availableTasks.length === 0) {
        await sendText(phone, 'Todas as tarefas já estão no plano.');
        await sendEditMenu();
        return;
      }
      
      const tasksList = availableTasks.map((task, index) => `${index + 1}. ${task}`).join('\n');
      setAdminState(phone, { state: 'AWAIT_EDIT_ADD', data: { planId } });
      await sendText(phone, `*Tarefas disponíveis para adicionar:*\n\n${tasksList}\n\nDigite os números das tarefas separados por vírgula ou espaço (ex: 1,3,5 ou 1 3 5):${ADMIN_BACK_HINT}`);
      return;
    }
    
    if (actionChoice === 'remove' || actionChoice === '2') {
      // Remover tarefa - mostrar tarefas que estão no plano
      const plan = await PlanService.getPlanById(planId);
      if (!plan || plan.tasks.length === 0) {
        await sendText(phone, 'Plano sem tarefas para remover.');
        await sendEditMenu();
        return;
      }
      
      const tasksList = plan.tasks.map((t, i) => {
        const timeDisplay = formatTaskTime(t);
        return `${i + 1}. ${timeDisplay ? timeDisplay + ' - ' : ''}${t.title}`;
      }).join('\n');
      
      setAdminState(phone, { state: 'AWAIT_EDIT_REMOVE', data: { planId } });
      await sendText(phone, `*Tarefas do plano:*\n\n${tasksList}\n\nDigite os números das tarefas para remover separados por vírgula ou espaço (ex: 1,3 ou 1 3):${ADMIN_BACK_HINT}`);
      return;
    }
    
    if (actionChoice === 'schedule' || actionChoice === '3') {
      // Editar agendamento - mostrar lista de tarefas para selecionar
      const plan = await PlanService.getPlanById(planId);
      if (!plan || plan.tasks.length === 0) {
        await sendText(phone, 'Plano sem tarefas para editar.');
        await sendEditMenu();
        return;
      }
      
      const taskSections: ListSection[] = [
        {
          title: 'Tarefas do plano',
          rows: plan.tasks.map((t, i) => {
            const timeDisplay = formatTaskTime(t);
            return {
              id: `edit_task_${i}`,
              title: `${timeDisplay ? timeDisplay + ' - ' : ''}${t.title}`,
              description: 'Clique para editar o agendamento',
            };
          }),
        },
      ];
      
      setAdminState(phone, { state: 'AWAIT_EDIT_SCHEDULE_SELECT', data: { planId } });
      await sendText(phone, `*Selecione a tarefa para editar o agendamento:*${ADMIN_BACK_HINT}`);
      await sendListMessage(
        phone,
        'Editar agendamento',
        'Escolha a tarefa:',
        'Ver tarefas',
        taskSections
      );
      return;
    }
    
    // Resposta inválida
    await sendText(phone, 'Opção inválida. Selecione uma opção da lista.');
    await sendEditMenu();
    return;
  }

  if (state.state === 'AWAIT_EDIT_ADD') {
    if (isBackToMenu(text)) {
      const planId = state.data?.planId;
      if (planId) {
        setAdminState(phone, { state: 'AWAIT_EDIT_MENU', data: { planId } });
        // Reenviar menu de edição
        const plan = await PlanService.getPlanById(planId);
        if (plan) {
          const taskList = plan.tasks.map((t, i) => {
            const timeDisplay = formatTaskTime(t);
            return `${i + 1}. ${timeDisplay ? timeDisplay + ' - ' : ''}${t.title}`;
          }).join('\n');
          
          await sendText(phone, `*Tarefas atuais:*\n${taskList}\n\nSelecione uma ação:`);
          
          const editSections: ListSection[] = [
            {
              title: 'Ações de edição',
              rows: [
                { id: 'edit_add', title: '➕ Adicionar tarefa', description: 'Adicionar novas tarefas ao plano' },
                { id: 'edit_remove', title: '➖ Remover tarefa', description: 'Remover tarefas do plano' },
                { id: 'edit_schedule', title: '⏰ Editar agendamento', description: 'Alterar horário/intervalo de uma tarefa' },
                { id: 'edit_cancel', title: '❌ Cancelar e voltar', description: 'Cancelar edição e voltar ao menu principal' },
              ],
            },
          ];
          
          await sendListMessage(
            phone,
            'Editar plano',
            'Selecione uma ação:',
            'Ver opções',
            editSections
          );
        }
      }
      return;
    }
    
    const planId = state.data?.planId;
    if (!planId) {
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }
    
    const plan = await PlanService.getPlanById(planId);
    if (!plan) {
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }
    
    const existingTasks = plan.tasks.map(t => t.title);
    const availableTasks = PlanService.PREDEFINED_TASKS.filter(task => !existingTasks.includes(task));
    
    // Processar números: 1,3,5 ou 1 3 5
    const selectedNumbers = text
      .split(/[,\s]+/)
      .map((n) => parseInt(n.trim(), 10))
      .filter((n) => !Number.isNaN(n) && n >= 1 && n <= availableTasks.length);
    
    if (selectedNumbers.length === 0) {
      await sendText(phone, 'Números inválidos. Digite os números das tarefas separados por vírgula ou espaço.');
      return;
    }
    
    // Obter tarefas selecionadas
    const tasksToAdd = selectedNumbers.map(n => availableTasks[n - 1]).filter(Boolean);
    const uniqueTasks = [...new Set(tasksToAdd)];
    
    if (uniqueTasks.length === 0) {
      await sendText(phone, 'Nenhuma tarefa válida selecionada.');
      return;
    }
    
    // Verificar se tem "Horários de medicação"
    const hasMedication = uniqueTasks.includes('Horários de medicação');
    
    if (hasMedication) {
      // Se tem medicação, pedir lista de remédios primeiro
      setAdminState(phone, { 
        state: 'AWAIT_EDIT_ADD_MEDICATION', 
        data: { planId, selectedTasks: uniqueTasks } 
      });
      await sendText(phone, `*Horários de medicação selecionado*\n\nDigite os nomes dos remédios separados por vírgula ou espaço:\n\nExemplo: Aspirina, Metformina, Insulina\nou\nAspirina Metformina Insulina\n\n${ADMIN_BACK_HINT}`);
      return;
    }
    
    // Se não tem medicação, ir direto para configurar intervalos
    const taskIntervals: Record<string, number | null> = {};
    setAdminState(phone, {
      state: 'AWAIT_EDIT_ADD_INTERVAL',
      data: {
        planId,
        selectedTasks: uniqueTasks,
        taskIntervals,
        currentTaskIndex: 0,
      },
    });
    
    await sendText(phone, `✓ ${uniqueTasks.length} tarefa(s) selecionada(s):\n${uniqueTasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nAgora vamos configurar os intervalos de alerta.`);
    
    await processNextEditAddInterval(phone, planId, uniqueTasks, 0, taskIntervals);
    return;
  }

  if (state.state === 'AWAIT_EDIT_REMOVE') {
    if (isBackToMenu(text)) {
      const planId = state.data?.planId;
      if (planId) {
        setAdminState(phone, { state: 'AWAIT_EDIT_MENU', data: { planId } });
        // Reenviar menu de edição (mesmo código de acima)
        const plan = await PlanService.getPlanById(planId);
        if (plan) {
          const taskList = plan.tasks.map((t, i) => {
            const timeDisplay = formatTaskTime(t);
            return `${i + 1}. ${timeDisplay ? timeDisplay + ' - ' : ''}${t.title}`;
          }).join('\n');
          
          await sendText(phone, `*Tarefas atuais:*\n${taskList}\n\nSelecione uma ação:`);
          
          const editSections: ListSection[] = [
            {
              title: 'Ações de edição',
              rows: [
                { id: 'edit_add', title: '➕ Adicionar tarefa', description: 'Adicionar novas tarefas ao plano' },
                { id: 'edit_remove', title: '➖ Remover tarefa', description: 'Remover tarefas do plano' },
                { id: 'edit_schedule', title: '⏰ Editar agendamento', description: 'Alterar horário/intervalo de uma tarefa' },
                { id: 'edit_cancel', title: '❌ Cancelar e voltar', description: 'Cancelar edição e voltar ao menu principal' },
              ],
            },
          ];
          
          await sendListMessage(
            phone,
            'Editar plano',
            'Selecione uma ação:',
            'Ver opções',
            editSections
          );
        }
      }
      return;
    }
    
    const planId = state.data?.planId;
    if (!planId) {
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }
    
    const plan = await PlanService.getPlanById(planId);
    if (!plan || plan.tasks.length === 0) {
      await sendText(phone, 'Plano sem tarefas.');
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }
    
    // Processar números: 1,3,5 ou 1 3 5
    const selectedNumbers = text
      .split(/[,\s]+/)
      .map((n) => parseInt(n.trim(), 10))
      .filter((n) => !Number.isNaN(n) && n >= 1 && n <= plan.tasks.length);
    
    if (selectedNumbers.length === 0) {
      await sendText(phone, 'Números inválidos. Digite os números das tarefas para remover separados por vírgula ou espaço.');
      return;
    }
    
    // Remover tarefas (em ordem reversa para não afetar os índices)
    const sortedNumbers = [...selectedNumbers].sort((a, b) => b - a);
    for (const num of sortedNumbers) {
      const taskToRemove = plan.tasks[num - 1];
      if (taskToRemove) {
        await PlanService.removePlanTask(taskToRemove.id);
      }
    }
    
    const updated = await PlanService.getPlanById(planId);
    if (updated && updated.tasks.length > 0) {
      const taskList = updated.tasks.map((t, i) => {
        const timeDisplay = formatTaskTime(t);
        return `${i + 1}. ${timeDisplay ? timeDisplay + ' - ' : ''}${t.title}`;
      }).join('\n');
      
      await sendText(phone, `✅ Tarefas removidas com sucesso!\n\n*Tarefas do plano:*\n${taskList}`);
      
      // Voltar ao menu de edição
      setAdminState(phone, { state: 'AWAIT_EDIT_MENU', data: { planId } });
      await sendText(phone, '\nSelecione uma ação:');
      
      const editSections: ListSection[] = [
        {
          title: 'Ações de edição',
          rows: [
            { id: 'edit_add', title: '➕ Adicionar tarefa', description: 'Adicionar novas tarefas ao plano' },
            { id: 'edit_remove', title: '➖ Remover tarefa', description: 'Remover tarefas do plano' },
            { id: 'edit_schedule', title: '⏰ Editar agendamento', description: 'Alterar horário/intervalo de uma tarefa' },
            { id: 'edit_cancel', title: '❌ Cancelar e voltar', description: 'Cancelar edição e voltar ao menu principal' },
          ],
        },
      ];
      
      await sendListMessage(
        phone,
        'Editar plano',
        'Selecione uma ação:',
        'Ver opções',
        editSections
      );
    } else {
      setAdminState(phone, { state: 'MENU' });
      await sendText(phone, '✅ Tarefas removidas. Plano sem tarefas. Edição encerrada.');
      await sendAdminMenu(phone);
    }
    return;
  }

  if (state.state === 'AWAIT_EDIT_SCHEDULE_SELECT') {
    if (isBackToMenu(text)) {
      const planId = state.data?.planId;
      if (planId) {
        setAdminState(phone, { state: 'AWAIT_EDIT_MENU', data: { planId } });
        // Reenviar menu de edição
        const plan = await PlanService.getPlanById(planId);
        if (plan) {
          const taskList = plan.tasks.map((t, i) => {
            const timeDisplay = formatTaskTime(t);
            return `${i + 1}. ${timeDisplay ? timeDisplay + ' - ' : ''}${t.title}`;
          }).join('\n');
          
          await sendText(phone, `*Tarefas atuais:*\n${taskList}\n\nSelecione uma ação:`);
          
          const editSections: ListSection[] = [
            {
              title: 'Ações de edição',
              rows: [
                { id: 'edit_add', title: '➕ Adicionar tarefa', description: 'Adicionar novas tarefas ao plano' },
                { id: 'edit_remove', title: '➖ Remover tarefa', description: 'Remover tarefas do plano' },
                { id: 'edit_schedule', title: '⏰ Editar agendamento', description: 'Alterar horário/intervalo de uma tarefa' },
                { id: 'edit_cancel', title: '❌ Cancelar e voltar', description: 'Cancelar edição e voltar ao menu principal' },
              ],
            },
          ];
          
          await sendListMessage(
            phone,
            'Editar plano',
            'Selecione uma ação:',
            'Ver opções',
            editSections
          );
        }
      }
      return;
    }
    
    const planId = state.data?.planId;
    if (!planId) {
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }
    
    const plan = await PlanService.getPlanById(planId);
    if (!plan || plan.tasks.length === 0) {
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }
    
    let selectedTask;
    
    // Verificar se é resposta de lista interativa
    if (parsed?.isListReply && parsed.selectedId) {
      const match = parsed.selectedId.match(/^edit_task_(\d+)$/);
      if (match) {
        const index = parseInt(match[1], 10);
        if (index >= 0 && index < plan.tasks.length) {
          selectedTask = plan.tasks[index];
        }
      }
    } else {
      // Fallback: processar número digitado
      const num = parseInt(text.trim(), 10);
      if (!Number.isNaN(num) && num >= 1 && num <= plan.tasks.length) {
        selectedTask = plan.tasks[num - 1];
      }
    }
    
    if (!selectedTask) {
      await sendText(phone, 'Tarefa inválida. Selecione uma tarefa da lista.');
      return;
    }
    
    // Ir para edição do agendamento
    setAdminState(phone, { state: 'AWAIT_EDIT_SCHEDULE', data: { planId, taskId: selectedTask.id } });
    
    // Enviar lista de intervalos
    const sections = PlanService.formatIntervalListSections();
    const timeDisplay = formatTaskTime(selectedTask);
    await sendListMessage(
      phone,
      `Editar: ${selectedTask.title}`,
      `Tarefa: ${timeDisplay ? timeDisplay + ' - ' : ''}${selectedTask.title}\n\nSelecione o novo intervalo de alerta:`,
      'Ver opções',
      sections
    );
    return;
  }

  if (state.state === 'AWAIT_EDIT_SCHEDULE') {
    if (isBackToMenu(text)) {
      const planId = state.data?.planId;
      if (planId) {
        setAdminState(phone, { state: 'AWAIT_EDIT_MENU', data: { planId } });
        // Reenviar menu de edição
        const plan = await PlanService.getPlanById(planId);
        if (plan) {
          const taskList = plan.tasks.map((t, i) => {
            const timeDisplay = formatTaskTime(t);
            return `${i + 1}. ${timeDisplay ? timeDisplay + ' - ' : ''}${t.title}`;
          }).join('\n');
          
          await sendText(phone, `*Tarefas atuais:*\n${taskList}\n\nSelecione uma ação:`);
          
          const editSections: ListSection[] = [
            {
              title: 'Ações de edição',
              rows: [
                { id: 'edit_add', title: '➕ Adicionar tarefa', description: 'Adicionar novas tarefas ao plano' },
                { id: 'edit_remove', title: '➖ Remover tarefa', description: 'Remover tarefas do plano' },
                { id: 'edit_schedule', title: '⏰ Editar agendamento', description: 'Alterar horário/intervalo de uma tarefa' },
                { id: 'edit_cancel', title: '❌ Cancelar e voltar', description: 'Cancelar edição e voltar ao menu principal' },
              ],
            },
          ];
          
          await sendListMessage(
            phone,
            'Editar plano',
            'Selecione uma ação:',
            'Ver opções',
            editSections
          );
        }
      }
      return;
    }
    
    const planId = state.data?.planId;
    const taskId = state.data?.taskId;
    
    if (!planId || !taskId) {
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }
    
    let interval: number | null = null;
    
    // Processar resposta da lista ou texto digitado
    if (parsed?.isListReply && parsed.selectedId) {
      interval = PlanService.parseIntervalFromList(parsed.selectedId);
    } else if (parsed?.isButtonReply && parsed.selectedId) {
      interval = PlanService.parseIntervalFromButton(parsed.selectedId);
    } else {
      // Fallback: processar texto digitado
      interval = PlanService.parseInterval(text.trim());
    }
    
    // Atualizar a tarefa no banco
    await prisma.planTask.update({
      where: { id: taskId },
      data: {
        intervalHours: interval,
        time: interval ? '00:00' : '00:00', // Manter 00:00 para tarefas com intervalo
      },
    });
    
    const updated = await PlanService.getPlanById(planId);
    if (updated) {
      const taskList = updated.tasks.map((t, i) => {
        const timeDisplay = formatTaskTime(t);
        return `${i + 1}. ${timeDisplay ? timeDisplay + ' - ' : ''}${t.title}`;
      }).join('\n');
      
      const intervalText = interval ? `A cada ${interval}h` : 'Sem intervalo';
      await sendText(phone, `✅ Agendamento atualizado para: ${intervalText}\n\n*Tarefas do plano:*\n${taskList}`);
      
      // Voltar ao menu de edição
      setAdminState(phone, { state: 'AWAIT_EDIT_MENU', data: { planId } });
      await sendText(phone, '\nSelecione uma ação:');
      
      const editSections: ListSection[] = [
        {
          title: 'Ações de edição',
          rows: [
            { id: 'edit_add', title: '➕ Adicionar tarefa', description: 'Adicionar novas tarefas ao plano' },
            { id: 'edit_remove', title: '➖ Remover tarefa', description: 'Remover tarefas do plano' },
            { id: 'edit_schedule', title: '⏰ Editar agendamento', description: 'Alterar horário/intervalo de uma tarefa' },
            { id: 'edit_cancel', title: '❌ Cancelar e voltar', description: 'Cancelar edição e voltar ao menu principal' },
          ],
        },
      ];
      
      await sendListMessage(
        phone,
        'Editar plano',
        'Selecione uma ação:',
        'Ver opções',
        editSections
      );
    }
    return;
  }

  if (state.state === 'AWAIT_EDIT_ADD_MEDICATION') {
    if (isBackToMenu(text)) {
      const planId = state.data?.planId;
      if (planId) {
        setAdminState(phone, { state: 'AWAIT_EDIT_MENU', data: { planId } });
        // Reenviar menu de edição
        const plan = await PlanService.getPlanById(planId);
        if (plan) {
          const taskList = plan.tasks.map((t, i) => {
            const timeDisplay = formatTaskTime(t);
            return `${i + 1}. ${timeDisplay ? timeDisplay + ' - ' : ''}${t.title}`;
          }).join('\n');
          
          await sendText(phone, `*Tarefas atuais:*\n${taskList}\n\nSelecione uma ação:`);
          
          const editSections: ListSection[] = [
            {
              title: 'Ações de edição',
              rows: [
                { id: 'edit_add', title: '➕ Adicionar tarefa', description: 'Adicionar novas tarefas ao plano' },
                { id: 'edit_remove', title: '➖ Remover tarefa', description: 'Remover tarefas do plano' },
                { id: 'edit_schedule', title: '⏰ Editar agendamento', description: 'Alterar horário/intervalo de uma tarefa' },
                { id: 'edit_cancel', title: '❌ Cancelar e voltar', description: 'Cancelar edição e voltar ao menu principal' },
              ],
            },
          ];
          
          await sendListMessage(
            phone,
            'Editar plano',
            'Selecione uma ação:',
            'Ver opções',
            editSections
          );
        }
      }
      return;
    }
    
    const planId = state.data?.planId;
    const selectedTasks = state.data?.selectedTasks || [];
    
    if (!planId) {
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }
    
    // Processar lista de remédios (separados por vírgula ou espaço)
    const medicationNames = text
      .split(/[,\s]+/)
      .map(m => m.trim())
      .filter(Boolean);
    
    if (medicationNames.length === 0) {
      await sendText(phone, 'Nenhum remédio informado. Digite os nomes dos remédios separados por vírgula ou espaço.');
      return;
    }
    
    // Criar tasks de medicação e remover "Horários de medicação" da lista
    const medications = medicationNames.map(name => `Medicação: ${name}`);
    const tasksWithoutMedication = selectedTasks.filter(t => t !== 'Horários de medicação');
    const allTasks = [...tasksWithoutMedication, ...medications];
    
    // Ir para configuração de intervalos
    const taskIntervals: Record<string, number | null> = {};
    setAdminState(phone, {
      state: 'AWAIT_EDIT_ADD_INTERVAL',
      data: {
        planId,
        selectedTasks: allTasks,
        taskIntervals,
        currentTaskIndex: 0,
      },
    });
    
    await sendText(phone, `✓ ${allTasks.length} tarefa(s) selecionada(s):\n${allTasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nAgora vamos configurar os intervalos de alerta.`);
    
    await processNextEditAddInterval(phone, planId, allTasks, 0, taskIntervals);
    return;
  }

  if (state.state === 'AWAIT_EDIT_ADD_INTERVAL') {
    if (isBackToMenu(text)) {
      const planId = state.data?.planId;
      if (planId) {
        setAdminState(phone, { state: 'AWAIT_EDIT_MENU', data: { planId } });
        // Reenviar menu de edição
        const plan = await PlanService.getPlanById(planId);
        if (plan) {
          const taskList = plan.tasks.map((t, i) => {
            const timeDisplay = formatTaskTime(t);
            return `${i + 1}. ${timeDisplay ? timeDisplay + ' - ' : ''}${t.title}`;
          }).join('\n');
          
          await sendText(phone, `*Tarefas atuais:*\n${taskList}\n\nSelecione uma ação:`);
          
          const editSections: ListSection[] = [
            {
              title: 'Ações de edição',
              rows: [
                { id: 'edit_add', title: '➕ Adicionar tarefa', description: 'Adicionar novas tarefas ao plano' },
                { id: 'edit_remove', title: '➖ Remover tarefa', description: 'Remover tarefas do plano' },
                { id: 'edit_schedule', title: '⏰ Editar agendamento', description: 'Alterar horário/intervalo de uma tarefa' },
                { id: 'edit_cancel', title: '❌ Cancelar e voltar', description: 'Cancelar edição e voltar ao menu principal' },
              ],
            },
          ];
          
          await sendListMessage(
            phone,
            'Editar plano',
            'Selecione uma ação:',
            'Ver opções',
            editSections
          );
        }
      }
      return;
    }
    
    const planId = state.data?.planId;
    const currentIndex = state.data?.currentTaskIndex ?? 0;
    const selectedTasks = state.data?.selectedTasks || [];
    const taskIntervals = state.data?.taskIntervals || {};
    const currentTask = selectedTasks[currentIndex];
    
    if (!currentTask || !planId) {
      await processNextEditAddInterval(phone, planId || '', selectedTasks, currentIndex, taskIntervals);
      return;
    }
    
    // Processar intervalo
    let interval: number | null = null;
    
    if (parsed?.isListReply && parsed.selectedId) {
      interval = PlanService.parseIntervalFromList(parsed.selectedId);
    } else if (parsed?.isButtonReply && parsed.selectedId) {
      interval = PlanService.parseIntervalFromButton(parsed.selectedId);
    } else {
      const intervalText = text.trim();
      if (intervalText && intervalText !== '0') {
        interval = PlanService.parseInterval(intervalText);
        if (interval === null) {
          await sendText(phone, 'Formato inválido. Selecione uma opção da lista.');
          const sections = PlanService.formatIntervalListSections();
          await sendListMessage(
            phone,
            `Intervalo: ${currentTask}`,
            `Para a tarefa "${currentTask}", selecione o intervalo de alerta:`,
            'Ver opções',
            sections
          );
          return;
        }
      }
    }
    
    taskIntervals[currentTask] = interval;
    
    // Próxima tarefa
    const nextIndex = currentIndex + 1;
    setAdminState(phone, {
      state: 'AWAIT_EDIT_ADD_INTERVAL',
      data: {
        planId,
        selectedTasks,
        taskIntervals,
        currentTaskIndex: nextIndex,
      },
    });
    
    await processNextEditAddInterval(phone, planId, selectedTasks, nextIndex, taskIntervals);
    return;
  }

  if (state.state === 'AWAIT_EDIT_ACTION') {
    if (isBackToMenu(text)) {
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }
    const planId = state.data?.planId;
    if (!planId) {
      setAdminState(phone, { state: 'MENU' });
      await sendAdminMenu(phone);
      return;
    }
    const line = text.trim();
    if (line.startsWith('+')) {
      const rest = line.slice(1).trim();
      const m = rest.match(/^(\d{1,2}:\d{2})\s+(.+)$/);
      if (m) {
        const plan = await PlanService.getPlanById(planId);
        if (plan) {
          await PlanService.addPlanTasks(planId, [{ time: m[1], title: m[2] }]);
          const updated = await PlanService.getPlanById(planId);
          const taskList = updated!.tasks.map((t, i) => `${i + 1}. ${t.time} ${t.title}`).join('\n');
          await sendText(phone, `Tarefa adicionada.\n\n${taskList}\n\n${ADMIN_EDIT_INSTRUCTIONS}${ADMIN_BACK_HINT}`);
        }
      } else {
        await sendText(phone, 'Use: + HH:mm Título');
      }
      return;
    }
    if (line.startsWith('-')) {
      const num = parseInt(line.slice(1).trim(), 10);
      const plan = await PlanService.getPlanById(planId);
      if (!plan || Number.isNaN(num) || num < 1 || num > plan.tasks.length) {
        await sendText(phone, 'Número inválido.');
        return;
      }
      const taskToRemove = plan.tasks[num - 1];
      await PlanService.removePlanTask(taskToRemove.id);
      const updated = await PlanService.getPlanById(planId);
      if (updated && updated.tasks.length > 0) {
        const taskList = updated.tasks.map((t, i) => `${i + 1}. ${t.time} ${t.title}`).join('\n');
        await sendText(phone, `Tarefa removida.\n\n${taskList}\n\n${ADMIN_EDIT_INSTRUCTIONS}${ADMIN_BACK_HINT}`);
      } else {
        setAdminState(phone, { state: 'MENU' });
        await sendText(phone, 'Plano sem tarefas. Edição encerrada.');
        await sendAdminMenu(phone);
      }
      return;
    }
    setAdminState(phone, { state: 'MENU' });
    await sendAdminMenu(phone);
  }
}

async function processNextTaskInterval(
  phone: string,
  patientPhone: string,
  selectedTasks: string[],
  index: number,
  taskIntervals: Record<string, number | null>
): Promise<void> {
  if (index >= selectedTasks.length) {
    await finalizePlanCreation(phone, patientPhone, selectedTasks, taskIntervals);
    return;
  }
  
  const task = selectedTasks[index];
  
  // Se for "Horários de medicação", perguntar os medicamentos (não pular)
  if (task === 'Horários de medicação') {
    setAdminState(phone, {
      state: 'AWAIT_MEDICATION_DETAILS',
      data: {
        patientPhone,
        selectedTasks,
        taskIntervals,
        currentTaskIndex: index,
      },
    });
    await sendText(phone, ADMIN_ASK_MEDICATION_DETAILS + ADMIN_BACK_HINT);
    return;
  }
  
  const sections = PlanService.formatIntervalListSections();
  // Incluir o nome da tarefa na mensagem da lista
  await sendListMessage(
    phone,
    `Intervalo: ${task}`,
    `Para a tarefa "${task}", selecione o intervalo de alerta:`,
    'Ver opções',
    sections
  );
}

async function finalizePlanCreation(
  phone: string,
  patientPhone: string,
  selectedTasks: string[],
  taskIntervals: Record<string, number | null>
): Promise<void> {
  const patient = await PlanService.getUserByPhone(patientPhone);
  if (!patient) {
    setAdminState(phone, { state: 'MENU' });
    await sendText(phone, 'Paciente não encontrado.');
    await sendAdminMenu(phone);
    return;
  }
  
  const tasks = selectedTasks.map((taskName) => {
    const interval = taskIntervals[taskName] ?? null;
    return {
      title: taskName,
      time: interval ? '00:00' : '00:00', // Para tarefas com intervalo, usar 00:00 como base
      intervalHours: interval,
    };
  });
  
  // Verificar se o paciente já tem um plano
  const existingPlans = await PlanService.getPlansByPatientPhone(patientPhone);
  if (existingPlans.length > 0) {
    // Atualizar o plano existente (pegar o mais recente)
    const existingPlan = existingPlans[0];
    await PlanService.updatePlanWithIntervals(existingPlan.id, tasks);
    setAdminState(phone, { state: 'MENU' });
    await sendText(phone, 'Plano atualizado com sucesso.');
  } else {
    // Criar novo plano
    await PlanService.createPlan(patient.id, 'Plano de cuidados', tasks);
    setAdminState(phone, { state: 'MENU' });
    await sendText(phone, ADMIN_PLAN_CREATED);
  }
  await sendAdminMenu(phone);
}

async function sendPatientMenu(phone: string): Promise<void> {
  // Usar lista de opções para o menu do paciente
  const sections: ListSection[] = [
    {
      title: 'Menu do Paciente',
      rows: [
        { id: 'patient_menu_1', title: '📋 Ver plano de hoje', description: 'Visualizar suas tarefas do dia' },
        { id: 'patient_menu_2', title: '✅ Registrar ação realizada', description: 'Marcar tarefa como realizada' },
        { id: 'patient_menu_3', title: '⚠️ Alerta de ocorrência', description: 'Reportar uma ocorrência' },
        { id: 'patient_menu_4', title: '💬 Falar com Enfermeiro', description: 'Enviar mensagem ao enfermeiro' },
      ],
    },
  ];
  
  await sendListMessage(
    phone,
    'Menu',
    'Menu do Paciente\nSelecione uma opção:',
    'Ver menu',
    sections
  );
}

async function notifyFamilyMembers(patientId: string, message: string): Promise<void> {
  try {
    const familyMembers = await PlanService.getFamilyMembers(patientId);
    for (const family of familyMembers) {
      try {
        await sendText(family.phone, message);
      } catch (error) {
        logger.error('Error notifying family member', { familyPhone: family.phone, error });
      }
    }
  } catch (error) {
    logger.error('Error fetching family members', { patientId, error });
  }
}

function formatTaskTime(task: { time: string; intervalHours?: number | null }): string {
  // Se tem intervalo, mostrar intervalo; senão, mostrar horário (se não for 00:00)
  if (task.intervalHours) {
    return `A cada ${task.intervalHours}h`;
  } else if (task.time && task.time !== '00:00') {
    return task.time;
  }
  return '';
}

async function processNextEditAddInterval(
  phone: string,
  planId: string,
  selectedTasks: string[],
  index: number,
  taskIntervals: Record<string, number | null>
): Promise<void> {
  if (index >= selectedTasks.length) {
    // Finalizar adição de tarefas ao plano
    // Adicionar tarefas uma por uma para poder definir intervalHours
    for (const taskName of selectedTasks) {
      const interval = taskIntervals[taskName] ?? null;
      await prisma.planTask.create({
        data: {
          planId,
          title: taskName,
          time: '00:00',
          intervalHours: interval,
        },
      });
    }
    
    const updated = await PlanService.getPlanById(planId);
    if (updated) {
      const taskList = updated.tasks.map((t, i) => {
        const timeDisplay = formatTaskTime(t);
        return `${i + 1}. ${timeDisplay ? timeDisplay + ' - ' : ''}${t.title}`;
      }).join('\n');
      
      await sendText(phone, `✅ Tarefas adicionadas com sucesso!\n\n*Tarefas do plano:*\n${taskList}`);
      
      // Voltar ao menu de edição
      setAdminState(phone, { state: 'AWAIT_EDIT_MENU', data: { planId } });
      await sendText(phone, '\nSelecione uma ação:');
      
      const editSections: ListSection[] = [
        {
          title: 'Ações de edição',
          rows: [
            { id: 'edit_add', title: '➕ Adicionar tarefa', description: 'Adicionar novas tarefas ao plano' },
            { id: 'edit_remove', title: '➖ Remover tarefa', description: 'Remover tarefas do plano' },
            { id: 'edit_schedule', title: '⏰ Editar agendamento', description: 'Alterar horário/intervalo de uma tarefa' },
            { id: 'edit_cancel', title: '❌ Cancelar e voltar', description: 'Cancelar edição e voltar ao menu principal' },
          ],
        },
      ];
      
      await sendListMessage(
        phone,
        'Editar plano',
        'Selecione uma ação:',
        'Ver opções',
        editSections
      );
    }
    return;
  }
  
  const task = selectedTasks[index];
  const sections = PlanService.formatIntervalListSections();
  await sendListMessage(
    phone,
    `Intervalo: ${task}`,
    `Para a tarefa "${task}", selecione o intervalo de alerta:`,
    'Ver opções',
    sections
  );
}

async function handleReturnToMenu(phone: string): Promise<void> {
  clearPatientState(phone);
  setPatientState(phone, { state: 'MENU' });
  await sendPatientMenu(phone);
  return;
}