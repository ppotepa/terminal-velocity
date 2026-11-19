import { parseArgs } from 'node:util';

export function adminOptions(args, action) {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    source: { type: 'string' }, provider: { type: 'string' }, account: { type: 'string' },
    epoch: { type: 'string' }, checkpoint: { type: 'string' }, from: { type: 'string' },
    to: { type: 'string' }, limit: { type: 'string' }, fixture: { type: 'boolean' },
    resolve: { type: 'string' },
  } });
  const scope = { sourceId: values.source, provider: values.provider, account: values.account, sourceEpoch: values.epoch };
  if (Object.values(scope).some(v => !v || !/^[a-zA-Z0-9_.-]{1,100}$/.test(v))) throw new Error('Exact source scope required.');
  if (action === 'inspect') {
    if (Object.keys(values).some(k => !['source','provider','account','epoch'].includes(k))) throw new Error('Unexpected inspection option.');
    return { scope };
  }
  // No arbitrary file/module loading or live provider acquisition in the admin CLI.
  if (!values.fixture || scope.provider !== 'synthetic' || scope.sourceId !== 'src_synthetic'
    || scope.account !== 'private-fixture') throw new Error('Only explicit synthetic fixture replay is configured.');
  if (!values.checkpoint || !/^[a-zA-Z0-9_.-]{1,100}$/.test(values.checkpoint)) throw new Error('Checkpoint required.');
  if (values.resolve && !['RETRY_SAME_PAGE','RESTART_BOUNDED_RANGE'].includes(values.resolve)) throw new Error('Invalid resolution.');
  const request = { ...scope, checkpoint: values.checkpoint, from: Number(values.from), to: Number(values.to),
    limit: Number(values.limit), mode: 'SYNTHETIC' };
  return { scope, request, resolution: values.resolve };
}

export function localDatabaseUrl(value) {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1','[::1]'].includes(url.hostname)
    || url.search || url.hash || !url.pathname.slice(1)) throw new Error('Explicit loopback database required.');
  return url.href;
}
