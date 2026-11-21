const test = require('node:test');
const assert = require('node:assert/strict');
const { getPerformancePresetProjects, QUALITY_SHADER, SHADER_LOADER } = require('../performance-presets.cjs');

test('performance and quality presets expose loader-specific compatible Modrinth projects', () => {
  const performance = getPerformancePresetProjects('performance');
  const quality = getPerformancePresetProjects('quality');
  const forgePerformance = getPerformancePresetProjects('performance', 'forge');
  const forgeQuality = getPerformancePresetProjects('quality', 'forge');
  const performanceIds = performance.map((project) => project.id);
  const qualityIds = quality.map((project) => project.id);

  assert.ok(performance.some((project) => project.id === 'AANobbMI'));
  assert.ok(quality.some((project) => project.id === 'uCdwusMi'));
  assert.ok(quality.some((project) => project.id === '4I1XuqiY'));
  assert.ok(quality.some((project) => project.id === 'zV5r3pPn'));
  assert.ok(!quality.some((project) => project.id === 'OVuFYfre'));
  assert.equal(new Set(performanceIds).size, performanceIds.length);
  assert.equal(new Set(qualityIds).size, qualityIds.length);
  assert.ok(!forgePerformance.some((project) => project.id === 'AANobbMI'));
  assert.ok(forgePerformance.some((project) => project.id === 'zRbIdw61'));
  assert.ok(forgePerformance.some((project) => project.id === 'hhD7kAzV'));
  assert.ok(!forgeQuality.some((project) => project.id === 'yBW8D80W'));
  assert.equal(QUALITY_SHADER.id, 'HVnmMxH1');
  assert.equal(SHADER_LOADER.id, 'YL57xq9U');
  assert.throws(() => getPerformancePresetProjects('default'), /geçersiz/i);
  assert.throws(() => getPerformancePresetProjects('quality', 'vanilla'), /yükleyicisi/i);
});
