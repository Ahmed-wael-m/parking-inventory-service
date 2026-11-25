const { bad, conflict, missing, ApiError } = require('../middleware/errors');
const v = require('./validation');
const HOLD_MS = 5 * 60 * 1000; // Proposed lease duration; agree with Allocation.
const MAX_RECORDS = 200; // Keep DynamoDB items bounded; do not silently discard retry history.
function instant(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw bad(`${field} must be UTC ISO 8601, e.g. 2026-12-01T09:00:00Z.`);
  const n = Date.parse(value);
  if (!Number.isFinite(n) || new Date(n).toISOString() !== (value.includes('.') ? value : value.replace('Z','.000Z'))) throw bad(`Invalid ${field}.`);
  return n;
}
function interval(start, end) {
  const a = instant(start,'start_at'), b = instant(end,'end_at');
  if (a >= b) throw bad('end_at must be after start_at.');
  return { start_at:new Date(a).toISOString(), end_at:new Date(b).toISOString() };
}
function state(h, now) {
  if (h.status === 'RELEASED') return 'RELEASED';
  if (h.status === 'HELD' && now >= Date.parse(h.expires_at)) return 'EXPIRED';
  if (now >= Date.parse(h.end_at)) return 'ENDED';
  return h.status;
}
function live(h, now) { return ['HELD','CONFIRMED'].includes(state(h, now)); }
function overlaps(h, start, end) { return Date.parse(h.start_at) < end && start < Date.parse(h.end_at); }
function blocking(s, start, end, now, except) {
  return (s.schedule || []).find(h => h.hold_id !== except && live(h,now) && overlaps(h,start,end));
}
function scheduleService(repo, c, getSpot, revise) {
  const clock = c.clock || Date.now;
  function ready() { if (c.mode !== 'isolated' && !c.holdsReady) throw new ApiError(503,'CUTOVER_REQUIRED','Time-based inventory is not enabled until Allocation cutover is verified.'); }
  // Every schedule write compares the version of the SAME spot item, including admin changes.
  // Retry only known conditional conflicts, never an uncertain database failure.
  async function change(id, fn) {
    ready();
    for (let attempt=0; attempt<5; attempt++) {
      const old = await getSpot(id), now = clock();
      const result = fn(old,now);
      if (!result.schedule) return result.value;
      try { await repo.updateSpot(old,revise(old,{schedule:result.schedule})); return result.value; }
      catch(e) { if(e.status!==409 || attempt===4) throw e; }
    }
  }
  function output(id,h,now) { return { spot_id:id,...h,status:state(h,now) }; }
  async function hold(body) {
    v.fields(body,['spot_id','hold_id','start_at','end_at']);
    const id=v.id(body.spot_id,'spot_id'), hold_id=v.id(body.hold_id,'hold_id');
    const period=interval(body.start_at,body.end_at);
    return change(id,(s,now)=>{
      const list=s.schedule||[], old=list.find(h=>h.hold_id===hold_id);
      if(old) {
        if(old.start_at!==period.start_at || (old.original_end_at||old.end_at)!==period.end_at || !live(old,now)) throw conflict('Hold ID already used or no longer active.');
        return {value:output(id,old,now)};
      }
      if(Date.parse(period.start_at)<now) throw bad('New hold start_at must not be in the past.');
      if(!s.active || blocking(s,Date.parse(period.start_at),Date.parse(period.end_at),now)) throw conflict('Spot is inactive or overlaps another hold/booking.');
      if(list.length>=MAX_RECORDS) throw new ApiError(503,'SCHEDULE_LIMIT','Spot history limit reached; controlled archival required.');
      const h={hold_id,...period,original_end_at:period.end_at,status:'HELD',expires_at:new Date(Math.min(now+HOLD_MS,Date.parse(period.end_at))).toISOString()};
      return {schedule:[...list,h],value:output(id,h,now)};
    });
  }
  async function transition(id, key, action, body) {
    v.id(key,'hold_id');
    if(action==='extend') v.fields(body,['end_at']);
    return change(id,(s,now)=>{
      const list=s.schedule||[], h=list.find(x=>x.hold_id===key);
      if(!h) throw missing('Hold not found.');
      const status=state(h,now); let next;
      if(action==='confirm') {
        if(status==='CONFIRMED') return {value:output(id,h,now)};
        if(status!=='HELD') throw conflict('Only an unexpired hold can be confirmed.');
        next={...h,status:'CONFIRMED'};
      } else if(action==='release') {
        if(['RELEASED','EXPIRED','ENDED'].includes(status)) return {value:output(id,h,now)};
        next={...h,status:'RELEASED'};
      } else {
        if(status!=='CONFIRMED') throw conflict('Only a live confirmed booking can be extended.');
        const end=instant(body.end_at,'end_at'), previous=Date.parse(h.end_at);
        if(end===previous) return {value:output(id,h,now)};
        if(end<previous) throw bad('Extension must increase end_at.');
        if(blocking(s,previous,end,now,key)) throw conflict('Extension overlaps another hold or booking.');
        next={...h,end_at:new Date(end).toISOString()};
      }
      return {schedule:list.map(x=>x.hold_id===key?next:x),value:output(id,next,now)};
    });
  }
  async function getHold(id,key) { ready(); v.id(key,'hold_id'); const s=await getSpot(id), h=(s.schedule||[]).find(x=>x.hold_id===key); if(!h) throw missing('Hold not found.'); return output(id,h,clock()); }
  return {ready,hold,transition,getHold,clock};
}
module.exports={scheduleService,interval,state,live,blocking,instant};
