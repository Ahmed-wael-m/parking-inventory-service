const { config } = require('../src/config/env');
const { clients } = require('../src/config/db');
const { CreateTableCommand, DescribeTableCommand, waitUntilTableExists } = require('@aws-sdk/client-dynamodb');
const { repository } = require('../src/repositories/dynamodb/inventory');
const { inventory } = require('../src/services/inventory');
async function createTables(raw, c) {
  for (const [name, key] of [[c.zones,'zone_id'],[c.spots,'spot_id']]) {
    try { await raw.send(new CreateTableCommand({ TableName: name, BillingMode: 'PAY_PER_REQUEST', KeySchema: [{ AttributeName: key, KeyType: 'HASH' }], AttributeDefinitions: [{ AttributeName: key, AttributeType: 'S' }] })); }
    catch (err) { if (err.name !== 'ResourceInUseException') throw err; }
    await waitUntilTableExists({ client: raw, maxWaitTime: 30, minDelay: 1, maxDelay: 3 }, { TableName: name });
    const { Table } = await raw.send(new DescribeTableCommand({ TableName: name }));
    if (Table.KeySchema.length !== 1 || Table.KeySchema[0].AttributeName !== key || !Table.AttributeDefinitions.some(a => a.AttributeName === key && a.AttributeType === 'S')) throw Error(`Unexpected schema for ${name}`);
    console.log(`${name}: table exists`);
  }
}
async function main() {
  const c = config(); const { raw, db } = clients(c); await createTables(raw,c);
  const repo = repository(db,c), s = inventory(repo,c);
  if (!await repo.zone('zone_1')) await s.createZone({ zone_id: 'zone_1', zone_name: 'Zone 1', description: 'Initial sample zone' });
  for (const [spot_id, spot_type] of [['A1','standard'],['A2','accessible']]) {
    if (!await repo.spot(spot_id)) await s.createSpot({ spot_id, zone_id: 'zone_1', spot_type, active: true });
    else console.log(`${spot_id}: existing record preserved`);
  }
  console.log('Seed finished. Existing records were not overwritten.'); raw.destroy();
}
if (require.main === module) main().catch(e => { console.error('Setup failed:', e.name, e.message); process.exitCode = 1; });
module.exports = { createTables };
