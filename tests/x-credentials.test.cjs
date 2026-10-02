'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadXBearerToken } = require('../lib/launchpad/x-credentials.cjs');
const sample = 'example-bearer-token-for-tests-only';
test('X bearer environment setting takes priority without reading a file', () => {
  assert.equal(loadXBearerToken({X_BEARER_TOKEN: ` ${sample} `, X_CREDENTIALS_FILE: 'private'}, () => {throw new Error('must not read');}), sample);
});
test('private document selects bearer token, never consumer credentials', () => {
  for (const separator of ['\n', '\r\n', ': ', '=']) {
    assert.equal(loadXBearerToken({X_CREDENTIALS_FILE: 'private'}, () => `Consumer Key\nunused-key\nSecret Key\nunused-secret\nBearer Token${separator}${sample}\n`), sample);
  }
});
test('missing configuration stays disabled; errors never reveal document contents', () => {
  assert.equal(loadXBearerToken({}), undefined);
  assert.throws(() => loadXBearerToken({X_CREDENTIALS_FILE:'private'}, () => 'secret contents'), /no valid Bearer Token/);
  assert.throws(() => loadXBearerToken({X_CREDENTIALS_FILE:'private'}, () => {throw new Error('sensitive path');}), {message:'Unable to read the private X credentials file.'});
});
