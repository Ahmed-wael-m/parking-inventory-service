
const {
  SecretsManagerClient,
  CreateSecretCommand,
  GetSecretValueCommand
} = require('@aws-sdk/client-secrets-manager');

const { config } = require('../src/config/env');

async function setup() {
  const c = config();

  if (c.mode !== 'isolated') {
    throw new Error('Use isolated testing mode for this setup.');
  }

  const client = new SecretsManagerClient({
    region: 'us-east-1',
    endpoint: 'http://localhost:4566',
    credentials: {
      accessKeyId: 'test',
      secretAccessKey: 'test'
    }
  });

  const secretName = 'parking-inventory/config';

  const values = {
    JWT_SECRET: c.secret,
    JWT_ISSUER: c.issuer,
    JWT_AUDIENCE: c.audience,
    INVENTORY_TOKEN: c.token,
    INVENTORY_LOCATION_TOKEN: c.locationToken
  };

  try {
    await client.send(new CreateSecretCommand({
      Name: secretName,
      Description: 'Inventory service configuration',
      SecretString: JSON.stringify(values)
    }));

    console.log('Inventory secret created successfully.');
  } catch (error) {
    if (error.name !== 'ResourceExistsException') {
      throw error;
    }

    console.log('Inventory secret already exists.');
  }

  const result = await client.send(
    new GetSecretValueCommand({
      SecretId: secretName
    })
  );

  const stored = JSON.parse(result.SecretString);

  const matches = Object.keys(values).every(
    key => stored[key] === values[key]
  );

  if (!matches) {
    throw new Error('Stored configuration does not match local credentials.');
  }

  console.log('Secret retrieval and verification passed.');
}

setup().catch(error => {
  console.error('Secret setup failed:', error.name);
  process.exitCode = 1;
});
