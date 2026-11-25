const { config } = require('./src/config/env');
const { clients } = require('./src/config/db');
const { repository } = require('./src/repositories/dynamodb/inventory');
const { createApp } = require('./app');
try {
  const c = config(); const { db } = clients(c);
  if (c.mode === 'isolated') console.warn('ISOLATED MODE: never connect Allocation to this instance.');
  createApp(repository(db,c),c).listen(c.port,c.bindHost,() => console.log(`Inventory ${c.instanceId} running on ${c.bindHost}:${c.port}`));
} catch (err) { console.error(err.message); process.exitCode = 1; }
