// Isolated in-memory test double: not DynamoDB and not proof of atomic writes.
const { conflict, ApiError } = require('../src/middleware/errors');
function memory() {
  const zones = new Map(), spots = new Map();
  const clone = x => x === undefined ? x : structuredClone(x);
  const unique = (m,k,item) => { if (m.has(k)) throw conflict('Duplicate'); m.set(k,clone(item)); };
  const update = (m,k,old,item) => { if (m.get(k)?.version !== old.version || m.get(k)?.generation !== old.generation) throw conflict('Concurrent change'); m.set(k,clone(item)); };
  return {
    zones: async () => [...zones.values()].map(clone), spots: async () => [...spots.values()].map(clone),
    zone: async id => clone(zones.get(id)), spot: async id => clone(spots.get(id)),
    createZone: async item => unique(zones,item.zone_id,item),
    updateZone: async (old,item) => update(zones,old.zone_id,old,item),
    deleteZone: async old => { if (zones.get(old.zone_id)?.spot_count !== 0 || zones.get(old.zone_id)?.version !== old.version || zones.get(old.zone_id)?.generation !== old.generation) throw conflict('Not empty'); zones.delete(old.zone_id); },
    createSpot: async (item,z) => { if (zones.get(z.zone_id)?.version !== z.version || zones.get(z.zone_id)?.generation !== z.generation) throw conflict('Concurrent change'); unique(spots,item.spot_id,item); zones.set(z.zone_id,{...z,spot_count:z.spot_count+1,version:z.version+1}); },
    updateSpot: async (old,item) => update(spots,old.spot_id,old,item),
    deleteSpot: async (old,z) => { if(spots.get(old.spot_id)?.version!==old.version || spots.get(old.spot_id)?.generation!==old.generation || zones.get(z.zone_id)?.version!==z.version || zones.get(z.zone_id)?.generation!==z.generation) throw conflict('Concurrent change'); spots.delete(old.spot_id); zones.set(z.zone_id,{...z,spot_count:z.spot_count-1,version:z.version+1}); },
    fail: async () => { throw new ApiError(503,'DATABASE_UNAVAILABLE','Inventory database unavailable.'); }
  };
}
module.exports = { memory };
