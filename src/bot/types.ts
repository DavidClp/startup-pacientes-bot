export type PatientState =
  | 'REGISTER_NAME'
  | 'REGISTER_COMPLETE_PROFILE'
  | 'MENU'
  | 'AWAIT_ACTION_TASK_ID'
  | 'AWAIT_ACTION_CHOICE'
  | 'AWAIT_QUESTION'
  | 'AWAIT_OCCURRENCE'
  | 'AWAIT_CONTACT_MESSAGE';

export type AdminState =
  | 'MENU'
  | 'AWAIT_PATIENT_PHONE_STATUS'
  | 'AWAIT_PATIENT_PHONE_PLAN'
  | 'AWAIT_PATIENT_SELECTION'
  | 'AWAIT_PLAN_TASKS'
  | 'AWAIT_EDIT_PLAN_ID'
  | 'AWAIT_EDIT_ACTION'
  | 'AWAIT_EDIT_MENU'
  | 'AWAIT_EDIT_ADD'
  | 'AWAIT_EDIT_ADD_INTERVAL'
  | 'AWAIT_EDIT_ADD_MEDICATION'
  | 'AWAIT_EDIT_REMOVE'
  | 'AWAIT_EDIT_SCHEDULE_SELECT'
  | 'AWAIT_EDIT_SCHEDULE'
  | 'AWAIT_TASK_SELECTION'
  | 'AWAIT_TASK_INTERVAL'
  | 'AWAIT_MEDICATION_DETAILS'
  | 'AWAIT_MEDICATION_LIST'
  | 'AWAIT_OTHER_TASK_DETAILS'
  | 'AWAIT_OCCURRENCE_ACTION'
  | 'AWAIT_FAMILY_PATIENT_SELECTION'
  | 'AWAIT_FAMILY_DETAILS'
  | 'AWAIT_STATUS_PERIOD';

export interface BotStateData {
  taskId?: string;
  patientPhone?: string;
  planId?: string;
  selectedTasks?: string[];
  currentTaskIndex?: number;
  taskIntervals?: Record<string, number | null>;
  medicationDetails?: string;
  patientsList?: Array<{ id: string; phone: string; name: string | null }>;
  selectionMode?: 'STATUS' | 'PLAN' | 'EDIT' | 'FAMILY';
  tasksList?: Array<{ id: string; time: string; title: string; intervalHours?: number | null }>;
  occurrencePatientId?: string;
  occurrencePatientPhone?: string;
  patientId?: string;
  patientName?: string;
}

export interface ConversationState {
  state: PatientState | AdminState;
  data?: BotStateData;
}

export interface ZApiWebhookPayload {
  phone?: string;
  isGroup?: boolean;
  fromMe?: boolean;
  text?: { message?: string };
  message?: string;
  selectedId?: string;
  selectedRowId?: string;
  listReply?: { id: string; title: string };
  buttonReply?: { id: string; title: string };
}

export interface ParsedWebhook {
  phone: string;
  text: string;
  fromMe: boolean;
  isGroup: boolean;
  selectedId?: string;
  isButtonReply?: boolean;
  isListReply?: boolean;
}
