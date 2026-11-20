import { startPrivatePositionPreview } from './private-preview.mjs';
import { readPreviewArguments } from './read-arguments.mjs';

try {
  const preview = await startPrivatePositionPreview(readPreviewArguments(process.argv.slice(2)));
  console.info(`Private position preview: http://${preview.host}:${preview.port}/positions`);
  const stop = () => { void preview.close().catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Private preview could not start.');
  process.exitCode = 1;
}
