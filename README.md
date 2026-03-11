# MVP - Sistema de Lembretes Médicos via WhatsApp

Chatbot de lembretes médicos que funciona inteiramente pelo WhatsApp. Pacientes se cadastram, recebem lembretes, registram ações e podem falar com o médico. O médico (admin) gerencia planos e acompanha a adesão.

## Stack

- Node.js + TypeScript
- Express
- Prisma + PostgreSQL
- OpenAI GPT (dúvidas de saúde)
- Z-API (WhatsApp)
- node-cron (lembretes a cada minuto)

## Pré-requisitos

- Node.js 18+
- PostgreSQL (ou Docker para subir o banco)
- Conta na [Z-API](https://z-api.io) e instância configurada
- Chave da [OpenAI](https://platform.openai.com)

## Configuração

1. Clone o repositório e instale as dependências:

```bash
npm install
```

2. Copie o arquivo de ambiente e preencha as variáveis:

```bash
cp .env.example .env
```

Edite o `.env`. Todas as variáveis do banco vêm da env (usadas pelo `docker-compose` e pela aplicação):

| Variável | Descrição |
|----------|-----------|
| `PORT` | Porta do servidor (ex: 3000) |
| `POSTGRES_USER` | Usuário PostgreSQL (Docker) |
| `POSTGRES_PASSWORD` | Senha PostgreSQL (Docker) |
| `POSTGRES_DB` | Nome do banco (Docker) |
| `POSTGRES_PORT` | Porta do PostgreSQL no host (padrão 5432) |
| `DATABASE_URL` | URL de conexão (use os mesmos user/senha/db/port acima) |
| `OPENAI_API_KEY` | Chave da API OpenAI |
| `ZAPI_BASE_URL` | Base da Z-API (ex: https://api.z-api.io) |
| `ZAPI_INSTANCE_ID` | ID da sua instância Z-API |
| `ZAPI_TOKEN` | Token da instância Z-API |
| `DOCTOR_PHONE` | Número do médico (admin), só dígitos (ex: 559999999999) |

3. **(Opcional)** Suba o PostgreSQL com Docker; todas as variáveis vêm do `.env`:

```bash
docker compose up -d
```

4. Gere o cliente Prisma e rode as migrações:

```bash
npx prisma generate
npx prisma migrate dev --name init
```

5. Configure o webhook na Z-API para receber mensagens:

- No painel da Z-API, defina a URL de **recebimento de mensagens** para:
  `https://SEU_DOMINIO/webhook/zapi`
- Para testes locais use um túnel (ngrok, Cloudflare Tunnel, etc.) e aponte para `http://localhost:PORT/webhook/zapi`

## Como rodar

- Desenvolvimento (com reload):

```bash
npm run dev
```

- Build e produção:

```bash
npm run build
npm start
```

## Fluxo do bot

### Paciente (qualquer número que não seja o do médico)

1. **Primeira mensagem:** inicia cadastro (nome, idade, condição/observação).
2. **Após cadastro:** menu com:
   - 1 – Ver plano de hoje
   - 2 – Registrar ação realizada (escolhe tarefa e responde: 1 Fiz / 2 Não fiz / 3 Recusou)
   - 3 – Fazer pergunta para IA (OpenAI)
   - 4 – Falar com médico (mensagem é enviada ao número `DOCTOR_PHONE`)

3. **Lembretes:** a cada minuto o cron verifica tarefas no horário atual e envia "Hora do lembrete" + título. O paciente pode responder 1/2/3 para registrar o status.

### Médico (número definido em `DOCTOR_PHONE`)

Ao enviar qualquer mensagem, o bot identifica o admin e exibe o menu:

- 1 – Listar pacientes (nome e telefone)
- 2 – Ver status paciente (telefone → tarefas do dia e % adesão)
- 3 – Criar plano (telefone do paciente → tarefas no formato `HH:mm Título`, uma por linha)
- 4 – Editar plano (telefone ou ID do plano → adicionar com `+ HH:mm Título` ou remover com `- número`)

## Endpoints

- `POST /webhook/zapi` – Webhook da Z-API (mensagens recebidas)
- `GET /health` – Health check (retorna 200)

## Estrutura do projeto

```
src/
├── config/       # env e constantes
├── controllers/  # webhook
├── services/     # WhatsApp, OpenAI, Plan, Bot
├── bot/          # tipos e textos do bot
├── database/    # Prisma client
├── routes/       # Express routes
├── utils/        # logger
├── cron/         # lembretes (node-cron)
└── index.ts
```

## Testes rápidos

1. Inicie o servidor e exponha o webhook (ex: ngrok).
2. Envie uma mensagem para o número conectado na Z-API a partir de um número **diferente** do médico: o bot inicia o cadastro.
3. Envie uma mensagem a partir do número configurado em `DOCTOR_PHONE`: o bot exibe o menu admin.

O código está pronto para rodar e testar localmente com as variáveis de ambiente e o webhook configurados.
