import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryDemoState } from '../src/demo/infrastructure/memory-demo-state.ts';
import { createIngestMessage } from '../src/demo/application/ingest-message.ts';
import { parseMessageInput } from '../src/demo/application/parse-message-input.ts';
import { guardOperation } from '../src/demo/application/guard-operation.ts';
import { freshnessPolicy } from '../src/modules/message-availability/public/index.ts';
const now=Date.parse('2026-11-18T12:00:00.000Z');
function dependencies(){
 const store=createMemoryDemoState();const policy=freshnessPolicy(600000,3600000).value;
 const parsed=parseMessageInput({messageId:'msg_staged',observedAt:new Date(now).toISOString(),bearer:'VDL2',text:'demo',icao24:'D00001'}).value;
 return {store,policy,parsed};
}

test('incomplete candidate directory never commits a message or idempotency receipt',async()=>{
 const {store,policy,parsed}=dependencies();
 const ingest=createIngestMessage(store,{async find(){return {revision:'partial/1',completeness:'PARTIAL',reason:'LIMIT_REACHED',candidates:[]};}},policy,()=>now);
 const before=store.read();const result=await ingest(parsed);
 assert.equal(result.error.code,'CANDIDATE_SET_INCOMPLETE');assert.equal(store.read(),before);
 assert.equal(store.read().messages.size,0);assert.equal(store.read().availability.ledger.size,0);
});

test('directory failure leaves the single visible demo state unchanged',async()=>{
 const {store,policy,parsed}=dependencies();
 const ingest=createIngestMessage(store,{async find(){throw new Error('injected');}},policy,()=>now);
 const before=store.read();const result=await guardOperation(()=>ingest(parsed));
 assert.equal(result.error.code,'INTERNAL_ERROR');assert.equal(store.read(),before);
});
