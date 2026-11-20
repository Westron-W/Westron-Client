const test = require('node:test');
const assert = require('node:assert/strict');
const { getPerformancePresetProjects, QUALITY_SHADER, SHADER_LOADER } = require('../performance-presets.cjs');

test('performance and quality presets expose distinct curated Modrinth projects', () => {
  const performance = getPerformancePresetProjects('performance');
  const quality = getPerformancePresetProjects('quality');
  const ids = [...performance, ...quality].map((project) => project.id);

  assert.ok(performance.some((project) => project.id === 'AANobbMI'));
  assert.ok(quality.some((project) => project.id === 'uCdwusMi'));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(QUALITY_SHADER.id, 'HVnmMxH1');
  assert.equal(SHADER_LOADER.id, 'YL57xq9U');
  assert.throws(() => getPerformancePresetProjects('default'), /geçersiz/i);
});
