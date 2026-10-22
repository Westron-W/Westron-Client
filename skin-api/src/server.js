import 'dotenv/config';
import { buildApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const app = await buildApp();

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error({ err: error }, 'Could not start Westron Skin API');
  await app.close();
  process.exitCode = 1;
}
