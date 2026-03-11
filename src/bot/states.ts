export const PATIENT_MENU = `*Menu*
1 - Ver plano de hoje
2 - Registrar ação realizada
3 - Alerta de ocorrência
4 - Falar com Enfermeiro`;

export const ADMIN_MENU = `*Menu Enfermeiro 👨‍⚕️*
1 - Listar pacientes
2 - Ver status paciente
3 - Criar plano paciente
4 - Editar plano paciente`;

export const REGISTER_WELCOME = `Olá, seja bem-vindo ao Cuida-te SmartCare😁. Vamos começar o seu cadastro 📝

Por favor, envie suas informações em uma única mensagem, uma informação por linha, na seguinte ordem:

1. Nome
2. Data de nascimento (DD/MM/AAAA)
3. Idade
4. Peso
5. Sexo
6. Histórico familiar
7. Medicamentos de uso
8. Profissão do cuidador

*Exemplo:*
João Silva
01/01/1990
34
70kg
Masculino
Diabetes
Aspirina, Metformina
Enfermeiro`;

export const REGISTER_ASK_COMPLETE_PROFILE = `Por favor, envie todas as suas informações em uma única mensagem, uma informação por linha, conforme o exemplo acima.`;
export const REGISTER_DONE = `Cadastro finalizado com sucesso 😉 O Enfermeiro irá criar seu plano 📊`;

export const BACK_TO_MENU_HINT = `\n\n_Digite 0 ou "voltar ao menu" para cancelar._`;

export const ASK_ACTION_TASK = `Selecione a tarefa que deseja registrar:`;
export const ACTION_CHOICES = `1 - Realizado\n2 - Não Realizado\n3 - Recusado\n4 - Alerta de ocorrência`;
export const ACTION_RECORDED = `Registro salvo 📝 ✅`;
export const ASK_QUESTION = `Digite sua pergunta:`; // Mantido para uso futuro (IA em standby)
export const ASK_OCCURRENCE = `Descreva o que aconteceu com o paciente (ocorrência):`;
export const OCCURRENCE_RECORDED = `Ocorrência registrada e enviada para o Enfermeiro.`;
export const ASK_CONTACT_MESSAGE = `Digite a mensagem que deseja enviar ao Enfermeiro 👨‍⚕️:`;
export const CONTACT_SENT = `Sua mensagem foi enviada ao Enfermeiro 👨‍⚕️`;

export const REMINDER_PREFIX = `*Hora do lembrete*\n\n`;

export const ADMIN_ASK_PHONE_STATUS = `Digite o telefone do paciente (apenas números):`;
export const ADMIN_ASK_PHONE_PLAN = `Digite o telefone do paciente para criar o plano:`;
export const ADMIN_ASK_PATIENT_SELECTION = `Digite o *número* do paciente da lista acima:`;
export const ADMIN_PATIENT_SELECTION_INVALID = `Número inválido. Digite o número do paciente da lista.`;
export const ADMIN_ASK_TASKS = `Envie as tarefas do plano, uma por linha, no formato:\nHH:mm Título\n\nExemplo:\n08:00 Tomar remédio\n12:00 Almoço\n15:00 Beber água`;
export const ADMIN_PLAN_CREATED = `Plano criado com sucesso.`;
export const ADMIN_ASK_PLAN_ID_EDIT = `Digite o ID do plano a editar (ou telefone do paciente):`;
export const ADMIN_EDIT_INSTRUCTIONS = `Envie:\n+ HH:mm Título (para adicionar)\n- número (para remover a tarefa pelo número da lista)`;
export const ADMIN_BACK_HINT = `\n\n_Digite 0 ou "voltar ao menu" para cancelar._`;

export const ADMIN_ASK_TASK_SELECTION = `Selecione as tarefas que deseja incluir no plano (digite os números separados por vírgula ou espaço, ex: 1,3,5 ou 1 3 5):`;
export const ADMIN_ASK_TASK_SELECTION_MORE = `Tarefa adicionada! Selecione outra tarefa ou digite "concluir" para finalizar a seleção.`;
export const ADMIN_ASK_TASK_INTERVAL = (taskName: string) => `Para a tarefa "${taskName}", informe o intervalo de alerta:`;
export const ADMIN_ASK_MEDICATION_DETAILS = `Digite os nomes dos remédios separados por vírgula ou espaço:\n\nExemplo: Aspirina, Metformina, Insulina\nou\nAspirina Metformina Insulina\n\nCada remédio será uma tarefa separada e você poderá configurar o intervalo de alerta para cada um.\n\nOu digite "0" para pular:`;
export const ADMIN_ASK_OTHER_TASK_DETAILS = `Descreva a tarefa personalizada e o intervalo (ex: "Verificar ferida - 6h"):`;
export const ADMIN_TASK_SELECTION_INVALID = `Seleção inválida. Digite os números das tarefas separados por vírgula ou espaço.`;
export const ADMIN_WELCOME = `Olá! Bem-vindo ao painel do Enfermeiro 👨‍⚕️\n\nComo posso ajudá-lo hoje?`;
export const ADMIN_ASK_FAMILY_DETAILS = `Digite o nome do familiar na primeira linha e o telefone na segunda linha:\n\nExemplo:\nMaria Silva\n5511999999999`;
export const ADMIN_FAMILY_ADDED = `Familiar vinculado com sucesso! ✅`;
export const ADMIN_FAMILY_INVALID_FORMAT = `Formato inválido. Digite o nome na primeira linha e o telefone na segunda linha.`;
