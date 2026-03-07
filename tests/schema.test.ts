import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSimpleYaml, validateConfig } from '../src/config/schema.ts';

const sample = `
lotto:
  mode: fixed
  count: 2
  fixed_numbers: [3, 11, 19, 23, 37, 42]
pension:
  mode: fixed
  count: 1
  fixed:
    group: 4
    number: "123456"
notifications:
  single_chat: true
  dry_run_prefix: "[DRY-RUN]"
  live_prefix: "[LIVE]"
`;

test('validateConfig accepts the documented config shape', () => {
  const config = validateConfig(parseSimpleYaml(sample));
  assert.equal(config.lotto.count, 2);
  assert.deepEqual(config.lotto.fixed_numbers, [3, 11, 19, 23, 37, 42]);
});

test('validateConfig rejects invalid lotto numbers', () => {
  assert.throws(() => validateConfig(parseSimpleYaml(sample.replace('[3, 11, 19, 23, 37, 42]', '[3, 3, 19, 23, 37, 42]'))));
});
