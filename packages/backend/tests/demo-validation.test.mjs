import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoTracker } from '../src/demo/public/index.ts';
const base=Date.parse('2026-11-18T12:00:00.000Z');
const payload=(overrides={})=>({messageId:'msg_validation',observedAt:new Date(base).toISOString(),bearer:'VDL2',text:'Synthetic demo status',icao24:'D00001',...overrides});

test('validation rejects unknown properties and client-controlled authorization/candidates',async()=>{
 const tracker=createDemoTracker({now:()=>base});
 for(const extra of [{publicEligible:true},{candidates:[]},{visibilityScope:'public'},{unexpected:'x'}]) {
  const result=await tracker.ingest(payload(extra));assert.equal(result.error.code,'VALIDATION_ERROR');
 }
 assert.equal((await tracker.getMessage('msg_validation')).error.code,'NOT_FOUND');
 assert.equal((await tracker.ingest(payload())).value.created,true);
});

test('malformed dates, offsets, identifiers, text and fields are rejected without retaining receipt',async()=>{
 const tracker=createDemoTracker({now:()=>base});
 const cases=[null,[],new Date(),{...payload(),text:5},payload({text:''}),payload({text:'x'.repeat(4097)}),
  payload({messageId:'arbitrary'}),payload({icao24:'NOTHEX'}),payload({bearer:'ACARS'}),
  payload({observedAt:'2026-02-30T12:00:00Z'}),payload({observedAt:'2026-11-18T13:00:00+01:00'}),
  payload({observedAt:'2026-11-18'}),payload({callsign:undefined})];
 for(const input of cases)assert.equal((await tracker.ingest(input)).error.code,'VALIDATION_ERROR');
 assert.equal((await tracker.ingest(payload())).value.created,true);
});

test('future timestamp can be retried later because rejection stores no idempotency receipt',async()=>{
 let now=base-1;const tracker=createDemoTracker({now:()=>now});
 assert.equal((await tracker.ingest(payload())).error.code,'VALIDATION_ERROR');
 assert.equal((await tracker.getMessage('msg_validation')).error.code,'NOT_FOUND');
 now=base;assert.equal((await tracker.ingest(payload())).value.created,true);
});

test('getters are rejected without executing code supplied through unknown input',async()=>{
 const tracker=createDemoTracker({now:()=>base});let called=0;
 const input=payload();Object.defineProperty(input,'text',{get(){called++;return 'getter';},enumerable:true});
 assert.equal((await tracker.ingest(input)).error.code,'VALIDATION_ERROR');assert.equal(called,0);
});

test('invalid clock leaves no partial state and the same id can succeed after recovery',async()=>{
 let now=NaN;const tracker=createDemoTracker({now:()=>now});
 assert.equal((await tracker.ingest(payload())).error.code,'INTERNAL_ERROR');
 assert.equal((await tracker.getMessage('msg_validation')).error.code,'NOT_FOUND');
 now=base;assert.equal((await tracker.ingest(payload())).value.created,true);
});
