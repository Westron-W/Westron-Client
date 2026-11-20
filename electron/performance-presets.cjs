const PERFORMANCE_PROJECTS = Object.freeze([
  Object.freeze({ id: 'AANobbMI', title: 'Sodium' }),
  Object.freeze({ id: 'gvQqBUqZ', title: 'Lithium' }),
  Object.freeze({ id: 'uXXizFIs', title: 'FerriteCore' }),
  Object.freeze({ id: 'NNAgCjsB', title: 'Entity Culling' }),
  Object.freeze({ id: '5ZwdcRci', title: 'ImmediatelyFast' }),
]);

const QUALITY_PROJECTS = Object.freeze([
  Object.freeze({ id: 'uCdwusMi', title: 'Distant Horizons' }),
  Object.freeze({ id: '1IjD5062', title: 'Continuity' }),
  Object.freeze({ id: 'OVuFYfre', title: 'Enhanced Block Entities' }),
]);

const QUALITY_SHADER = Object.freeze({ id: 'HVnmMxH1', title: 'Complementary Shaders - Reimagined' });
const SHADER_LOADER = Object.freeze({ id: 'YL57xq9U', title: 'Iris Shaders' });

function getPerformancePresetProjects(mode) {
  if (mode === 'performance') return [...PERFORMANCE_PROJECTS];
  if (mode === 'quality') return [...QUALITY_PROJECTS];
  throw new Error('Performans profili seçimi geçersiz.');
}

module.exports = { getPerformancePresetProjects, QUALITY_SHADER, SHADER_LOADER };
