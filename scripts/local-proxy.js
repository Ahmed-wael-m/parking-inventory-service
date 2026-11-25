// Lab 8-style LOCAL Inventory proxy. Not a real ALB or a team-wide proxy.
const http = require('node:http');
const { pipeline } = require('node:stream');

function createProxy(targets, intervalMs = 3000) {
  const workers = targets.map(port => ({ port, healthy: false, generation: 0 }));
  let next = 0;
  function mark(worker, healthy) {
    if (worker.healthy !== healthy) console.log(`Worker ${worker.port}: ${healthy ? 'healthy' : 'unhealthy'}`);
    worker.healthy = healthy;
  }
  async function probe() {
    await Promise.all(workers.map(async worker => {
      const generation = ++worker.generation;
      let healthy = false;
      try {
        const response = await fetch(`http://127.0.0.1:${worker.port}/health`, { signal: AbortSignal.timeout(1000) });
        const body = await response.json();
        healthy = response.ok && body.status === 'ok' && body.service === 'inventory';
      } catch { /* unreachable worker */ }
      if (generation === worker.generation) mark(worker, healthy);
    }));
  }
  function error(res, status, code, message) {
    if (res.headersSent) return res.destroy();
    res.writeHead(status, { 'Content-Type': 'application/json', 'X-Served-By-LB': 'inventory-local-proxy', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ success: false, error: { code, message } }));
  }
  // Remove hop-by-hop headers and untrusted forwarding headers. Workers trust no proxy IPs.
  function cleanHeaders(headers) {
    const result = { ...headers };
    const connection = String(result.connection || '').split(',').map(s => s.trim().toLowerCase());
    for (const name of [...connection, 'connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','forwarded','x-forwarded-for','x-forwarded-host','x-forwarded-proto','x-real-ip']) delete result[name];
    return result;
  }
  const server = http.createServer((req, res) => {
    const path = (req.url || '').split('?')[0];
    if (path !== '/health' && !path.startsWith('/api/inventory/')) {
      req.resume(); return error(res,404,'NOT_FOUND','Local Inventory proxy only.');
    }
    const pool = workers.filter(worker => worker.healthy);
    if (!pool.length) { req.resume(); return error(res,503,'NO_HEALTHY_TARGET','No healthy Inventory worker.'); }
    const worker = pool[next++ % pool.length];
    const headers = cleanHeaders(req.headers);
    headers.host = `127.0.0.1:${worker.port}`;
    const upstream = http.request({ hostname:'127.0.0.1', port:worker.port, path:req.url, method:req.method, headers, timeout:3000 }, response => {
      res.writeHead(response.statusCode, { ...cleanHeaders(response.headers), 'x-served-by-lb':'inventory-local-proxy' });
      pipeline(response,res,() => {});
    });
    upstream.on('timeout', () => upstream.destroy(new Error('Upstream timeout')));
    upstream.on('error', () => {
      worker.generation++;
      mark(worker,false);
      req.unpipe(upstream); req.resume();
      // Never retry writes: a failed response does not prove the write failed.
      error(res,503,'UPSTREAM_UNAVAILABLE','Inventory worker unavailable.');
    });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
    req.pipe(upstream);
  });
  let timer;
  server.on('listening', () => { probe(); timer = setInterval(probe,intervalMs); timer.unref(); });
  server.on('close', () => clearInterval(timer));
  return { server, probe };
}
if (require.main === module) {
  const port = Number(process.env.PROXY_PORT || 8092);
  const targets = (process.env.INVENTORY_TARGET_PORTS || '3102,3202,3302').split(',').map(Number);
  const valid = n => Number.isInteger(n) && n >= 1 && n <= 65535;
  if (!valid(port) || !targets.every(valid) || targets.includes(port) || new Set(targets).size !== targets.length) throw new Error('Invalid proxy/target ports');
  createProxy(targets).server.listen(port,'127.0.0.1',() => console.log(`Local Inventory proxy on ${port}; targets: ${targets.join(', ')}`));
}
module.exports = { createProxy };
