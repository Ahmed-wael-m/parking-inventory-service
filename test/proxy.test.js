const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createProxy } = require('../scripts/local-proxy');
const start = async server => { server.listen(0,'127.0.0.1'); await once(server,'listening'); return server.address().port; };
const stop = async server => { if (server.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
test('local proxy: three workers, exact body and auth forwarding, failover, recovery, all down', async () => {
  const workers = ['one','two','three'].map(id => http.createServer((req,res) => {
    res.setHeader('Content-Type','application/json'); res.setHeader('X-Instance-ID',id);
    if(req.url === '/health') return res.end(JSON.stringify({ status:'ok', service:'inventory' }));
    if(req.headers.authorization !== 'Bearer fake-test-token' || req.headers['x-forwarded-for']) {res.statusCode=401;return res.end('{}');}
    res.end(JSON.stringify({data:[{spot_id:'A1',zone_id:'zone_1',spot_type:'standard',active:true}]}));
  }));
  let proxy;
  try {
    const ports = await Promise.all(workers.map(start));
    proxy = createProxy(ports, 30000);
    const port = await start(proxy.server); await proxy.probe();
    const url = `http://127.0.0.1:${port}/api/inventory/spots?zone_id=zone_1&spot_type=standard`;
    const request = () => fetch(url,{headers:{Authorization:'Bearer fake-test-token','X-Forwarded-For':'9.9.9.9'}});
    const seen=[];
    for(let i=0;i<6;i++){const r=await request();assert.equal(r.status,200);seen.push(r.headers.get('x-instance-id'));assert.deepEqual(await r.json(),{data:[{spot_id:'A1',zone_id:'zone_1',spot_type:'standard',active:true}]});}
    assert.deepEqual(seen,['one','two','three','one','two','three']);
    await stop(workers[1]); await proxy.probe();
    const remaining=[];for(let i=0;i<4;i++){const r=await request();assert.equal(r.status,200);remaining.push(r.headers.get('x-instance-id'));await r.text();}
    assert.deepEqual(new Set(remaining),new Set(['one','three']));
    workers[1].listen(ports[1],'127.0.0.1');await once(workers[1],'listening');await proxy.probe();
    const recovered=[];for(let i=0;i<3;i++){const r=await request();recovered.push(r.headers.get('x-instance-id'));await r.text();}assert.equal(new Set(recovered).size,3);
    const other=await fetch(`http://127.0.0.1:${port}/api/allocation/requests`);assert.equal(other.status,404);await other.text();
    await Promise.all(workers.map(stop));await proxy.probe();const down=await request();assert.equal(down.status,503);assert.equal((await down.json()).error.code,'NO_HEALTHY_TARGET');
  } finally {if(proxy) await stop(proxy.server);await Promise.all(workers.map(stop));}
});
