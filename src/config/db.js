const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
function clients(c) {
  // Emulator only: never use real AWS credentials here.
  const raw = new DynamoDBClient({ region: c.region, endpoint: c.endpoint,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' }, maxAttempts: 1,
    requestHandler: new NodeHttpHandler({ connectionTimeout: 800, requestTimeout: 2000 }) });
  return { raw, db: DynamoDBDocumentClient.from(raw) };
}
module.exports = { clients };
