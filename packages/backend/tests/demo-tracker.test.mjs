import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoTracker } from '../src/demo/public/index.ts';
import { MAX_DEMO_MESSAGES } from '../src/demo/domain/limits.ts';
const base=Date.parse('2026-11-18T12:00:00.000Z');
const payload=(overrides={})=>({messageId:'msg_demo-001',observedAt:new Date(base).toISOString(),bearer:'VDL2',text:'Synthetic demo status',icao24:'D00001',...overrides});
function take(result){assert.equal(result.ok,true,JSON.stringify(result));return result.value;}

test('demo starts with three aircraft, no transmissions and disconnected external feeds',async()=>{
 const tracker=createDemoTracker({now:()=>base});
 const aircraft=take(await tracker.listAircraft());
 assert.equal(aircraft.length,3);
 for(const item of aircraft){
  assert.equal(item.mode,'demo');assert.equal(item.availability.freshness,'NONE');
  assert.equal(item.availability.coverage,'UNKNOWN');assert.equal(item.availability.feedHealth,'DISCONNECTED');
 }
 assert.deepEqual(take(await tracker.getMessages('ac_demo-001')),[]);
});

test('ingest links a message and exposes its observedAt through both queries',async()=>{
 const tracker=createDemoTracker({now:()=>base+1000});
 const receipt=take(await tracker.ingest(payload()));
 assert.equal(receipt.created,true);
 assert.deepEqual(receipt.message.correlation,{outcome:'MATCHED',aircraftId:'ac_demo-001'});
 assert.deepEqual(take(await tracker.getMessage('msg_demo-001')),receipt.message);
 assert.equal(take(await tracker.getMessages('ac_demo-001')).length,1);
 const aircraft=take(await tracker.getAircraft('ac_demo-001'));
 assert.equal(aircraft.availability.freshness,'RECENT');
 assert.equal(aircraft.availability.lastMessageAt,payload().observedAt);
});

test('freshness expires on read at exact thresholds without another ingest',async()=>{
 let now=base;const tracker=createDemoTracker({now:()=>now});
 take(await tracker.ingest(payload()));
 now=base+599999;assert.equal(take(await tracker.getAircraft('ac_demo-001')).availability.freshness,'RECENT');
 now=base+600000;assert.equal(take(await tracker.getAircraft('ac_demo-001')).availability.freshness,'STALE');
 now=base+3600000;assert.equal(take(await tracker.getAircraft('ac_demo-001')).availability.freshness,'NONE');
 assert.equal(take(await tracker.listAircraft())[0].availability.freshness,'NONE');
});

test('backfill stays old and later older records do not overwrite newest observedAt',async()=>{
 const tracker=createDemoTracker({now:()=>base+7_200_000});
 take(await tracker.ingest(payload()));
 assert.equal(take(await tracker.getAircraft('ac_demo-001')).availability.freshness,'NONE');
 const fresh=new Date(base+7_199_000).toISOString();
 take(await tracker.ingest(payload({messageId:'msg_fresh',observedAt:fresh})));
 take(await tracker.ingest(payload({messageId:'msg_older',observedAt:new Date(base-1000).toISOString()})));
 const aircraft=take(await tracker.getAircraft('ac_demo-001'));
 assert.equal(aircraft.availability.lastMessageAt,fresh);assert.equal(aircraft.availability.freshness,'RECENT');
 assert.deepEqual(take(await tracker.getMessages('ac_demo-001')).map(item=>item.messageId),['msg_fresh','msg_demo-001','msg_older']);
});

test('same canonical content is idempotent after identifier/time normalization',async()=>{
 const tracker=createDemoTracker({now:()=>base});
 take(await tracker.ingest(payload({registration:' demo-001 ',icao24:'d00001',observedAt:'2026-11-18T12:00:00Z'})));
 const duplicate=take(await tracker.ingest(payload({registration:'DEMO-001'})));
 assert.equal(duplicate.created,false);assert.equal(take(await tracker.getMessages('ac_demo-001')).length,1);
});

test('reused message id with changed content is conflict and cannot silently correct assignment',async()=>{
 const tracker=createDemoTracker({now:()=>base});
 take(await tracker.ingest(payload()));
 const conflict=await tracker.ingest(payload({icao24:'D00002'}));
 assert.equal(conflict.error.code,'MESSAGE_CONFLICT');
 assert.equal(take(await tracker.getMessage('msg_demo-001')).correlation.aircraftId,'ac_demo-001');
 assert.equal(take(await tracker.getAircraft('ac_demo-002')).availability.freshness,'NONE');
});

test('concurrent repeated requests create one message and one public contribution',async()=>{
 const tracker=createDemoTracker({now:()=>base});
 const results=await Promise.all(Array.from({length:8},()=>tracker.ingest(payload())));
 assert.equal(results.filter(result=>take(result).created).length,1);
 assert.equal(take(await tracker.getMessages('ac_demo-001')).length,1);
});

test('concurrent different content under one id has one winner and one conflict',async()=>{
 const tracker=createDemoTracker({now:()=>base});
 const [one,two]=await Promise.all([tracker.ingest(payload()),tracker.ingest(payload({text:'different'}))]);
 assert.equal(one.ok,true);assert.equal(two.error.code,'MESSAGE_CONFLICT');
 assert.equal(take(await tracker.getMessage('msg_demo-001')).text,payload().text);
});

test('strong identifier disagreement is recorded without publishing a green aircraft',async()=>{
 const tracker=createDemoTracker({now:()=>base});
 const result=take(await tracker.ingest(payload({registration:'DEMO-002'})));
 assert.equal(result.message.correlation.outcome,'CONFLICTED');
 assert.equal(result.message.correlation.aircraftId,null);
 assert.equal(take(await tracker.listAircraft()).every(item=>item.availability.freshness==='NONE'),true);
});

test('callsign alone does not confirm a physical aircraft',async()=>{
 const tracker=createDemoTracker({now:()=>base});
 const input=payload({callsign:'DEMO101'});delete input.icao24;
 const result=take(await tracker.ingest(input));
 assert.equal(result.message.correlation.outcome,'UNMATCHED');
 assert.deepEqual(take(await tracker.getMessages('ac_demo-001')),[]);
});

test('input is captured before the async queue; callers cannot mutate stored facts',async()=>{
 const tracker=createDemoTracker({now:()=>base});
 const input=payload();const pending=tracker.ingest(input);
 input.text='mutated while pending';input.icao24='D00002';
 take(await pending);
 input.observedAt='1999-01-01T00:00:00.000Z';
 const stored=take(await tracker.getMessage('msg_demo-001'));
 assert.equal(stored.text,'Synthetic demo status');assert.equal(stored.correlation.aircraftId,'ac_demo-001');
 assert.equal(stored.observedAt,new Date(base).toISOString());
});

test('all DTOs and nested fields are detached from internal state',async()=>{
 const tracker=createDemoTracker({now:()=>base});
 const receipt=take(await tracker.ingest(payload()));
 receipt.message.text='client mutation';receipt.message.correlation.aircraftId='ac_demo-002';
 const aircraft=take(await tracker.getAircraft('ac_demo-001'));
 aircraft.position.latitude=-90;aircraft.availability.freshness='NONE';
 const fleet=take(await tracker.listAircraft());fleet.pop();fleet[0].registration='changed';
 const list=take(await tracker.getMessages('ac_demo-001'));list[0].text='changed again';list.pop();
 assert.equal(take(await tracker.getMessage('msg_demo-001')).text,'Synthetic demo status');
 assert.equal(take(await tracker.getAircraft('ac_demo-001')).position.latitude,52.2297);
 assert.equal(take(await tracker.getAircraft('ac_demo-001')).availability.freshness,'RECENT');
 assert.equal(take(await tracker.listAircraft()).length,3);
 assert.equal(take(await tracker.getAircraft('ac_demo-001')).registration,'DEMO-001');
 assert.equal(take(await tracker.getMessages('ac_demo-001')).length,1);
});

test('capacity is explicit; valid duplicates remain idempotent at capacity',async()=>{
 const tracker=createDemoTracker({now:()=>base});
 for(let i=0;i<MAX_DEMO_MESSAGES;i++)take(await tracker.ingest(payload({messageId:`msg_capacity-${i}`})));
 const exceeded=await tracker.ingest(payload({messageId:'msg_overflow'}));
 assert.equal(exceeded.error.code,'CAPACITY_EXCEEDED');
 const duplicate=take(await tracker.ingest(payload({messageId:'msg_capacity-0'})));
 assert.equal(duplicate.created,false);
 assert.equal((await tracker.getMessage('msg_overflow')).error.code,'NOT_FOUND');
});

test('unknown aircraft and messages return NOT_FOUND rather than empty successful details',async()=>{
 const tracker=createDemoTracker({now:()=>base});
 assert.equal((await tracker.getAircraft('ac_missing')).error.code,'NOT_FOUND');
 assert.equal((await tracker.getMessages('ac_missing')).error.code,'NOT_FOUND');
 assert.equal((await tracker.getMessage('msg_missing')).error.code,'NOT_FOUND');
});
