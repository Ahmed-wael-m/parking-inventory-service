const v = require('./validation');
const { randomUUID } = require('node:crypto');
const { scheduleService, interval, state, live, blocking, instant } = require('./schedule');
const publicSpot = ({ schedule, generation, ...item }) => item;
const { bad, missing, conflict, ApiError } = require('../middleware/errors');
const now = () => new Date().toISOString();
const stamp = () => { const time = now(); return { created_at: time, updated_at: time, version: 1, generation: randomUUID() }; };
const revised = (old, changes) => ({ ...old, ...changes, updated_at: now(), version: old.version + 1, generation: old.generation || randomUUID() });
function inventory(repo, c) {
  async function zone(id) { const item = await repo.zone(v.id(id, 'zone_id')); if (!item) throw missing('Zone not found.'); return item; }
  async function spot(id) { const item = await repo.spot(v.id(id, 'spot_id')); if (!item) throw missing('Spot not found.'); return item; }
  const scheduling = scheduleService(repo,c,spot,revised);
  function safeChange(old) {
    scheduling.ready();
    if ((old.schedule || []).some(h => live(h,scheduling.clock()))) throw conflict('Spot has a live hold or future/current booking.');
  }
  async function createZone(body) {
    v.fields(body, ['zone_id', 'zone_name', 'description']);
    const item = { zone_id: v.id(body.zone_id, 'zone_id'), zone_name: v.text(body.zone_name, 'zone_name', 80), description: v.text(body.description ?? '', 'description', 300, true), spot_count: 0, ...stamp() };
    await repo.createZone(item); return item;
  }
  async function updateZone(id, body) {
    v.fields(body, ['zone_name', 'description']); if (!Object.keys(body).length) throw bad('No changes supplied.');
    const old = await zone(id), changes = {};
    if ('zone_name' in body) changes.zone_name = v.text(body.zone_name, 'zone_name', 80);
    if ('description' in body) changes.description = v.text(body.description, 'description', 300, true);
    const item = revised(old, changes); await repo.updateZone(old, item); return item;
  }
  async function deleteZone(id) { const old = await zone(id); if (old.spot_count !== 0) throw conflict('Remove spots before deleting a zone.'); await repo.deleteZone(old); return { zone_id: id }; }
  async function createSpot(body) {
    v.fields(body, ['spot_id', 'zone_id', 'spot_type', 'active']);
    const item = { spot_id: v.id(body.spot_id, 'spot_id'), zone_id: v.id(body.zone_id, 'zone_id'), spot_type: v.type(body.spot_type), active: body.active === undefined ? true : v.bool(body.active), schedule: [], ...stamp() };
    const parent = await zone(item.zone_id); await repo.createSpot(item, parent); return publicSpot(item);
  }
  async function updateSpot(id, body) {
    v.fields(body, ['spot_type', 'active']); if (!Object.keys(body).length) throw bad('No changes supplied.');
    const old = await spot(id), changes = {};
    if ('spot_type' in body) changes.spot_type = v.type(body.spot_type);
    if ('active' in body) changes.active = v.bool(body.active);
    if ((changes.spot_type !== undefined && changes.spot_type !== old.spot_type) || (old.active && changes.active === false)) safeChange(old);
    const item = revised(old, changes); await repo.updateSpot(old, item); return publicSpot(item);
  }
  async function deleteSpot(id) { const old = await spot(id); safeChange(old); if ((old.schedule || []).length) throw conflict('Spot has hold history; deactivate instead of deleting.'); await repo.deleteSpot(old, await zone(old.zone_id)); return { spot_id: id }; }
  async function search(query, catalogue = false) {
    const f = v.filters(query, catalogue);
    const items = (await repo.spots()).filter(s => (!f.zone_id || s.zone_id === f.zone_id) && (!f.spot_type || s.spot_type === f.spot_type) && (f.active === undefined || s.active === f.active) && (!f.q || [s.spot_id, s.zone_id, s.spot_type].some(x => x.toLowerCase().includes(f.q))));
    items.sort((a,b) => (f.sort === 'desc' ? -1 : 1) * a.spot_id.localeCompare(b.spot_id, 'en', { numeric: true }));
    if (catalogue) return items.map(({ spot_id, zone_id, spot_type, active }) => ({ spot_id, zone_id, spot_type, active }));
    return items.map(publicSpot);
  }
  async function availability(query) {
    scheduling.ready();
    v.fields(query,['zone_id','spot_type','spot_id','start_at','end_at']);
    const period=interval(query.start_at,query.end_at), now=scheduling.clock();
    const start=Date.parse(period.start_at), end=Date.parse(period.end_at);
    if(end<=now) throw bad('Availability window must end in the future.');
    const zone_id=query.zone_id===undefined?undefined:v.id(query.zone_id,'zone_id');
    const type=query.spot_type===undefined?undefined:v.type(query.spot_type);
    const spot_id=query.spot_id===undefined?undefined:v.id(query.spot_id,'spot_id');
    const items=await repo.spots();
    return { ...period, checked_at:new Date(now).toISOString(), spots:items.filter(s=>s.active && (!spot_id||s.spot_id===spot_id) && (!zone_id||s.zone_id===zone_id) && (!type||s.spot_type===type) && !blocking(s,start,end,now)).map(({spot_id,zone_id,spot_type,active})=>({spot_id,zone_id,spot_type,active})) };
  }
  async function capacity(query={}) {
    v.fields(query,['at']);
    const now=scheduling.clock(), at=query.at===undefined?now:instant(query.at,'at');
    if(at<now-1000) throw bad('Capacity is a current/future snapshot, not historical analytics.');
    const [zones, spots] = await Promise.all([repo.zones(), repo.spots()]);
    const ready=c.mode==='isolated'||c.holdsReady;
    return zones.map(z => {
      const list = spots.filter(s => s.zone_id === z.zone_id), active = list.filter(s => s.active).length;
      const by_type = Object.fromEntries(v.TYPES.map(t => { const group = list.filter(s => s.spot_type === t); const a = group.filter(s => s.active).length; return [t, { total: group.length, active: a, inactive: group.length-a }]; }));
      const base={zone_id:z.zone_id,zone_name:z.zone_name,total:list.length,active,inactive:list.length-active,by_type,at:new Date(at).toISOString()};
      if(!ready) return {...base,occupancy:null,held:null,booked:null,available:null,utilization_percent:null,utilization_status:'UNKNOWN',reservation_data:'cutover_required'};
      let held=0, booked=0;
      for(const s of list) { const h=blocking(s,at,at+1,now); if(h) { if(state(h,now)==='CONFIRMED') booked++; else held++; } }
      const used=held+booked, available=active-used;
      const pct=list.length?Math.round(10000*used/list.length)/100:0;
      return {...base,occupancy:used,held,booked,available,utilization_percent:pct,utilization_status:active===0?'NO_ACTIVE_CAPACITY':available===0?'FULL':pct>=80?'HIGH':'NORMAL',reservation_data:'inventory_schedule'};
    });
  }
  async function alternatives(query) {
    v.fields(query, ['zone_id', 'spot_type', 'min_active']);
    const id = v.id(query.zone_id, 'zone_id'), type = v.type(query.spot_type);
    const min = query.min_active === undefined ? 1 : Number(query.min_active);
    if (query.min_active !== undefined && (typeof query.min_active !== 'string' || !/^\d+$/.test(query.min_active)) || !Number.isInteger(min) || min < 1 || min > 10000) throw bad('min_active must be 1–10000.');
    await zone(id);
    const caps = await capacity(); const requested = caps.find(z => z.zone_id === id);
    if (!requested) throw conflict('Zone changed. Refresh and retry.');
    const candidates = caps.filter(z => z.zone_id !== id && z.by_type[type].active >= min).map(z => ({ zone_id: z.zone_id, zone_name: z.zone_name, matching_active: z.by_type[type].active })).sort((a,b) => b.matching_active-a.matching_active || a.zone_id.localeCompare(b.zone_id));
    return { requested_zone: id, requested_active: requested.by_type[type].active, minimum_active: min, insufficient_active_capacity: requested.by_type[type].active < min, alternatives: requested.by_type[type].active < min ? candidates : [], basis: 'Active catalogue capacity only; booking availability unknown for these suggestions.' };
  }
  return { zone, spot:async id=>publicSpot(await spot(id)), availability, hold:scheduling.hold, getHold:scheduling.getHold, transition:scheduling.transition, zones: repo.zones, createZone, updateZone, deleteZone, createSpot, updateSpot, deleteSpot, search, capacity, alternatives };
}
module.exports = { inventory };
