import type { CandidateDirectory } from '../../modules/aircraft-correlation/public/index.ts';
import type { FreshnessPolicy } from '../../modules/message-availability/public/index.ts';
import type { DemoStateStore } from '../ports/demo-state-store.ts';
import type { ApiResult, IngestReceipt } from '../public/types.ts';
import type { ParsedMessage } from './parsed-message.ts';
import { readClock } from './read-clock.ts';
import { stageDemoIngest } from './stage-demo-ingest.ts';
export function createIngestMessage(store: DemoStateStore, directory: CandidateDirectory,
  policy: FreshnessPolicy, now: () => number) {
  return async (input: ParsedMessage): Promise<ApiResult<IngestReceipt>> => {
    const time = readClock(now); if (!time.ok) return time;
    const staged = await stageDemoIngest(store.read(), input, time.value, directory, policy);
    if (!staged.ok) return staged;
    store.commit(staged.value.state);
    return { ok: true, value: staged.value.receipt };
  };
}
