// Generate local-only credentials, never team credentials. Does not overwrite .env.
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const key = () => randomBytes(32).toString('hex');
const env = fs.readFileSync('.env.example','utf8').replace('ZONES_TABLE=ParkingZones','ZONES_TABLE=ParkingZones_test_local').replace('SPOTS_TABLE=ParkingSpots','SPOTS_TABLE=ParkingSpots_test_local').replace('INVENTORY_SAFETY_MODE=connected','INVENTORY_SAFETY_MODE=isolated').replace('REPLACE_WITH_PRIVATE_SHARED_KEY',key()).replace('REPLACE_WITH_PRIVATE_SERVICE_TOKEN',key()).replace('REPLACE_WITH_AGREED_ISSUER','inventory-local-test').replace('REPLACE_WITH_AGREED_AUDIENCE','inventory-local-test');
fs.writeFileSync('.env',env,{flag:'wx'}); console.log('Created private .env with local-only credentials. Do not share or commit it.');
