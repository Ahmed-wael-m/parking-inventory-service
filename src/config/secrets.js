
const {
  SecretsManagerClient,
  GetSecretValueCommand
} = require('@aws-sdk/client-secrets-manager');

async function loadSecrets() {
  const client = new SecretsManagerClient({
    region: 'us-east-1',
    endpoint: 'http://localhost:4566',
    credentials: {
      accessKeyId: 'test',
      secretAccessKey: 'test'
    }
  });

  const result = await client.send(
    new GetSecretValueCommand({
      SecretId: 'parking-inventory/config'
    })
  );

  const secrets = JSON.parse(result.SecretString);

  const keys = [
    'JWT_SECRET',
    'JWT_ISSUER',
    'JWT_AUDIENCE',
    'INVENTORY_TOKEN',
    'INVENTORY_LOCATION_TOKEN'
  ];

  for (const key of keys) {
    if (typeof secrets[key] !== 'string') {
      throw new Error(`Missing or invalid secret field: ${key}`);
    }
  }

  for (const key of keys) {
    process.env[key] = secrets[key];
  }

  console.log('Configuration loaded from Secrets Manager.');
}

module.exports = { loadSecrets };
