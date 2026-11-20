import type { components } from '../api/generated';
export type EventEnvelope=components['schemas']['EventEnvelope'];
export const eventTypes=['position_updated','flight_started','flight_ended','message_observed','message_decoded','alert_triggered','watchlist_changed','source_status_changed','snapshot_required'] as const;
export type RealtimeStatus='connecting'|'connected'|'reconnecting';
export type RealtimeOptions={url?:string;onEvent:(event:EventEnvelope)=>void;onStatus?:(status:RealtimeStatus)=>void;onSnapshotRequired?:()=>Promise<void>|void;factory?:(url:string)=>EventSource};
/** Browser EventSource resumes its last event ID automatically; snapshot_required always reconciles REST state. */
export function subscribeRealtime({url='/api/v1/events',onEvent,onStatus,onSnapshotRequired,factory=(u)=>new EventSource(u)}:RealtimeOptions):()=>void{
 let stopped=false;let source:EventSource;const seen=new Set<string>();onStatus?.('connecting');
 const open=()=>{if(stopped)return;source=factory(url);source.onopen=()=>onStatus?.('connected');source.onerror=()=>onStatus?.('reconnecting');source.onmessage=(message)=>{let event:EventEnvelope;try{event=JSON.parse(message.data) as EventEnvelope}catch{return}if(!valid(event)||event.eventId&&seen.has(event.eventId))return;if(event.eventId){seen.add(event.eventId);if(seen.size>2000)seen.delete(seen.values().next().value!)}if(event.type==='snapshot_required'){void Promise.resolve(onSnapshotRequired?.()).then(()=>onEvent(event));return}onEvent(event)};for(const type of eventTypes){source.addEventListener(type,(message)=>{let event:EventEnvelope;try{event=JSON.parse((message as MessageEvent).data) as EventEnvelope}catch{return}if(!valid(event)||event.eventId&&seen.has(event.eventId))return;if(event.eventId)seen.add(event.eventId);if(event.type==='snapshot_required')void Promise.resolve(onSnapshotRequired?.()).then(()=>onEvent(event));else onEvent(event)})}};
 open();return()=>{stopped=true;source?.close()}
}
function valid(value:unknown):value is EventEnvelope{return !!value&&typeof value==='object'&&'type'in value&&eventTypes.includes((value as EventEnvelope).type as typeof eventTypes[number])&&'occurredAt'in value&&'data'in value}
