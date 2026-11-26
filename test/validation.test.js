const test = require('node:test');
const assert = require('node:assert/strict');
const { id } = require('../src/services/validation');

test('accepts a 64-character parking spot ID', () => {
  assert.equal(id('A'.repeat(64), 'spot_id').length, 64);
});

test('rejects a parking spot ID longer than 64 characters', () => {
  assert.throws(() => id('A'.repeat(65), 'spot_id'));
});

test('preserves the 40-character zone ID limit', () => {
  assert.equal(id('Z'.repeat(40), 'zone_id').length, 40);
  assert.throws(() => id('Z'.repeat(41), 'zone_id'));
});

test('preserves the 40-character hold ID limit', () => {
  assert.equal(id('H'.repeat(40), 'hold_id').length, 40);
  assert.throws(() => id('H'.repeat(41), 'hold_id'));
});

test('accepts valid parking spot ID characters', () => {
  assert.equal(id('Zone_1-A25', 'spot_id'), 'Zone_1-A25');
});

test('rejects invalid parking spot IDs', () => {
  assert.throws(() => id('A1@#', 'spot_id'));
  assert.throws(() => id('A 1', 'spot_id'));
  assert.throws(() => id('A1\n', 'spot_id'));
  assert.throws(() => id('', 'spot_id'));
  assert.throws(() => id(123, 'spot_id'));
});