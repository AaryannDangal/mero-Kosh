import { createApp } from './app';
import { config } from './config';
import { startScheduler } from './jobs/reminders';
import { flushEmailOutbox } from './services/notifications';

const app = createApp();
app.listen(config.port, '0.0.0.0', () => {
  console.log(`Mero Kosh API listening on :${config.port} (${config.env})`);
  startScheduler();
  flushEmailOutbox().catch(() => undefined);
});
