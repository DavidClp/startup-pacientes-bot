import { Role, TaskLogStatus } from '@prisma/client';
import { prisma } from '../database/client';
import { normalizePhone } from '../config/env';

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

export async function updatePatientProfile(
  userId: string,
  data: { age?: number; condition?: string }
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
  const tasks = await prisma.planTask.findMany({
    where: { time: now },
    include: {
      plan: {
        include: { patient: true },
      },
    },
  });
  return tasks;
}

export async function createPlan(
  patientId: string,
  title: string,
  tasks: { title: string; time: string }[]
) {
  const plan = await prisma.plan.create({
    data: {
      patientId,
      title,
      tasks: {
        create: tasks.map((t) => ({ title: t.title, time: t.time })),
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
