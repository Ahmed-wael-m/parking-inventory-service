
// Inventory ECS configuration for Lab 8 simulation.
const fs = require('node:fs');

// Receive existing IAM role ARNs from the Bash script.
const [taskRoleArn, executionRoleArn] = process.argv.slice(2);

if (!taskRoleArn || !executionRoleArn) {
  throw new Error('Missing Inventory IAM role ARNs');
}

// Read non-sensitive application settings.
const settings = JSON.parse(
  fs.readFileSync('infra/inventory-task-settings.json', 'utf8')
);

const env = settings.environment || {};

// Allow only the application's known configuration variables.
const allowed = [
  'AWS_REGION',
  'DYNAMODB_ENDPOINT',
  'PORT',
  'BIND_HOST',
  'ZONES_TABLE',
  'SPOTS_TABLE',
  'INVENTORY_SAFETY_MODE',
  'INVENTORY_HOLDS_READY',
  'RATE_LIMIT_MAX',
  'CORS_ORIGINS',
  'USE_SECRETS_MANAGER',
  'USE_CLOUDWATCH'
];

for (const [name, value] of Object.entries(env)) {
  if (!allowed.includes(name) || typeof value !== 'string') {
    throw new Error('Invalid environment setting: ' + name);
  }
}

// Secrets are retrieved by the existing backend.
if (Object.keys(settings.secretNames || {}).length !== 0) {
  throw new Error('Use existing application secret retrieval');
}

if (env.USE_SECRETS_MANAGER !== 'true' ||
    env.USE_CLOUDWATCH !== 'true' ||
    env.PORT !== '3002') {
  throw new Error('Invalid Inventory runtime settings');
}

// Define the simulated ECS task.
const task = {
  family: 'parking-inventory',
  cpu: '256',
  memory: '512',
  networkMode: 'awsvpc',
  requiresCompatibilities: ['FARGATE'],

  taskRoleArn,
  executionRoleArn,

  containerDefinitions: [
    {
      name: 'inventory',
      image: 'parking-inventory:local',
      essential: true,

      portMappings: [
        {
          containerPort: 3002,
          protocol: 'tcp'
        }
      ],

      environment: Object.entries(env).map(
        ([name, value]) => ({ name, value })
      ),

      logConfiguration: {
        logDriver: 'awslogs',
        options: {
          'awslogs-group': '/aws/ecs/parking-inventory',
          'awslogs-region': 'us-east-1',
          'awslogs-stream-prefix': 'inventory'
        }
      }
    }
  ]
};

// Save the generated task definition locally.
fs.mkdirSync('.local/runtime', { recursive: true });

fs.writeFileSync(
  '.local/runtime/inventory-task.json',
  JSON.stringify(task, null, 2),
  { mode: 0o600 }
);

console.log('Inventory ECS task definition generated.');
