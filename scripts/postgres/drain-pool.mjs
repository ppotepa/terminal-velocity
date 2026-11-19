/** Register before the first query so even clients removed during shutdown are tracked. */
export function trackPoolShutdown(pool) {
  const disconnected = [];
  pool.on('connect', client => {
    disconnected.push(new Promise(resolve => client.once('end', resolve)));
  });
  return async () => {
    // pg-pool can resolve end() after removing clients, before their sockets close.
    // A subsequent forced database drop must not terminate those closing clients.
    await pool.end();
    await Promise.all(disconnected);
  };
}
