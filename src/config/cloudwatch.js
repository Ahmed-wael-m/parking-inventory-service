
const {
  CloudWatchLogsClient,
  PutLogEventsCommand
} = require('@aws-sdk/client-cloudwatch-logs');

const client = new CloudWatchLogsClient({
  region: 'us-east-1',
  endpoint: 'http://localhost:4566',
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test'
  }
});

async function writeLog(data) {
  const message = JSON.stringify(data);

  // Keep the existing terminal logging
  console.log(message);

  if (process.env.USE_CLOUDWATCH !== 'true') {
    return;
  }

  try {
    await client.send(new PutLogEventsCommand({
      logGroupName: '/aws/ecs/parking-inventory',
      logStreamName: 'app-audit-stream',
      logEvents: [
        {
          message: message,
          timestamp: Date.now()
        }
      ]
    }));
  } catch (error) {
    console.error('CloudWatch logging failed:', error.name);
  }
}

module.exports = { writeLog };
