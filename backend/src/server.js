import { config } from './config.js';
import { assertDatabaseReady } from './database/pool.js';
import { createApplication } from './app.js';

const { httpServer } = createApplication();

httpServer.listen(config.port, async () => {
  console.log(`QueueChain API and Socket.IO listening on http://localhost:${config.port}`);
  try {
    await assertDatabaseReady();
    console.log('MySQL connection established.');
  } catch (error) {
    console.error(`MySQL is unavailable: ${error.message}`);
  }
});
