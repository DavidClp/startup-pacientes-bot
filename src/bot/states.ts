export const PATIENT_MENU = `*Menu*
1 - Ver plano de hoje
2 - Registrar ação realizada
3 - Fazer pergunta para IA
4 - Falar com médico`;

export const ADMIN_MENU = `*Menu Admin*
1 - Listar pacientes
2 - Ver status paciente
3 - Criar plano paciente
4 - Editar plano paciente`;

export const REGISTER_WELCOME = `Olá, vamos cadastrar o paciente.`;
export const REGISTER_ASK_NAME = `Qual o seu nome?`;
export const REGISTER_ASK_AGE = `Qual a sua idade?`;
export const REGISTER_ASK_CONDITION = `Qual sua condição ou observação médica?`;
export const REGISTER_DONE = `Cadastro finalizado. O médico irá criar seu plano.`;

export const ASK_ACTION_TASK = `Digite o *número* da tarefa que deseja registrar (conforme lista do plano):`;
export const ACTION_CHOICES = `1 - Fiz\n2 - Não fiz\n3 - Paciente recusou`;
export const ACTION_RECORDED = `Registro salvo.`;
export const ASK_QUESTION = `Digite sua pergunta:`;
export const ASK_CONTACT_MESSAGE = `Digite a mensagem que deseja enviar ao médico:`;
export const CONTACT_SENT = `Sua mensagem foi enviada ao médico.`;

export const REMINDER_PREFIX = `*Hora do lembrete*\n\n`;

export const ADMIN_ASK_PHONE_STATUS = `Digite o telefone do paciente (apenas números):`;
export const ADMIN_ASK_PHONE_PLAN = `Digite o telefone do paciente para criar o plano:`;
export const ADMIN_ASK_TASKS = `Envie as tarefas do plano, uma por linha, no formato:\nHH:mm Título\n\nExemplo:\n08:00 Tomar remédio\n12:00 Almoço\n15:00 Beber água`;
export const ADMIN_PLAN_CREATED = `Plano criado com sucesso.`;
export const ADMIN_ASK_PLAN_ID_EDIT = `Digite o ID do plano a editar (ou telefone do paciente):`;
export const ADMIN_EDIT_INSTRUCTIONS = `Envie:\n+ HH:mm Título (para adicionar)\n- número (para remover a tarefa pelo número da lista)`;
