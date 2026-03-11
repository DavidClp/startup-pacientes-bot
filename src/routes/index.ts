import { Router } from 'express';
import { zapiWebhook } from '../controllers/webhookController';

const router = Router();

router.post('/webhook/zapi', zapiWebhook);

router.get('/ping', (_req, res) => {
  res.status(200).json({ message: 'pong' });
});

export default router;
