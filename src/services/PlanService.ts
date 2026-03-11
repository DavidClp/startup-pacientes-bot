import { Role, TaskLogStatus } from '@prisma/client';
import { prisma } from '../database/client';
import { normalizePhone } from '../config/env';
import type { ListSection } from './WhatsAppService';

export const PREDEFINED_TASKS = [
  'Sinais Vitais Básicos',
  'Pressão',
  'Temperatura',
  'Frequência Cardíaca',
  'Hidratação',
  'Movimentação Corporal',
  'Alimentação',
  'Horários de medicação',
  'Troca de curativo',
  'Diurese',
  'Evacuação',
  'Saturação',
  'Outra coisa',
] as const;

export type PredefinedTask = typeof PREDEFINED_TASKS[number];

export function isPredefinedTask(task: string): task is PredefinedTask {
  return PREDEFINED_TASKS.includes(task as PredefinedTask);
}

export function parseInterval(intervalStr: string): number | null {
  const match = intervalStr.match(/^(\d+)h$/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

export function formatTaskList(tasks: string[]): string {
  return tasks.map((task, index) => `${index + 1} - ${task}`).join('\n');
}

export interface ButtonOption {
  id: string;
  text: string;
}

export function formatTasksAsListSections(): ListSection[] {
  const rows = PREDEFINED_TASKS.map((task, index) => ({
    id: `task_${index}`,
    title: task,
    description: '',
  }));

  // Dividir em seções se necessário (máximo 10 itens por seção)
  const sections: ListSection[] = [];
  for (let i = 0; i < rows.length; i += 10) {
    sections.push({
      title: 'Tarefas',
      rows: rows.slice(i, i + 10),
    });
  }

  return sections;
}

export function formatIntervalButtons(): ButtonOption[] {
  return [
    { id: 'interval_0', text: 'Sem alerta' },
    { id: 'interval_6', text: 'A cada 6h' },
    { id: 'interval_12', text: 'A cada 12h' },
    { id: 'interval_24', text: 'A cada 24h' },
  ];
}

export function formatIntervalListSections(): ListSection[] {
  return [
    {
      title: 'Intervalos',
      rows: [
        { id: 'interval_0', title: 'Nenhum', description: 'Sem alerta automático' },
        { id: 'interval_4', title: 'A cada 4h', description: 'Alerta a cada 4 horas' },
        { id: 'interval_6', title: 'A cada 6h', description: 'Alerta a cada 6 horas' },
        { id: 'interval_8', title: 'A cada 8h', description: 'Alerta a cada 8 horas' },
        { id: 'interval_12', title: 'A cada 12h', description: 'Alerta a cada 12 horas' },
      ],
    },
  ];
}

export function parseIntervalFromList(listId: string): number | null {
  const match = listId.match(/^interval_(\d+)$/);
  if (match) {
    const hours = parseInt(match[1], 10);
    return hours === 0 ? null : hours;
  }
  return null;
}

export function parseIntervalFromButton(buttonId: string): number | null {
  const match = buttonId.match(/^interval_(\d+)$/);
  if (match) {
    const hours = parseInt(match[1], 10);
    return hours === 0 ? null : hours;
  }
  return null;
}

export function parseTaskFromList(listId: string): number | null {
  const match = listId.match(/^task_(\d+)$/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

export async function getUserByPhone(phone: string) {
  const normalized = normalizePhone(phone);
  return prisma.user.findUnique({
    where: { phone: normalized },
    include: { patientProfile: true },
  });
}

export async function createUser(phone: string, name: string | null, role: Role) {
  const normalized = normalizePhone(phone);
  return prisma.user.create({
    data: { phone: normalized, name, role },
  });
}

/** Cria ou atualiza paciente por telefone (evita P2002 quando estado do bot se perde) */
export async function ensurePatientUser(phone: string, name: string | null) {
  const normalized = normalizePhone(phone);
  const existing = await prisma.user.findUnique({
    where: { phone: normalized },
    include: { patientProfile: true },
  });
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: { name: name ?? existing.name },
      include: { patientProfile: true },
    });
  }
  return prisma.user.create({
    data: { phone: normalized, name, role: 'PATIENT' },
    include: { patientProfile: true },
  });
}

export async function getOrCreateAdmin(doctorPhone: string) {
  const normalized = normalizePhone(doctorPhone);
  let user = await prisma.user.findUnique({ where: { phone: normalized } });
  if (!user) {
    user = await prisma.user.create({
      data: { phone: normalized, role: 'ADMIN' },
    });
  } else if (user.role !== 'ADMIN') {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { role: 'ADMIN' },
    });
  }
  return user;
}

export async function getPatientProfile(userId: string) {
  return prisma.patientProfile.findUnique({
    where: { userId },
  });
}

export interface ParsedPatientData {
  name?: string;
  birthDate?: Date;
  age?: number;
  weight?: string;
  gender?: string;
  familyHistory?: string;
  medications?: string;
  caregiverProfession?: string;
}

export function parsePatientData(text: string): ParsedPatientData {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  
  const data: ParsedPatientData = {};
  
  // Linha 1: Nome
  if (lines[0]) {
    data.name = lines[0];
  }
  
  // Linha 2: Data de nascimento (formato DD/MM/YYYY ou YYYY-MM-DD)
  if (lines[1]) {
    const dateStr = lines[1];
    // Tentar formato DD/MM/YYYY
    const ddmmyyyy = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (ddmmyyyy) {
      const [, day, month, year] = ddmmyyyy;
      data.birthDate = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
    } else {
      // Tentar formato YYYY-MM-DD ou outros formatos
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
        data.birthDate = parsed;
      }
    }
  }
  
  // Linha 3: Idade
  if (lines[2]) {
    const age = parseInt(lines[2], 10);
    if (!Number.isNaN(age)) {
      data.age = age;
    }
  }
  
  // Linha 4: Peso
  if (lines[3]) {
    data.weight = lines[3];
  }
  
  // Linha 5: Sexo
  if (lines[4]) {
    data.gender = lines[4];
  }
  
  // Linha 6: Histórico familiar
  if (lines[5]) {
    data.familyHistory = lines[5];
  }
  
  // Linha 7: Medicamentos de uso
  if (lines[6]) {
    data.medications = lines[6];
  }
  
  // Linha 8: Profissão do cuidador
  if (lines[7]) {
    data.caregiverProfession = lines[7];
  }
  
  return data;
}

export async function updatePatientProfile(
  userId: string,
  data: {
    age?: number;
    birthDate?: Date;
    weight?: string;
    gender?: string;
    familyHistory?: string;
    medications?: string;
    caregiverProfession?: string;
    condition?: string;
  }
) {
  return prisma.patientProfile.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

export async function getTodayPlan(patientId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const plan = await prisma.plan.findFirst({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    include: {
      tasks: { orderBy: { time: 'asc' } },
    },
  });

  return plan;
}

function getNowHHmm(): string {
  const d = new Date();
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

export async function getTasksDueNow() {
  const now = getNowHHmm();
  const nowDate = new Date();
  
  // Buscar tarefas com horário fixo (comportamento original)
  const fixedTimeTasks = await prisma.planTask.findMany({
    where: { 
      time: now,
      intervalHours: null,
    },
    include: {
      plan: {
        include: { patient: true },
      },
    },
  });
  
  // Buscar tarefas com intervalo
  const intervalTasks = await prisma.planTask.findMany({
    where: {
      intervalHours: { not: null },
    },
    include: {
      plan: {
        include: { patient: true },
      },
    },
  });
  
  // Filtrar tarefas com intervalo que devem ser disparadas agora
  const dueIntervalTasks = intervalTasks.filter((task) => {
    if (!task.intervalHours) return false;
    
    const lastTriggered = task.lastTriggeredAt || task.createdAt;
    const hoursSinceLastTrigger = (nowDate.getTime() - lastTriggered.getTime()) / (1000 * 60 * 60);
    
    // Disparar se passou o intervalo (com margem de 1 minuto)
    return hoursSinceLastTrigger >= task.intervalHours - (1 / 60);
  });
  
  // Atualizar lastTriggeredAt para as tarefas de intervalo que serão disparadas
  for (const task of dueIntervalTasks) {
    await prisma.planTask.update({
      where: { id: task.id },
      data: { lastTriggeredAt: nowDate },
    });
  }
  
  return [...fixedTimeTasks, ...dueIntervalTasks];
}

export async function createPlan(
  patientId: string,
  title: string,
  tasks: { title: string; time: string; intervalHours?: number | null }[]
) {
  const plan = await prisma.plan.create({
    data: {
      patientId,
      title,
      tasks: {
        create: tasks.map((t) => ({ 
          title: t.title, 
          time: t.time,
          intervalHours: t.intervalHours ?? null,
        })),
      },
    },
    include: { tasks: true },
  });
  return plan;
}

export async function updatePlan(
  planId: string,
  tasks: { title: string; time: string }[]
) {
  await prisma.planTask.deleteMany({ where: { planId } });
  await prisma.planTask.createMany({
    data: tasks.map((t) => ({ planId, title: t.title, time: t.time })),
  });
  return prisma.plan.findUnique({
    where: { id: planId },
    include: { tasks: true },
  });
}

export async function updatePlanWithIntervals(
  planId: string,
  tasks: { title: string; time: string; intervalHours?: number | null }[]
) {
  await prisma.planTask.deleteMany({ where: { planId } });
  await prisma.planTask.createMany({
    data: tasks.map((t) => ({ 
      planId, 
      title: t.title, 
      time: t.time,
      intervalHours: t.intervalHours ?? null,
    })),
  });
  return prisma.plan.findUnique({
    where: { id: planId },
    include: { tasks: true },
  });
}

export async function getFamilyMembers(patientId: string) {
  // @ts-ignore - Prisma client será regenerado após migration
  return await prisma.familyMember.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createFamilyMember(patientId: string, name: string, phone: string) {
  const normalizedPhone = normalizePhone(phone);
  // @ts-ignore - Prisma client será regenerado após migration
  return await prisma.familyMember.upsert({
    where: {
      patientId_phone: {
        patientId,
        phone: normalizedPhone,
      },
    },
    update: {
      name,
    },
    create: {
      patientId,
      name,
      phone: normalizedPhone,
    },
  });
}

export async function addPlanTasks(planId: string, tasks: { title: string; time: string }[]) {
  await prisma.planTask.createMany({
    data: tasks.map((t) => ({ planId, title: t.title, time: t.time })),
  });
  return prisma.plan.findUnique({
    where: { id: planId },
    include: { tasks: true },
  });
}

export async function removePlanTask(taskId: string) {
  return prisma.planTask.delete({ where: { id: taskId } });
}

export async function getTaskLogsForDate(taskIds: string[], date: Date) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return prisma.taskLog.findMany({
    where: { taskId: { in: taskIds }, date: day },
  });
}

export async function recordTaskLog(
  taskId: string,
  date: Date,
  status: TaskLogStatus
) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return prisma.taskLog.upsert({
    where: {
      taskId_date: { taskId, date: day },
    },
    create: { taskId, date: day, status },
    update: { status },
  });
}

export async function listPatients() {
  return prisma.user.findMany({
    where: { role: 'PATIENT' },
    include: { patientProfile: true },
    orderBy: { name: 'asc' },
  });
}

export async function getPatientStatus(patientId: string, date: Date) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);

  const plan = await prisma.plan.findFirst({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    include: { tasks: true },
  });

  if (!plan) return { plan: null, tasks: [], logs: [], adherencePercent: 0 };

  const taskIds = plan.tasks.map((t) => t.id);
  const logs = await getTaskLogsForDate(taskIds, day);

  const total = plan.tasks.length;
  const done = logs.filter((l) => l.status === 'DONE').length;
  const adherencePercent = total > 0 ? Math.round((done / total) * 100) : 0;

  return {
    plan,
    tasks: plan.tasks,
    logs,
    adherencePercent,
  };
}

export async function getPatientWeeklyAdherence(patientId: string, days: number = 7) {
  let sum = 0;
  let count = 0;

  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const status = await getPatientStatus(patientId, date);
    if (status.plan && status.tasks.length > 0) {
      sum += status.adherencePercent;
      count++;
    }
  }

  const weeklyAdherencePercent = count > 0 ? Math.round(sum / count) : 0;
  return weeklyAdherencePercent;
}

export async function getPlanById(planId: string) {
  return prisma.plan.findUnique({
    where: { id: planId },
    include: { tasks: true, patient: true },
  });
}

export async function getPlansByPatientPhone(phone: string) {
  const normalized = normalizePhone(phone);
  const user = await prisma.user.findUnique({
    where: { phone: normalized, role: 'PATIENT' },
  });
  if (!user) return [];
  return prisma.plan.findMany({
    where: { patientId: user.id },
    orderBy: { createdAt: 'desc' },
    include: { tasks: true },
  });
}

export async function createOccurrence(patientId: string, description: string) {
  return prisma.occurrence.create({
    data: {
      patientId,
      description,
    },
  });
}
