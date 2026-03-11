export type PatientState =
  | 'REGISTER_NAME'
  | 'REGISTER_AGE'
  | 'REGISTER_CONDITION'
  | 'MENU'
  | 'AWAIT_ACTION_TASK_ID'
  | 'AWAIT_ACTION_CHOICE'
  | 'AWAIT_QUESTION'
  | 'AWAIT_CONTACT_MESSAGE';

export type AdminState =
  | 'MENU'
  | 'AWAIT_PATIENT_PHONE_STATUS'
  | 'AWAIT_PATIENT_PHONE_PLAN'
  | 'AWAIT_PLAN_TASKS'
  | 'AWAIT_EDIT_PLAN_ID'
  | 'AWAIT_EDIT_ACTION';

export interface BotStateData {
  taskId?: string;
  patientPhone?: string;
  planId?: string;
}

export interface ConversationState {
  state: PatientState | AdminState;
  data?: BotStateData;
}

export interface ZApiWebhookPayload {
  phone?: string;
  fromMe?: boolean;
  text?: { message?: string };
  message?: string;
}

export interface ParsedWebhook {
  phone: string;
  text: string;
  fromMe: boolean;
}
