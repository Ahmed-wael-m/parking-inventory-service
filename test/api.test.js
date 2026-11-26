const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { once } = require('node:events');
const { createApp } = require('../app');
const { memory } = require('./memory');
const { inventory } = require('../src/services/inventory');
const c = { secret:'test-only-jwt-key-12345678901234567890', issuer:'test-issuer', audience:'test-audience', token:'test-only-service-token-123456789012345', locationToken:'test-only-location-token-123456789012345', mode:'isolated', instanceId:'inventory-api-test', origins:['http://localhost:8080'], rateMax:1000 };
const repo = memory(); let server, base;
const token = (role='admin', expiresIn='1h', secret=c.secret, algorithm='HS256') => jwt.sign({sub:'test',role,priority:1},secret,{issuer:c.issuer,audience:c.audience,expiresIn,algorithm});
async function call(path, { method='GET', auth=token(), body, origin, raw }={}) {
  const headers = {}; if(auth) headers.Authorization=`Bearer ${auth}`; if(origin) headers.Origin=origin;
  if(body !== undefined || raw !== undefined) headers['Content-Type']='application/json';
  const r=await fetch(base+path,{method,headers,body:raw ?? (body===undefined?undefined:JSON.stringify(body))});
  return {status:r.status,body:await r.json(),headers:r.headers};
}
before(async()=>{const s=inventory(repo,c);await s.createZone({zone_id:'zone_1',zone_name:'Zone 1'});await s.createSpot({spot_id:'A1',zone_id:'zone_1',spot_type:'standard'});await s.createSpot({spot_id:'A2',zone_id:'zone_1',spot_type:'accessible'});await s.createSpot({spot_id:'A3',zone_id:'zone_1',spot_type:'standard',active:false}); server=createApp(repo,c).listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{if(server) await new Promise(resolve=>server.close(resolve));});
const p='/api/inventory';
test('health and security headers',async()=>{const r=await call('/health',{auth:null});assert.equal(r.status,200);assert.equal(r.body.instanceId,'inventory-api-test');assert.equal(r.headers.get('x-instance-id'),'inventory-api-test');assert.equal(r.headers.get('x-content-type-options'),'nosniff');});
test('exact private catalogue, including inactive and empty',async()=>{const r=await call(p+'/spots?zone_id=zone_1&spot_type=standard',{auth:c.token});assert.equal(r.headers.get('x-instance-id'),'inventory-api-test');assert.deepEqual(r.body,{data:[{spot_id:'A1',zone_id:'zone_1',spot_type:'standard',active:true},{spot_id:'A3',zone_id:'zone_1',spot_type:'standard',active:false}]});assert.deepEqual((await call(p+'/spots?zone_id=none&spot_type=standard',{auth:c.token})).body,{data:[]});});
test('missing/wrong service token and JWT cannot access private route',async()=>{for(const auth of [null,'wrong',token()])assert.equal((await call(p+'/spots',{auth})).status,401);});
test('missing, invalid, expired, wrong algorithm JWT and service token',async()=>{for(const auth of [null,'invalid',token('admin',-1),token('admin','1h','wrong-key'),token('admin','1h',c.secret,'HS384'),c.token])assert.equal((await call(p+'/zones',{auth})).status,401);});
test('student cannot modify inventory',async()=>{assert.equal((await call(p+'/zones',{method:'POST',auth:token('user'),body:{zone_id:'zone_2',zone_name:'Zone 2'}})).status,403);});
test('create, update and globally duplicate spots',async()=>{assert.equal((await call(p+'/zones',{method:'POST',body:{zone_id:'zone_2',zone_name:'Zone 2'}})).status,201);assert.equal((await call(p+'/spots',{method:'POST',body:{spot_id:'B1',zone_id:'zone_2',spot_type:'accessible'}})).status,201);assert.equal((await call(p+'/spots',{method:'POST',body:{spot_id:'A1',zone_id:'zone_2',spot_type:'standard'}})).status,409);assert.equal((await call(p+'/spots/B1',{method:'PATCH',body:{active:false}})).body.data.active,false);assert.equal((await call(p+'/spots/B1',{method:'PATCH',body:{active:true}})).body.data.active,true);});
test('invalid values, unknown fields, missing parent and malformed JSON',async()=>{for(const body of [{spot_id:'X',zone_id:'zone_1',spot_type:'invalid'},{spot_id:'X',zone_id:'zone_1',spot_type:'standard',active:'yes'},{spot_id:'X',zone_id:'zone_1',spot_type:'standard',role:'admin'}])assert.equal((await call(p+'/spots',{method:'POST',body})).status,400);assert.equal((await call(p+'/spots',{method:'POST',body:{spot_id:'X',zone_id:'missing',spot_type:'standard'}})).status,404);assert.equal((await call(p+'/zones',{method:'POST',raw:'{'})).status,400);});
test('capacity and search',async()=>{const r=await call(p+'/capacity');assert.equal(r.body.data.find(z=>z.zone_id==='zone_1').active,2);assert.equal(r.body.data[0].occupancy,0);const s=await call(p+'/search?active=false&spot_type=standard');assert.equal(s.body.data[0].spot_id,'A3');});
test('restricted CORS, oversized body',async()=>{assert.equal((await call(p+'/zones',{origin:'http://untrusted.example'})).status,403);assert.equal((await call(p+'/zones',{origin:'http://localhost:8080'})).headers.get('access-control-allow-origin'),'http://localhost:8080');assert.equal((await call(p+'/zones',{method:'POST',body:{zone_name:'x'.repeat(20000)}})).status,413);});
test('dependency failure returns safe 503',async()=>{const original=repo.spots;try{repo.spots=repo.fail;const r=await call(p+'/spots',{auth:c.token});assert.equal(r.status,503);assert.equal(r.body.error.code,'DATABASE_UNAVAILABLE');}finally{repo.spots=original;}});
test('rate limiter returns 429',async()=>{const limited=createApp(memory(),{...c,rateMax:1}).listen(0,'127.0.0.1');await once(limited,'listening');try{const url=`http://127.0.0.1:${limited.address().port}${p}/zones`;const options={headers:{Authorization:`Bearer ${token()}`}};assert.equal((await fetch(url,options)).status,200);assert.equal((await fetch(url,options)).status,429);}finally{await new Promise(resolve=>limited.close(resolve));}});

test('hold endpoints are service-token only and private schedule never leaks',async()=>{const start_at=new Date(Date.now()+60000).toISOString(),end_at=new Date(Date.now()+3600000).toISOString(),body={spot_id:'A1',hold_id:'api-hold',start_at,end_at};assert.equal((await call(p+'/holds',{method:'POST',body})).status,401);assert.equal((await call(p+'/holds',{method:'POST',auth:c.token,body})).body.data.status,'HELD');assert.equal((await call(p+'/holds',{method:'POST',auth:c.token,body:{...body,hold_id:'competing'}})).status,409);assert.equal((await call(p+'/spots/A1')).body.data.schedule,undefined);assert.equal((await call(p+'/holds/A1/api-hold/confirm',{method:'POST',auth:c.token,body:{}})).body.data.status,'CONFIRMED');assert.equal((await call(p+'/holds/A1/api-hold/release',{method:'POST',auth:c.token,body:{}})).body.data.status,'RELEASED');});

test('incident location token reads locations but cannot hold or access allocation catalogue',async()=>{assert.equal((await call(p+'/internal/spots/A1',{auth:c.locationToken})).status,200);assert.equal((await call(p+'/internal/zones/zone_1',{auth:c.locationToken})).status,200);assert.equal((await call(p+'/spots',{auth:c.locationToken})).status,401);assert.equal((await call(p+'/holds',{method:'POST',auth:c.locationToken,body:{}})).status,401);});
test('64-character spot ID works across inventory and hold APIs', async () => {
  const spot_id = 'A'.repeat(64);

  const body = {
    spot_id,
    zone_id: 'zone_1',
    spot_type: 'standard'
  };

  // Create a valid spot
  const created = await call(p + '/spots', {
    method: 'POST',
    body
  });
  assert.equal(created.status, 201);

  // Reject a spot ID longer than 64 characters
  const invalid = await call(p + '/spots', {
    method: 'POST',
    body: { ...body, spot_id: 'A'.repeat(65) }
  });
  assert.equal(invalid.status, 400);

  // Retrieve the spot
  const found = await call(p + '/spots/' + spot_id);
  assert.equal(found.status, 200);
  assert.equal(found.body.data.spot_id, spot_id);

  // Create a temporary hold
  const hold = await call(p + '/holds', {
    method: 'POST',
    auth: c.token,
    body: {
      spot_id,
      hold_id: 'long-id-test',
      start_at: new Date(Date.now() + 60000).toISOString(),
      end_at: new Date(Date.now() + 3600000).toISOString()
    }
  });
  assert.equal(hold.status, 200);
  assert.equal(hold.body.data.status, 'HELD');

  const holdPath = p + '/holds/' + spot_id + '/long-id-test';

  // Confirm the hold
  const confirmed = await call(holdPath + '/confirm', {
    method: 'POST',
    auth: c.token,
    body: {}
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.data.status, 'CONFIRMED');

  // Retrieve hold status
  const status = await call(holdPath, {
    auth: c.token
  });
  assert.equal(status.status, 200);
  assert.equal(status.body.data.status, 'CONFIRMED');

  // Release the booking
  const released = await call(holdPath + '/release', {
    method: 'POST',
    auth: c.token,
    body: {}
  });
  assert.equal(released.status, 200);
  assert.equal(released.body.data.status, 'RELEASED');
});
test('hold API validates expected zone and spot type', async () => {
  const body = {
    spot_id: 'A1',
    hold_id: 'expected-api-test',
    start_at: new Date(Date.now() + 60000).toISOString(),
    end_at: new Date(Date.now() + 3600000).toISOString(),
    expected_zone_id: 'zone_1',
    expected_spot_type: 'standard'
  };

  const options = {
    method: 'POST',
    auth: c.token
  };

  // Incorrect expected zone
  const wrongZone = await call(p + '/holds', {
    ...options,
    body: { ...body, expected_zone_id: 'wrong_zone' }
  });
  assert.equal(wrongZone.status, 409);

  // Incorrect expected spot type
  const wrongType = await call(p + '/holds', {
    ...options,
    body: { ...body, expected_spot_type: 'accessible' }
  });
  assert.equal(wrongType.status, 409);

  // Invalid expected spot type
  const invalidType = await call(p + '/holds', {
    ...options,
    body: { ...body, expected_spot_type: 'invalid' }
  });
  assert.equal(invalidType.status, 400);

  // Correct zone and spot type
  const valid = await call(p + '/holds', {
    ...options,
    body
  });
  assert.equal(valid.status, 200);
  assert.equal(valid.body.data.status, 'HELD');

  // Retry the same request
  const retry = await call(p + '/holds', {
    ...options,
    body
  });
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.body.data, valid.body.data);

  // Release the test hold
  const released = await call(
    p + '/holds/A1/expected-api-test/release',
    { ...options, body: {} }
  );
  assert.equal(released.status, 200);
  assert.equal(released.body.data.status, 'RELEASED');
});