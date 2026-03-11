import 'dotenv/config';
import express from 'express';
import { env } from './config/env';
import { connectDatabase } from './database/client';
import routes from './routes';
import { startRemindersCron } from './cron/reminders';
import { logger } from './utils/logger';

async function main() {
  await connectDatabase();
  const app = express();
  app.use(express.json());
  app.use(routes);
  startRemindersCron();
  app.listen(env.PORT, () => {
    logger.info(`Server running on port ${env.PORT}`);
  });
}

main().catch((e) => {
  logger.error('Fatal', e);
  process.exit(1);
});
