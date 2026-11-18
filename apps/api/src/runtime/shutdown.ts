import type { Server } from 'node:http';

/** Stop accepting requests, allow in-flight responses to finish, then enforce a bounded deadline. */
export function attachGracefulShutdown(server: Server, deadlineMs = 5_000): () => void {
  let stopping = false;
  let deadline: NodeJS.Timeout | undefined;
  const detach = () => {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    if (deadline !== undefined) clearTimeout(deadline);
  };
  const stop = () => {
    if (stopping) return;
    stopping = true;
    deadline = setTimeout(() => {
      process.exitCode = 1;
      server.closeAllConnections();
    }, deadlineMs);
    deadline.unref();
    server.close(error => { if (error) process.exitCode = 1; detach(); });
    server.closeIdleConnections();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return detach;
}
