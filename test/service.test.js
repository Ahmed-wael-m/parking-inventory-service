const { test } = require('node:test');
const assert = require('node:assert/strict');
const { memory } = require('./memory');
const { inventory } = require('../src/services/inventory');
async function fixture(mode='isolated') {
  const repo = memory(), s = inventory(repo,{mode});
  await s.createZone({zone_id:'zone_1',zone_name:'First'});
  await s.createZone({zone_id:'zone_2',zone_name:'Second'});
  await s.createSpot({spot_id:'A1',zone_id:'zone_1',spot_type:'standard'});
  await s.createSpot({spot_id:'A2',zone_id:'zone_1',spot_type:'accessible',active:false});
  return {repo,s};
}
test('global duplicate and missing parent rejected', async()=>{const {s}=await fixture(); await assert.rejects(s.createSpot({spot_id:'A1',zone_id:'zone_2',spot_type:'standard'}),{status:409}); await assert.rejects(s.createSpot({spot_id:'X',zone_id:'missing',spot_type:'standard'}),{status:404});});
test('catalogue exact fields includes inactive; unknown type empty', async()=>{const {s}=await fixture(); assert.deepEqual(await s.search({zone_id:'zone_1'},true),[{spot_id:'A1',zone_id:'zone_1',spot_type:'standard',active:true},{spot_id:'A2',zone_id:'zone_1',spot_type:'accessible',active:false}]); assert.deepEqual(await s.search({spot_type:'unknown'},true),[]);});
test('capacity and type counts',async()=>{const {s}=await fixture();const c=(await s.capacity())[0];assert.equal(c.total,2);assert.equal(c.active,1);assert.equal(c.inactive,1);assert.equal(c.by_type.accessible.inactive,1);assert.equal(c.utilization_percent,0);});
test('search filters and capacity-based alternative',async()=>{const {s}=await fixture();await s.createSpot({spot_id:'B1',zone_id:'zone_2',spot_type:'accessible'});assert.equal((await s.search({active:'false',q:'a2'}))[0].spot_id,'A2');const alt=await s.alternatives({zone_id:'zone_1',spot_type:'accessible'});assert.equal(alt.alternatives[0].zone_id,'zone_2');assert.match(alt.basis,/unknown/);});
test('isolated deactivate, reactivate, delete; nonempty zone protected',async()=>{const {s}=await fixture();await assert.rejects(s.deleteZone('zone_1'),{status:409});assert.equal((await s.updateSpot('A1',{active:false})).active,false);assert.equal((await s.updateSpot('A1',{active:true})).active,true);await s.deleteSpot('A1');await s.deleteSpot('A2');await s.deleteZone('zone_1');await assert.rejects(s.zone('zone_1'),{status:404});});
test('connected mode denies destructive changes',async()=>{const {s}=await fixture('connected');await assert.rejects(s.updateSpot('A1',{active:false}),{status:503});await assert.rejects(s.updateSpot('A1',{spot_type:'ev'}),{status:503});await assert.rejects(s.deleteSpot('A1'),{status:503});});
test('invalid input and unavailable dependency',async()=>{const {s,repo}=await fixture();await assert.rejects(s.createSpot({spot_id:'X',zone_id:'zone_1',spot_type:'bad'}),{status:400});await assert.rejects(s.updateSpot('A1',{active:'false'}),{status:400});repo.spots=repo.fail;await assert.rejects(s.search({},true),{status:503});});
module.exports = { fixture };
