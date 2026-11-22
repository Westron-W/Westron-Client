import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeSmtpPassword } from '../src/mailer.js';

test('removes display whitespace from Gmail app passwords', () => {
  assert.equal(normalizeSmtpPassword('smtp.gmail.com', 'abcd efgh ijkl mnop'), 'abcdefghijklmnop');
});

test('preserves passwords for other SMTP providers', () => {
  assert.equal(normalizeSmtpPassword('smtp.example.com', 'secret with spaces'), 'secret with spaces');
});
