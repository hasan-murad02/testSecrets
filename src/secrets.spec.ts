import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSecret, getStatus, initSecretsManager } from './secrets';

const ok = (body: string) => ({ send: async () => ({ SecretString: body, $metadata: { requestId: 'req-1' } }) });
const FULL = JSON.stringify({ AWS_REGION: 'x', AWS_S3_BUCKET: 'b', AWS_S3_BASE_URL: 'u', EMPTY: '', NUM: 1 });

test('success', async () => {
  await initSecretsManager(ok(FULL));
  const s = getStatus();
  assert.equal(s.stage, 'ok');
  assert.equal(s.allRequiredKeysPresent, true);
  assert.equal(s.awsRequestId, 'req-1');
  assert.equal(getSecret('AWS_S3_BUCKET'), 'b');
  assert.equal(getSecret('EMPTY'), undefined); // empty values not cached
  assert.equal(getSecret('NUM'), undefined); // non-strings not cached
});

test('access denied', async () => {
  const err = Object.assign(new Error('secret-ish text'), { name: 'AccessDeniedException', $metadata: { requestId: 'req-2' } });
  await initSecretsManager({ send: async () => { throw err; } });
  const s = getStatus();
  assert.equal(s.stage, 'retrieval_failed');
  assert.equal(s.retrievalSucceeded, false);
  assert.equal(s.errorType, 'AccessDeniedException');
  assert.equal(s.awsRequestId, 'req-2');
  assert.equal(getSecret('AWS_REGION'), undefined);
});

test('invalid JSON clears cache and does not leak content', async () => {
  await initSecretsManager(ok(FULL)); // prime cache
  await initSecretsManager(ok('{"AWS_REGION":"LEAKME" oops'));
  const s = getStatus();
  assert.equal(s.stage, 'parse_failed');
  assert.equal(s.retrievalSucceeded, true);
  assert.equal(s.parsingSucceeded, false);
  assert.equal(getSecret('AWS_REGION'), undefined);
  assert.ok(!JSON.stringify(s).includes('LEAKME'));
});

test('missing keys', async () => {
  await initSecretsManager(ok(JSON.stringify({ AWS_REGION: 'x', AWS_S3_BUCKET: '' })));
  const s = getStatus();
  assert.equal(s.stage, 'missing_keys');
  assert.equal(s.retrievalSucceeded, true);
  assert.equal(s.parsingSucceeded, true);
  assert.deepEqual(s.missingKeys, ['AWS_S3_BUCKET', 'AWS_S3_BASE_URL']);
});
