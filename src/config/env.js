const { randomUUID } = require('node:crypto');
require('dotenv').config({ quiet: true });
function config(env = process.env) {
  const required = ['JWT_SECRET', 'JWT_ISSUER', 'JWT_AUDIENCE', 'INVENTORY_TOKEN'];
  for (const key of required) {
    if (!env[key] || env[key].startsWith('REPLACE_')) throw new Error(`Configure ${key} in .env`);
  }
  if (env.JWT_SECRET.length < 32 || env.INVENTORY_TOKEN.length < 32 || env.JWT_SECRET === env.INVENTORY_TOKEN) {
    throw new Error('Use distinct secrets of at least 32 characters.');
  }
  const locationToken = env.INVENTORY_LOCATION_TOKEN || '';
  if (locationToken && (locationToken.length < 32 || [env.JWT_SECRET,env.INVENTORY_TOKEN].includes(locationToken))) throw new Error('Use a distinct location token of at least 32 characters.');
  const mode = env.INVENTORY_SAFETY_MODE || 'connected';
  if (!['isolated', 'connected'].includes(mode)) throw new Error('Invalid INVENTORY_SAFETY_MODE');
  const endpoint = env.DYNAMODB_ENDPOINT || 'http://localhost:4566';
  const parsed = new URL(endpoint);
  if (parsed.protocol !== 'http:' || !['localhost', '127.0.0.1', 'host.docker.internal', 'floci'].includes(parsed.hostname) || parsed.port !== '4566' || parsed.username || parsed.password) throw new Error('Use the local Floci endpoint on port 4566.');
  const zones = env.ZONES_TABLE || 'ParkingZones', spots = env.SPOTS_TABLE || 'ParkingSpots';
  if (zones === spots || !/^ParkingZones(?:_test_[A-Za-z0-9_-]+)?$/.test(zones) || !/^ParkingSpots(?:_test_[A-Za-z0-9_-]+)?$/.test(spots)) throw new Error('Only Inventory table names are allowed.');
  if (mode === 'isolated' && (!zones.startsWith('ParkingZones_test_') || !spots.startsWith('ParkingSpots_test_'))) throw new Error('Isolated mode requires dedicated test tables.');
  const port = Number(env.PORT || 3002);
  const instanceId = env.INSTANCE_ID || `inventory-${randomUUID()}`;
  const rateMax = Number(env.RATE_LIMIT_MAX || 120);
  const bindHost = env.BIND_HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(instanceId)) throw new Error('Invalid INSTANCE_ID');
  if (!Number.isSafeInteger(rateMax) || rateMax < 1) throw new Error('Invalid RATE_LIMIT_MAX');
  if (!['127.0.0.1','0.0.0.0'].includes(bindHost)) throw new Error('Invalid BIND_HOST');
  return {
    port, instanceId, bindHost, region: env.AWS_REGION || 'us-east-1',
    endpoint,
    zones, spots,
    secret: env.JWT_SECRET, issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE,
    token: env.INVENTORY_TOKEN, locationToken, mode, holdsReady: env.INVENTORY_HOLDS_READY === 'true',
    origins: (env.CORS_ORIGINS || 'http://localhost:8080').split(',').map(x => x.trim()),
    rateMax
  };
}
module.exports = { config };
