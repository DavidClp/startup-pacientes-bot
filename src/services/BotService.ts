import { TaskLogStatus } from '@prisma/client';
import { env } from '../config/env';
import type { ConversationState, PatientState, AdminState } from '../bot/types';
import {
  REGISTER_WELCOME,
  REGISTER_ASK_NAME,
  REGISTER_ASK_AGE,
  REGISTER_ASK_CONDITION,
  REGISTER_DONE,
  PATIENT_MENU,
  ADMIN_MENU,
  ASK_ACTION_TASK,
  ACTION_CHOICES,
  ACTION_RECORDED,
  ASK_QUESTION,
  ASK_CONTACT_MESSAGE,
  CONTACT_SENT,
  ADMIN_ASK_PHONE_STATUS,
  ADMIN_ASK_PHONE_PLAN,
  ADMIN_ASK_TASKS,
  ADMIN_PLAN_CREATED,
  ADMIN_ASK_PLAN_ID_EDIT,
  ADMIN_EDIT_INSTRUCTIONS,
} from '../bot/states';
import * as PlanService from './PlanService';
import { sendText } from './WhatsAppService';
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

export async function handleIncomingMessage(phone: string, text: string): Promise<void> {
  const isAdmin = phone === env.DOCTOR_PHONE;

  if (isAdmin) {
    await handleAdminMessage(phone, text);
    return;
  }

  await handlePatientMessage(phone, text);
}

async function handlePatientMessage(phone: string, text: string): Promise<void> {
  const state = getPatientState(phone);
  const user = await PlanService.getUserByPhone(phone);

  console.log('user', user);
  console.log('state', state);
  console.log('text', text);

  if (!user) {
    if (state?.state === 'REGISTER_NAME') {
      await PlanService.createUser(phone, text.trim() || null, 'PATIENT');
      setPatientState(phone, { state: 'REGISTER_AGE' });
      await sendText(phone, REGISTER_ASK_AGE);
      return;
    }
    await startRegistration(phone, text);
    return;
  }

  if (!user.patientProfile) {
    await continueRegistration(phone, text, state);
    return;
  }

  if (state?.state === 'AWAIT_ACTION_CHOICE' && state.data?.taskId) {
    const choice = text.trim();
    if (choice === '1' || choice === '2' || choice === '3') {
      const status: TaskLogStatus = choice === '1' ? 'DONE' : choice === '2' ? 'NOT_DONE' : 'REFUSED';
      await PlanService.recordTaskLog(state.data.taskId, new Date(), status);
      await sendText(phone, ACTION_RECORDED);
      setPatientState(phone, { state: 'MENU' });
      await sendText(phone, PATIENT_MENU);
      return;
    }
  }

  if (state?.state === 'AWAIT_QUESTION') {
    clearPatientState(phone);
    const answer = await answerHealthQuestion(text);
    await sendText(phone, answer);
    setPatientState(phone, { state: 'MENU' });
    await sendText(phone, PATIENT_MENU);
    return;
  }

  if (state?.state === 'AWAIT_CONTACT_MESSAGE') {
    clearPatientState(phone);
    const msg = `Paciente: ${user.name ?? 'N/A'}\nTel: ${phone}\nMensagem: ${text}`;
    await sendText(env.DOCTOR_PHONE, msg);
    await sendText(phone, CONTACT_SENT);
    setPatientState(phone, { state: 'MENU' });
    await sendText(phone, PATIENT_MENU);
    return;
  }

  const menuChoice = text.trim();
  if (menuChoice === '1') {
    const plan = await PlanService.getTodayPlan(user.id);
    if (!plan || plan.tasks.length === 0) {
      await sendText(phone, 'Você ainda não tem plano cadastrado ou não há tarefas para hoje.');
    } else {
      const lines = plan.tasks.map((t, i) => `${i + 1}. ${t.time} - ${t.title}`);
      await sendText(phone, `*Plano de hoje*\n\n${lines.join('\n')}`);
    }
    await sendText(phone, PATIENT_MENU);
    return;
  }

  if (menuChoice === '2') {
    const plan = await PlanService.getTodayPlan(user.id);
    if (!plan || plan.tasks.length === 0) {
      await sendText(phone, 'Não há tarefas no plano para registrar.');
      await sendText(phone, PATIENT_MENU);
      return;
    }
    const lines = plan.tasks.map((t, i) => `${i + 1}. ${t.time} - ${t.title}`);
    await sendText(phone, `${ASK_ACTION_TASK}\n\n${lines.join('\n')}`);
    setPatientState(phone, { state: 'AWAIT_ACTION_TASK_ID', data: {} });
    return;
  }

  if (state?.state === 'AWAIT_ACTION_TASK_ID') {
    const plan = await PlanService.getTodayPlan(user.id);
    if (!plan) {
      setPatientState(phone, { state: 'MENU' });
      await sendText(phone, PATIENT_MENU);
      return;
    }
    const num = parseInt(text.trim(), 10);
    if (Number.isNaN(num) || num < 1 || num > plan.tasks.length) {
      await sendText(phone, 'Número inválido. Digite o número da tarefa da lista.');
      return;
    }
    const task = plan.tasks[num - 1];
    setPatientState(phone, { state: 'AWAIT_ACTION_CHOICE', data: { taskId: task.id } });
    await sendText(phone, `${task.time} - ${task.title}\n\n${ACTION_CHOICES}`);
    return;
  }

  if (menuChoice === '3') {
    setPatientState(phone, { state: 'AWAIT_QUESTION' });
    await sendText(phone, ASK_QUESTION);
    return;
  }

  if (menuChoice === '4') {
    setPatientState(phone, { state: 'AWAIT_CONTACT_MESSAGE' });
    await sendText(phone, ASK_CONTACT_MESSAGE);
    return;
  }

  setPatientState(phone, { state: 'MENU' });
  await sendText(phone, PATIENT_MENU);
}

async function startRegistration(phone: string, _text: string): Promise<void> {
  console.log('startRegistration', phone, _text);
  setPatientState(phone, { state: 'REGISTER_NAME' });
  await sendText(phone, REGISTER_WELCOME);
  await sendText(phone, REGISTER_ASK_NAME);
}

async function continueRegistration(
  phone: string,
  text: string,
  state: ConversationState | undefined
): Promise<void> {
  const current = (state?.state ?? 'REGISTER_NAME') as PatientState;

  if (current === 'REGISTER_NAME') {
    await PlanService.createUser(phone, text.trim() || null, 'PATIENT');
    setPatientState(phone, { state: 'REGISTER_AGE' });
    await sendText(phone, REGISTER_ASK_AGE);
    return;
  }

  const user = await PlanService.getUserByPhone(phone);
  if (!user) {
    await startRegistration(phone, text);
    return;
  }

  if (current === 'REGISTER_AGE') {
    const age = parseInt(text.trim(), 10);
    await PlanService.updatePatientProfile(user.id, {
      age: Number.isNaN(age) ? undefined : age,
    });
    setPatientState(phone, { state: 'REGISTER_CONDITION' });
    await sendText(phone, REGISTER_ASK_CONDITION);
    return;
  }

  if (current === 'REGISTER_CONDITION') {
    await PlanService.updatePatientProfile(user.id, { condition: text.trim() || undefined });
    setPatientState(phone, { state: 'MENU' });
    await sendText(phone, REGISTER_DONE);
    await sendText(phone, PATIENT_MENU);
    return;
  }

  setPatientState(phone, { state: 'REGISTER_NAME' });
  await sendText(phone, REGISTER_ASK_NAME);
}

async function handleAdminMessage(phone: string, text: string): Promise<void> {
  await PlanService.getOrCreateAdmin(phone);
  const state = getAdminState(phone);
  const choice = text.trim();

  if (!state || state.state === 'MENU') {
    if (choice === '1') {
      const patients = await PlanService.listPatients();
      if (patients.length === 0) {
        await sendText(phone, 'Nenhum paciente cadastrado.');
      } else {
        const lines = patients.map((p) => `${p.name ?? 'Sem nome'} - ${p.phone}`);
        await sendText(phone, `*Pacientes*\n\n${lines.join('\n')}`);
      }
      await sendText(phone, ADMIN_MENU);
      return;
    }
    if (choice === '2') {
      setAdminState(phone, { state: 'AWAIT_PATIENT_PHONE_STATUS' });
      await sendText(phone, ADMIN_ASK_PHONE_STATUS);
      return;
    }
    if (choice === '3') {
      setAdminState(phone, { state: 'AWAIT_PATIENT_PHONE_PLAN' });
      await sendText(phone, ADMIN_ASK_PHONE_PLAN);
      return;
    }
    if (choice === '4') {
      setAdminState(phone, { state: 'AWAIT_EDIT_PLAN_ID' });
      await sendText(phone, ADMIN_ASK_PLAN_ID_EDIT);
      return;
    }
    await sendText(phone, ADMIN_MENU);
    return;
  }

  if (state.state === 'AWAIT_PATIENT_PHONE_STATUS') {
    const patient = await PlanService.getUserByPhone(text.trim());
    if (!patient || patient.role !== 'PATIENT') {
      await sendText(phone, 'Paciente não encontrado. Digite o telefone (apenas números):');
      return;
    }
    const status = await PlanService.getPatientStatus(patient.id, new Date());
    setAdminState(phone, { state: 'MENU' });

    if (!status.plan) {
      await sendText(phone, 'Paciente sem plano cadastrado.');
    } else {
      const taskStatus = status.tasks.map((t) => {
        const log = status.logs.find((l) => l.taskId === t.id);
        const st = log ? (log.status === 'DONE' ? 'FEZ' : log.status === 'NOT_DONE' ? 'NÃO FEZ' : 'RECUSOU') : '-';
        return `${t.time} ${t.title}: ${st}`;
      });
      await sendText(
        phone,
        `*Status - ${patient.name ?? patient.phone}*\n\n${taskStatus.join('\n')}\n\nAdesão ao plano hoje: ${status.adherencePercent}%`
      );
    }
    await sendText(phone, ADMIN_MENU);
    return;
  }

  if (state.state === 'AWAIT_PATIENT_PHONE_PLAN') {
    const patient = await PlanService.getUserByPhone(text.trim());
    if (!patient || patient.role !== 'PATIENT') {
      await sendText(phone, 'Paciente não encontrado. Digite o telefone (apenas números):');
      return;
    }
    setAdminState(phone, { state: 'AWAIT_PLAN_TASKS', data: { patientPhone: patient.phone } });
    await sendText(phone, ADMIN_ASK_TASKS);
    return;
  }

  if (state.state === 'AWAIT_PLAN_TASKS') {
    const patientPhone = state.data?.patientPhone;
    if (!patientPhone) {
      setAdminState(phone, { state: 'MENU' });
      await sendText(phone, ADMIN_MENU);
      return;
    }
    const patient = await PlanService.getUserByPhone(patientPhone);
    if (!patient) {
      setAdminState(phone, { state: 'MENU' });
      await sendText(phone, ADMIN_MENU);
      return;
    }
    const tasks = parsePlanTasksInput(text);
    if (tasks.length === 0) {
      await sendText(phone, 'Nenhuma tarefa válida. Use o formato HH:mm Título por linha.');
      return;
    }
    await PlanService.createPlan(patient.id, 'Plano de cuidados', tasks);
    setAdminState(phone, { state: 'MENU' });
    await sendText(phone, ADMIN_PLAN_CREATED);
    await sendText(phone, ADMIN_MENU);
    return;
  }

  if (state.state === 'AWAIT_EDIT_PLAN_ID') {
    const input = text.trim();
    const byPhone = /^\d+$/.test(input);
    if (byPhone) {
      const plans = await PlanService.getPlansByPatientPhone(input);
      if (plans.length === 0) {
        await sendText(phone, 'Nenhum plano encontrado para este paciente.');
        await sendText(phone, ADMIN_MENU);
        setAdminState(phone, { state: 'MENU' });
        return;
      }
      const plan = plans[0];
      const taskList = plan.tasks.map((t, i) => `${i + 1}. ${t.time} ${t.title}`).join('\n');
      setAdminState(phone, { state: 'AWAIT_EDIT_ACTION', data: { planId: plan.id } });
      await sendText(phone, `Plano: ${plan.title}\n\n${taskList}\n\n${ADMIN_EDIT_INSTRUCTIONS}`);
      return;
    }
    const plan = await PlanService.getPlanById(input);
    if (!plan) {
      await sendText(phone, 'Plano não encontrado. Digite o ID do plano ou telefone do paciente:');
      return;
    }
    const taskList = plan.tasks.map((t, i) => `${i + 1}. ${t.time} ${t.title}`).join('\n');
    setAdminState(phone, { state: 'AWAIT_EDIT_ACTION', data: { planId: plan.id } });
    await sendText(phone, `Plano: ${plan.title}\n\n${taskList}\n\n${ADMIN_EDIT_INSTRUCTIONS}`);
    return;
  }

  if (state.state === 'AWAIT_EDIT_ACTION') {
    const planId = state.data?.planId;
    if (!planId) {
      setAdminState(phone, { state: 'MENU' });
      await sendText(phone, ADMIN_MENU);
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
          await sendText(phone, `Tarefa adicionada.\n\n${taskList}\n\n${ADMIN_EDIT_INSTRUCTIONS}`);
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
        await sendText(phone, `Tarefa removida.\n\n${taskList}\n\n${ADMIN_EDIT_INSTRUCTIONS}`);
      } else {
        setAdminState(phone, { state: 'MENU' });
        await sendText(phone, 'Plano sem tarefas. Edição encerrada.');
        await sendText(phone, ADMIN_MENU);
      }
      return;
    }
    setAdminState(phone, { state: 'MENU' });
    await sendText(phone, ADMIN_MENU);
  }
}
