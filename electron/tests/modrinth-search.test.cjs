const test = require('node:test');
const assert = require('node:assert/strict');
const { filterAndSortByEnglishPrefix } = require('../modrinth-search.cjs');

test('filters search hits to the typed English initial and sorts titles alphabetically', () => {
  const hits = [
    { project_id: 'extra', title: 'Sodium Extra' },
    { project_id: 'iris', title: 'Iris Shaders' },
    { project_id: 'base', title: 'Sodium' },
    { project_id: 'plus', title: 'Sodium Plus' },
  ];

  assert.deepEqual(filterAndSortByEnglishPrefix(hits, 's').map((hit) => hit.title), [
    'Sodium',
    'Sodium Extra',
    'Sodium Plus',
  ]);
});

test('preserves popular result ordering when the search is empty', () => {
  const hits = [{ title: 'Zeta' }, { title: 'Alpha' }];

  assert.deepEqual(filterAndSortByEnglishPrefix(hits, ''), hits);
});
