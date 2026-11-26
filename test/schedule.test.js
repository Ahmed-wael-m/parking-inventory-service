const {test}=require('node:test');const assert=require('node:assert/strict');
const {memory}=require('./memory');const {inventory}=require('../src/services/inventory');
const start='2026-12-01T09:00:00Z',end='2026-12-01T14:00:00Z';
async function fixture(){let time=Date.parse('2026-12-01T08:00:00Z');const repo=memory(),c={mode:'isolated',clock:()=>time};const a=inventory(repo,c),b=inventory(repo,c);await a.createZone({zone_id:'z',zone_name:'Zone'});await a.createSpot({spot_id:'A1',zone_id:'z',spot_type:'standard'});return {a,b,repo,advance:ms=>time+=ms};}
const body=(hold_id,more={})=>({spot_id:'A1',hold_id,start_at:start,end_at:end,...more});
const q={zone_id:'z',start_at:start,end_at:end};
test('overlap blocked across service instances; adjacent intervals accepted',async()=>{const {a,b}=await fixture();const result=await Promise.allSettled([a.hold(body('one')),b.hold(body('two'))]);assert.equal(result.filter(x=>x.status==='fulfilled').length,1);assert.equal(result.find(x=>x.status==='rejected').reason.status,409);assert.equal((await a.availability(q)).spots.length,0);assert.equal((await b.hold(body('adjacent',{start_at:end,end_at:'2026-12-01T15:00:00Z'}))).status,'HELD');});
test('confirm, release and retry idempotence',async()=>{const {a,b}=await fixture();const h=await a.hold(body('one'));assert.deepEqual(await b.hold(body('one')),h);assert.equal((await a.transition('A1','one','confirm')).status,'CONFIRMED');assert.equal((await b.transition('A1','one','confirm')).status,'CONFIRMED');assert.equal((await b.getHold('A1','one')).status,'CONFIRMED');await a.transition('A1','one','release');assert.equal((await b.transition('A1','one','release')).status,'RELEASED');assert.equal((await b.availability(q)).spots.length,1);await assert.rejects(a.hold(body('one')),{status:409});});
test('expiry frees slot and old hold cannot confirm or be resurrected',async()=>{const {a,b,advance}=await fixture();await a.hold(body('one'));advance(300001);assert.equal((await b.getHold('A1','one')).status,'EXPIRED');await assert.rejects(a.transition('A1','one','confirm'),{status:409});assert.equal((await b.availability(q)).spots.length,1);await b.hold(body('two'));});
test('confirmed bookings survive hold expiry, then expire at booking end',async()=>{const {a,advance}=await fixture();await a.hold(body('one'));await a.transition('A1','one','confirm');advance(360000);assert.equal((await a.getHold('A1','one')).status,'CONFIRMED');advance(6*3600000);assert.equal((await a.getHold('A1','one')).status,'ENDED');});
test('capacity uses actual held and booked state, flags full',async()=>{const {a}=await fixture();await a.hold(body('one'));let c=(await a.capacity({at:start}))[0];assert.equal(c.held,1);assert.equal(c.utilization_percent,100);assert.equal(c.utilization_status,'FULL');await a.transition('A1','one','confirm');c=(await a.capacity({at:start}))[0];assert.equal(c.booked,1);assert.equal(c.held,0);assert.equal((await a.capacity())[0].occupancy,0);});
test('near-full alert at 80% of total and free active count',async()=>{const {a}=await fixture();for(let i=2;i<=5;i++)await a.createSpot({spot_id:`A${i}`,zone_id:'z',spot_type:'standard'});for(let i=1;i<=4;i++)await a.hold(body(`h${i}`,{spot_id:`A${i}`}));const c=(await a.capacity({at:start}))[0];assert.equal(c.utilization_status,'HIGH');assert.equal(c.available,1);assert.equal(c.utilization_percent,80);});
test('admin cannot deactivate, delete or change type with live schedule; history retained',async()=>{const {a}=await fixture();await a.hold(body('one'));for(const change of [{active:false},{spot_type:'accessible'}])await assert.rejects(a.updateSpot('A1',change),{status:409});await assert.rejects(a.deleteSpot('A1'),{status:409});await a.transition('A1','one','release');await a.updateSpot('A1',{active:false});assert.equal((await a.availability(q)).spots.length,0);await assert.rejects(a.deleteSpot('A1'),{status:409});});
test('hold versus admin deactivation: cannot both succeed',async()=>{const {a,b}=await fixture();const result=await Promise.allSettled([a.hold(body('one')),b.updateSpot('A1',{active:false})]);assert.equal(result.filter(x=>x.status==='fulfilled').length,1);});
test('renewal checks extra interval and cannot shorten',async()=>{const {a}=await fixture();await a.hold(body('one'));await a.transition('A1','one','confirm');await a.hold(body('next',{start_at:'2026-12-01T15:00:00Z',end_at:'2026-12-01T16:00:00Z'}));await assert.rejects(a.transition('A1','one','extend',{end_at:'2026-12-01T15:30:00Z'}),{status:409});assert.equal((await a.transition('A1','one','extend',{end_at:'2026-12-01T15:00:00Z'})).end_at,'2026-12-01T15:00:00.000Z');});
test('invalid dates and missing cutover are rejected',async()=>{const {a,repo}=await fixture();await assert.rejects(a.hold(body('invalid',{start_at:'2026-02-30T09:00:00Z'})),{status:400});await assert.rejects(a.hold(body('invalid',{end_at:start})),{status:400});const c=inventory(repo,{mode:'connected'});await assert.rejects(c.hold(body('blocked')),{status:503});assert.equal((await c.capacity())[0].utilization_status,'UNKNOWN');});
test('catalogue never leaks holds, and booked spots still included',async()=>{const {a}=await fixture();await a.hold(body('one'));assert.deepEqual(await a.search({},true),[{spot_id:'A1',zone_id:'z',spot_type:'standard',active:true}]);assert.equal((await a.spot('A1')).schedule,undefined);assert.equal((await a.search({}))[0].schedule,undefined);});
test('unconfirmed database outcome not automatically retried',async()=>{const {a,repo}=await fixture();let count=0;repo.updateSpot=async()=>{count++;return repo.fail();};await assert.rejects(a.hold(body('one')),{status:503});assert.equal(count,1);});
test('hold accepts matching expected zone and spot type', async () => {
  const { a, b } = await fixture();

  const request = body('expected-match', {
    expected_zone_id: 'z',
    expected_spot_type: 'standard'
  });

  const h = await a.hold(request);

  assert.equal(h.status, 'HELD');

  // Retrying the same valid request remains safe.
  assert.deepEqual(await b.hold(request), h);
});

test('hold rejects an incorrect expected zone', async () => {
  const { a } = await fixture();

  await assert.rejects(
    a.hold(body('wrong-zone', {
      expected_zone_id: 'another_zone',
      expected_spot_type: 'standard'
    })),
    { status: 409 }
  );

  assert.equal((await a.availability(q)).spots.length, 1);
});

test('hold rejects an outdated expected spot type', async () => {
  const { a } = await fixture();

  await a.updateSpot('A1', {
    spot_type: 'accessible'
  });

  await assert.rejects(
    a.hold(body('wrong-type', {
      expected_zone_id: 'z',
      expected_spot_type: 'standard'
    })),
    { status: 409 }
  );

  assert.equal((await a.availability(q)).spots.length, 1);
});

test('hold rejects invalid expected zone and type values', async () => {
  const { a } = await fixture();

  await assert.rejects(
    a.hold(body('invalid-zone', {
      expected_zone_id: 'zone@123'
    })),
    { status: 400 }
  );

  await assert.rejects(
    a.hold(body('invalid-type', {
      expected_spot_type: 'invalid'
    })),
    { status: 400 }
  );
});

test('concurrent hold and conflicting spot type change cannot both succeed', async () => {
  const { a, b } = await fixture();

  const results = await Promise.allSettled([
    a.hold(body('type-race', {
      expected_zone_id: 'z',
      expected_spot_type: 'standard'
    })),
    b.updateSpot('A1', {
      spot_type: 'accessible'
    })
  ]);

  assert.equal(
    results.filter(r => r.status === 'fulfilled').length,
    1
  );

  const rejected = results.find(r => r.status === 'rejected');

  assert.equal(rejected.reason.status, 409);
});
const pricingQuery = {
  zone_id: 'z',
  spot_type: 'standard',
  start_at: start,
  end_at: end
};

async function confirmPricingBooking(a, hold_id, more = {}) {
  const request = body(hold_id, more);

  await a.hold(request);

  await a.transition(
    request.spot_id,
    hold_id,
    'confirm'
  );
}

test('pricing counts distinct confirmed active spots only', async () => {
  const { a } = await fixture();

  for (const spot_id of ['A2', 'A3', 'A4']) {
    await a.createSpot({
      spot_id,
      zone_id: 'z',
      spot_type: 'standard'
    });
  }

  await a.createSpot({
    spot_id: 'A5',
    zone_id: 'z',
    spot_type: 'standard',
    active: false
  });

  await a.createSpot({
    spot_id: 'A6',
    zone_id: 'z',
    spot_type: 'accessible'
  });

  await a.createZone({
    zone_id: 'other',
    zone_name: 'Other Zone'
  });

  await a.createSpot({
    spot_id: 'B1',
    zone_id: 'other',
    spot_type: 'standard'
  });

  // Two confirmed bookings on the same spot.
  await confirmPricingBooking(a, 'first', {
    end_at: '2026-12-01T10:00:00Z'
  });

  await confirmPricingBooking(a, 'second', {
    start_at: '2026-12-01T11:00:00Z',
    end_at: '2026-12-01T12:00:00Z'
  });

  // Confirmed booking on another matching spot.
  await confirmPricingBooking(a, 'third', {
    spot_id: 'A2',
    start_at: '2026-12-01T12:00:00Z'
  });

  // Temporary hold: must not increase pricing occupancy.
  await a.hold(body('temporary', {
    spot_id: 'A3'
  }));

  // Bookings outside the requested type and zone.
  await confirmPricingBooking(a, 'other-type', {
    spot_id: 'A6'
  });

  await confirmPricingBooking(a, 'other-zone', {
    spot_id: 'B1'
  });

  const result = await a.pricingCapacity(pricingQuery);

  assert.deepEqual(result, {
    zone_id: 'z',
    spot_type: 'standard',
    active: 4,
    booked: 2,
    utilization_percent: 50
  });
});

test('pricing excludes only the specified spot and hold', async () => {
  const { a } = await fixture();

  await a.createSpot({
    spot_id: 'A2',
    zone_id: 'z',
    spot_type: 'standard'
  });

  await confirmPricingBooking(a, 'same-id');

  await confirmPricingBooking(a, 'same-id', {
    spot_id: 'A2'
  });

  const result = await a.pricingCapacity({
    ...pricingQuery,
    exclude_spot_id: 'A1',
    exclude_hold_id: 'same-id'
  });

  assert.equal(result.active, 2);
  assert.equal(result.booked, 1);
  assert.equal(result.utilization_percent, 50);
});

test('pricing excludes released and non-overlapping bookings', async () => {
  const { a } = await fixture();

  await confirmPricingBooking(a, 'before', {
    start_at: '2026-12-01T08:30:00Z',
    end_at: start
  });

  await confirmPricingBooking(a, 'after', {
    start_at: end,
    end_at: '2026-12-01T15:00:00Z'
  });

  await confirmPricingBooking(a, 'released');

  await a.transition('A1', 'released', 'release');

  const result = await a.pricingCapacity(pricingQuery);

  assert.equal(result.booked, 0);
  assert.equal(result.utilization_percent, 0);
});

test('pricing handles zero active capacity safely', async () => {
  const { a } = await fixture();

  await a.updateSpot('A1', {
    active: false
  });

  const result = await a.pricingCapacity(pricingQuery);

  assert.equal(result.active, 0);
  assert.equal(result.booked, 0);
  assert.equal(result.utilization_percent, 0);
});

test('pricing rejects invalid queries', async () => {
  const { a } = await fixture();

  await assert.rejects(
    a.pricingCapacity({
      ...pricingQuery,
      spot_type: 'invalid'
    }),
    { status: 400 }
  );

  await assert.rejects(
    a.pricingCapacity({
      ...pricingQuery,
      end_at: start
    }),
    { status: 400 }
  );

  await assert.rejects(
    a.pricingCapacity({
      ...pricingQuery,
      exclude_hold_id: 'one'
    }),
    { status: 400 }
  );

  await assert.rejects(
    a.pricingCapacity({
      ...pricingQuery,
      zone_id: 'missing'
    }),
    { status: 404 }
  );
});

test('pricing preserves cutover and database failure protection', async () => {
  const { a, repo } = await fixture();

  const connected = inventory(repo, {
    mode: 'connected',
    holdsReady: false
  });

  await assert.rejects(
    connected.pricingCapacity(pricingQuery),
    { status: 503 }
  );

  repo.spots = repo.fail;

  await assert.rejects(
    a.pricingCapacity(pricingQuery),
    { status: 503 }
  );
});