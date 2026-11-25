// Real Floci repository checks against unique, temporary tables. Never uses demo tables.
const { test }=require('node:test');const assert=require('node:assert/strict');
const { randomUUID }=require('node:crypto');
const { DeleteTableCommand }=require('@aws-sdk/client-dynamodb');
const { config }=require('../src/config/env');const { clients }=require('../src/config/db');
const { repository }=require('../src/repositories/dynamodb/inventory');const { inventory }=require('../src/services/inventory');const { createTables }=require('../scripts/setup');
test('Floci conditional writes, persistence and relationship transactions',async()=>{
  const suffix=randomUUID().replaceAll('-','');const c=config({...process.env,INVENTORY_SAFETY_MODE:'isolated',ZONES_TABLE:`ParkingZones_test_${suffix}`,SPOTS_TABLE:`ParkingSpots_test_${suffix}`});const {raw,db}=clients(c);const s=inventory(repository(db,c),c);
  try{await createTables(raw,c);await s.createZone({zone_id:'z1',zone_name:'One'});await s.createZone({zone_id:'z2',zone_name:'Two'});
    const results=await Promise.allSettled([s.createSpot({spot_id:'A1',zone_id:'z1',spot_type:'standard'}),s.createSpot({spot_id:'A1',zone_id:'z2',spot_type:'standard'})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.status,409);
    const saved=await s.spot('A1');const parent=await s.zone(saved.zone_id);assert.equal(parent.spot_count,1);assert.equal((await s.zone(saved.zone_id==='z1'?'z2':'z1')).spot_count,0);
    await assert.rejects(s.deleteZone(saved.zone_id),{status:409});await s.updateSpot('A1',{active:false});const second=clients(c);try{assert.equal((await repository(second.db,c).spot('A1')).active,false);}finally{second.raw.destroy();}
    await s.deleteSpot('A1');assert.equal((await s.zone(saved.zone_id)).spot_count,0);await s.deleteZone(saved.zone_id);
    // Two independent SDK clients and service instances must agree on ONE winner.
    await s.createSpot({spot_id:'R1',zone_id:saved.zone_id==='z1'?'z2':'z1',spot_type:'standard'});
    const other=clients(c);try {
      const t=inventory(repository(other.db,c),c);
      const start_at=new Date(Date.now()+60000).toISOString(),end_at=new Date(Date.now()+3600000).toISOString();
      const body={spot_id:'R1',start_at,end_at};
      const race=await Promise.allSettled([s.hold({...body,hold_id:'race1'}),t.hold({...body,hold_id:'race2'})]);
      assert.equal(race.filter(x=>x.status==='fulfilled').length,1);
      assert.equal(race.find(x=>x.status==='rejected').reason.status,409);
      const winner=race.find(x=>x.status==='fulfilled').value.hold_id;
      await t.transition('R1',winner,'confirm');
      assert.equal((await s.getHold('R1',winner)).status,'CONFIRMED');
      assert.equal((await s.availability({start_at,end_at})).spots.some(x=>x.spot_id==='R1'),false);
      await assert.rejects(s.updateSpot('R1',{active:false}),{status:409});
      await t.transition('R1',winner,'release');
      assert.equal((await s.availability({start_at,end_at})).spots.some(x=>x.spot_id==='R1'),true);
    } finally {other.raw.destroy();}

  }finally{for(const name of [c.spots,c.zones]){try{await raw.send(new DeleteTableCommand({TableName:name}));}catch(e){if(e.name!=='ResourceNotFoundException')console.warn('Cleanup failed for',name,e.name);}}raw.destroy();}
});
