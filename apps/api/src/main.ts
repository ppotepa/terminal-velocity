import { createApiServer } from './create-api-server.ts';
import { readApiConfig } from './runtime/config.ts';
import { attachGracefulShutdown } from './runtime/shutdown.ts';
import { readStorageConfig } from './runtime/storage-config.ts';
import { createApiRuntime, type ApiRuntime } from './runtime/create-api-runtime.ts';

let runtime: ApiRuntime | undefined;
try {
  const config = readApiConfig(process.env);
  const storage = readStorageConfig(process.env);
  runtime = await createApiRuntime(storage);
  const server = createApiServer(runtime.tracker, runtime.readHealth, runtime.mapReader, runtime.trackReader);
  const detach = attachGracefulShutdown(server, 5_000, runtime.close);
  server.once('error', () => {
    detach();
    void runtime?.close().catch(() => {});
    console.error('The API could not start. Check PORT and local port availability.');
    process.exitCode = 1;
  });
  server.listen(config.port, config.host, () => {
    console.info(`Terminal Velocity API: http://${config.host}:${config.port} (mode=demo, storage=${storage.driver})`);
  });
} catch {
  await runtime?.close().catch(() => {});
  console.error('The API could not start. Check PORT, STORAGE_DRIVER, database access, and applied migrations.');
  process.exitCode = 1;
}
