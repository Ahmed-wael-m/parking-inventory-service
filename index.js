const { config } = require('./src/config/env');
const { clients } = require('./src/config/db');
const { repository } = require('./src/repositories/dynamodb/inventory');
const { createApp } = require('./app');
const { loadSecrets } = require('./src/config/secrets');

async function start() {
  if (process.env.USE_SECRETS_MANAGER === 'true') {
    await loadSecrets();
  }

  const c = config();
  const { db } = clients(c);

  if (c.mode === 'isolated') {
    console.warn(
      'ISOLATED MODE: never connect Allocation to this instance.'
    );
  }

  createApp(repository(db, c), c).listen(
    c.port,
    c.bindHost,
    () => console.log(
      `Inventory ${c.instanceId} running on ${c.bindHost}:${c.port}`
    )
  );
}

start().catch(error => {
  console.error('Inventory startup failed:', error.name);
  process.exitCode = 1;
});
