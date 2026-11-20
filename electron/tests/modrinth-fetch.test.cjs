const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchWithRetry } = require('../modrinth-fetch.cjs');

test('retries transient Modrinth responses and returns the successful response', async () => {
  let calls = 0;
  const response = await fetchWithRetry('https://api.modrinth.com/test', {}, {
    fetchImpl: async () => {
      calls += 1;
      return new Response('', { status: calls === 1 ? 503 : 200 });
    },
    waitImpl: async () => {},
  });

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test('does not retry permanent client errors', async () => {
  let calls = 0;
  const response = await fetchWithRetry('https://api.modrinth.com/test', {}, {
    fetchImpl: async () => {
      calls += 1;
      return new Response('', { status: 404 });
    },
    waitImpl: async () => {},
  });

  assert.equal(response.status, 404);
  assert.equal(calls, 1);
});

test('retries transient network failures but surfaces the final failure', async () => {
  let calls = 0;
  const response = await fetchWithRetry('https://api.modrinth.com/test', {}, {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('network unavailable');
      return new Response('', { status: 200 });
    },
    waitImpl: async () => {},
  });

  assert.equal(response.status, 200);
  assert.equal(calls, 2);

  await assert.rejects(fetchWithRetry('https://api.modrinth.com/test', {}, {
    attempts: 2,
    fetchImpl: async () => { throw new TypeError('network unavailable'); },
    waitImpl: async () => {},
  }), /network unavailable/);
});
