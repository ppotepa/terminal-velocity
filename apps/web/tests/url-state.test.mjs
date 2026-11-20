import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUrlState, urlForState } from '../src/app/url-state.ts';

test('URL state accepts known navigation and filters and drops unsupported values', () => {
  assert.deepEqual(parseUrlState('?view=flights&aircraft=ac_demo-001&protocol=VDL2&positionStatus=STALE'), {
    view: 'flights', aircraft: 'ac_demo-001', positionStatus: 'STALE', messageStatus: '', protocol: 'VDL2',
  });
  assert.deepEqual(parseUrlState('?view=unsafe&aircraft=%3Cscript%3E&protocol=secret&messageStatus=maybe'), {
    view: 'map', aircraft: '', positionStatus: '', messageStatus: '', protocol: '',
  });
});

test('URL serialization keeps one canonical set of application state', () => {
  const current = new URL('http://127.0.0.1:5173/?view=stations&unknown=private');
  const next = urlForState(current, {
    view: 'map', aircraft: 'ac_demo-001', positionStatus: 'CURRENT', messageStatus: 'RECENT', protocol: '',
  });
  assert.equal(next.origin, current.origin);
  assert.equal(next.search, '?aircraft=ac_demo-001&positionStatus=CURRENT&messageStatus=RECENT');
  assert.deepEqual(parseUrlState(next.search), {
    view: 'map', aircraft: 'ac_demo-001', positionStatus: 'CURRENT', messageStatus: 'RECENT', protocol: '',
  });
});
