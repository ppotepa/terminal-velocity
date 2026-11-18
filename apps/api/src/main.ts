import { createApiServer } from './create-api-server.ts';
import { readApiConfig } from './runtime/config.ts';
import { attachGracefulShutdown } from './runtime/shutdown.ts';

try {
  const config = readApiConfig(process.env);
  const server = createApiServer();
  const detach = attachGracefulShutdown(server);
  server.once('error', () => {
    detach();
    console.error('The demo API could not start. Check PORT and local port availability.');
    process.exitCode = 1;
  });
  server.listen(config.port, config.host, () => {
    console.info(`Airframes demo API: http://${config.host}:${config.port} (mode=demo, storage=memory)`);
  });
} catch {
  console.error('Invalid demo API configuration. PORT must be a decimal integer from 1 to 65535.');
  process.exitCode = 1;
}
