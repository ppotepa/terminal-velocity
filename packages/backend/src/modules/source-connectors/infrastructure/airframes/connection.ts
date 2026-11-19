import { setTimeout as delay } from 'node:timers/promises';
import type { ConnectionOutcome, ProviderConnectionHealth, SourceTransport } from '../../ports/source-transport.ts';
import { retryAfterMs, validateWindow, type PageDelivery, type ReadWindow } from './page-window.ts';

const clock = {
  now: Date.now, random: Math.random,
  wait: (ms: number, signal: AbortSignal) => delay(ms, undefined, { signal }),
};

export function airframesConnection(icao: string, read: ReadWindow, time = clock,
  inspect?: (delivery: PageDelivery) => void): SourceTransport<PageDelivery> {
  if (!/^[A-F0-9]{6}$/.test(icao)) throw new Error('A selected ICAO24 is required.');
  let controller: AbortController | undefined;
  let active: Promise<ConnectionOutcome> | undefined;
  let nextRequest = 0;
  let health: ProviderConnectionHealth = { state: 'DISCONNECTED', outcome: null,
    lastReceivedAt: null, accepted: 0, coverage: 'UNKNOWN' };

  async function run(deliver: Parameters<SourceTransport<PageDelivery>['start']>[0], signal: AbortSignal):
    Promise<ConnectionOutcome> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal.aborted) return 'STOPPED';
      const wait = nextRequest - time.now();
      if (wait > 10000) return 'RATE_LIMITED';
      if (wait > 0) await time.wait(wait, signal);
      if (signal.aborted) return 'STOPPED';
      nextRequest = time.now() + 1000;
      const response = await read(icao, signal).catch(() => ({ status: 503 } as const));
      if (signal.aborted) return 'STOPPED';
      if (response.status === 429 || (response.status >= 500 && response.status <= 599)) {
        const outcome = response.status === 429 ? 'RATE_LIMITED' : 'TEMPORARY_FAILURE';
        health = { ...health, state: 'DEGRADED', outcome };
        const retry = retryAfterMs('retryAfter' in response ? response.retryAfter : undefined, time.now());
        nextRequest = Math.max(nextRequest, time.now() + Math.max(retry, Math.floor(time.random() * (2000 * 2 ** attempt))));
        if (attempt === 2) return outcome;
        continue;
      }
      if (response.status !== 200) return 'PERMANENT_FAILURE';
      const batch = validateWindow('body' in response ? response.body : undefined, icao, time.now(), inspect !== undefined);
      if (typeof batch === 'string') return batch;
      health = { ...health, state: 'HEALTHY', outcome: null };
      for (const delivery of batch) {
        health = { ...health, lastReceivedAt: delivery.retrievedAt };
        for (let tries = 0; ; tries++) {
          if (signal.aborted) return 'STOPPED';
          const receipt = await deliver(delivery).catch(() => undefined);
          if (receipt === 'PREVIEWED') break;
          if (receipt?.ok) {
            if (receipt.value?.outcome !== 'CREATED' && receipt.value?.outcome !== 'DUPLICATE') return 'ACCEPTANCE_FAILED';
            health = { ...health, accepted: health.accepted + 1, state: 'HEALTHY', outcome: null };
            break;
          }
          if ((receipt && receipt.error?.code !== 'UNAVAILABLE') || tries === 2) return 'ACCEPTANCE_FAILED';
          health = { ...health, state: 'DEGRADED', outcome: 'ACCEPTANCE_FAILED' };
          await time.wait(1000 * 2 ** tries, signal);
        }
      }
      return signal.aborted ? 'STOPPED' : 'COMPLETE';
    }
    return 'TEMPORARY_FAILURE';
  }

  return {
    start(deliver, outer) {
      if (active) return active;
      controller = new AbortController();
      const signal = outer ? AbortSignal.any([outer, controller.signal]) : controller.signal;
      health = { ...health, state: 'DISCONNECTED', outcome: null, accepted: 0 };
      // A partial window can reach only the transient inspector.
      const handler = inspect ? async (delivery: PageDelivery) => {
        inspect(delivery);
        return 'PREVIEWED' as const;
      } : deliver;
      active = run(handler, signal).catch((): ConnectionOutcome => signal.aborted ? 'STOPPED' : 'TEMPORARY_FAILURE')
        .then(outcome => {
          health = { ...health, state: 'DISCONNECTED', outcome };
          return outcome;
        }).finally(() => { active = undefined; controller = undefined; });
      return active;
    },
    async stop() { controller?.abort(); await active; },
    health: () => ({ ...health }),
  };
}
