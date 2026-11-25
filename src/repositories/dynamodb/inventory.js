const { GetCommand, ScanCommand, PutCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiError, conflict } = require('../../middleware/errors');
function repository(db, c) {
  // Keep all pages: DynamoDB Scan stops after 1 MB, not after all records.
  async function send(command, signal) {
    try { return await db.send(command, { abortSignal: signal || AbortSignal.timeout(2700) }); }
    catch (err) {
      if (err.name === 'ConditionalCheckFailedException') throw conflict('Duplicate ID or concurrent change. Refresh and retry.');
      if (err.name === 'TransactionCanceledException' && err.CancellationReasons?.some(r => ['ConditionalCheckFailed', 'TransactionConflict'].includes(r.Code))) throw conflict('Duplicate ID, zone not empty, or concurrent change. Refresh and retry.');
      console.error(JSON.stringify({ event: 'database_error', name: err.name }));
      throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Inventory database unavailable or operation not confirmed.');
    }
  }
  async function scan(table) {
    const all = []; let cursor; const signal = AbortSignal.timeout(2700);
    do {
      const result = await send(new ScanCommand({ TableName: table, ConsistentRead: true, ExclusiveStartKey: cursor }), signal);
      all.push(...(result.Items || [])); cursor = result.LastEvaluatedKey;
    } while (cursor);
    return all;
  }
  async function get(table, key) { return (await send(new GetCommand({ TableName: table, Key: key, ConsistentRead: true }))).Item; }
  const tx = items => send(new TransactWriteCommand({ TransactItems: items }));
  const version = item => ({ ConditionExpression: '#v = :v AND '+(item.generation?'#g = :g':'attribute_not_exists(#g)'), ExpressionAttributeNames: { '#v': 'version', '#g':'generation' }, ExpressionAttributeValues: { ':v': item.version, ...(item.generation?{':g':item.generation}:{}) } });
  function zoneDelta(zone, delta) {
    return { Update: { TableName: c.zones, Key: { zone_id: zone.zone_id },
      UpdateExpression: 'SET #v = #v + :one, spot_count = spot_count + :delta, updated_at = :now',
      ...version(zone), ConditionExpression: version(zone).ConditionExpression+' AND spot_count >= :minimum',
      ExpressionAttributeValues: { ...version(zone).ExpressionAttributeValues, ':one': 1, ':delta': delta, ':minimum': delta < 0 ? 1 : 0, ':now': new Date().toISOString() } } };
  }
  return {
    zones: () => scan(c.zones), spots: () => scan(c.spots),
    zone: id => get(c.zones, { zone_id: id }), spot: id => get(c.spots, { spot_id: id }),
    createZone: item => send(new PutCommand({ TableName: c.zones, Item: item, ConditionExpression: 'attribute_not_exists(zone_id)' })),
    updateZone: (old, item) => send(new PutCommand({ TableName: c.zones, Item: item, ...version(old) })),
    deleteZone: old => tx([{ Delete: { TableName: c.zones, Key: { zone_id: old.zone_id }, ...version(old), ConditionExpression: version(old).ConditionExpression+' AND spot_count = :zero', ExpressionAttributeValues: { ...version(old).ExpressionAttributeValues, ':zero': 0 } } }]),
    createSpot: (item, zone) => tx([{ Put: { TableName: c.spots, Item: item, ConditionExpression: 'attribute_not_exists(spot_id)' } }, zoneDelta(zone, 1)]),
    updateSpot: (old, item) => send(new PutCommand({ TableName: c.spots, Item: item, ...version(old) })),
    deleteSpot: (old, zone) => tx([{ Delete: { TableName: c.spots, Key: { spot_id: old.spot_id }, ...version(old) } }, zoneDelta(zone, -1)])
  };
}
module.exports = { repository };
