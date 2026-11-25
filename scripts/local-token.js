const { config } = require('../src/config/env');
const jwt = require('jsonwebtoken');
const c = config();
if (c.issuer !== 'inventory-local-test' || c.audience !== 'inventory-local-test') throw Error('This helper is for local test credentials only.');
const role = process.argv[2] || 'admin';
if (!['admin','user'].includes(role)) throw Error('Use admin or user.');
console.log(jwt.sign({ sub: 'local-test-user', role, priority: 1 },c.secret,{ algorithm:'HS256', issuer:c.issuer, audience:c.audience, expiresIn:'30m' }));
