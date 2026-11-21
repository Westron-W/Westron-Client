const PERFORMANCE_PROJECTS = Object.freeze({
  fabric: Object.freeze([
    Object.freeze({ id: 'AANobbMI', title: 'Sodium' }),
    Object.freeze({ id: 'gvQqBUqZ', title: 'Lithium' }),
    Object.freeze({ id: 'uXXizFIs', title: 'FerriteCore' }),
    Object.freeze({ id: 'NNAgCjsB', title: 'Entity Culling' }),
    Object.freeze({ id: '5ZwdcRci', title: 'ImmediatelyFast' }),
    Object.freeze({ id: '51shyZVL', title: 'More Culling' }),
  ]),
  forge: Object.freeze([
    Object.freeze({ id: 'uXXizFIs', title: 'FerriteCore' }),
    Object.freeze({ id: 'NNAgCjsB', title: 'Entity Culling' }),
    Object.freeze({ id: '5ZwdcRci', title: 'ImmediatelyFast' }),
    Object.freeze({ id: 'zRbIdw61', title: 'Eternal FPS' }),
    Object.freeze({ id: 'hhD7kAzV', title: 'Eternal Render' }),
  ]),
});

const QUALITY_PROJECTS = Object.freeze({
  fabric: Object.freeze([
    Object.freeze({ id: 'uCdwusMi', title: 'Distant Horizons' }),
    Object.freeze({ id: '1IjD5062', title: 'Continuity' }),
    Object.freeze({ id: 'zV5r3pPn', title: '3D Skin Layers' }),
    Object.freeze({ id: '4I1XuqiY', title: 'Entity Model Features' }),
    Object.freeze({ id: 'yBW8D80W', title: 'LambDynamicLights' }),
  ]),
  forge: Object.freeze([
    Object.freeze({ id: 'uCdwusMi', title: 'Distant Horizons' }),
    Object.freeze({ id: '1IjD5062', title: 'Continuity' }),
    Object.freeze({ id: 'zV5r3pPn', title: '3D Skin Layers' }),
    Object.freeze({ id: '4I1XuqiY', title: 'Entity Model Features' }),
  ]),
});

const QUALITY_SHADER = Object.freeze({ id: 'HVnmMxH1', title: 'Complementary Shaders - Reimagined' });
const SHADER_LOADER = Object.freeze({ id: 'YL57xq9U', title: 'Iris Shaders' });

function getPerformancePresetProjects(mode, loader = 'fabric') {
  if (!['fabric', 'forge'].includes(loader)) {
    throw new Error('Performans profili yükleyicisi geçersiz.');
  }
  if (mode === 'performance') return [...PERFORMANCE_PROJECTS[loader]];
  if (mode === 'quality') return [...QUALITY_PROJECTS[loader]];
  throw new Error('Performans profili seçimi geçersiz.');
}

module.exports = { getPerformancePresetProjects, QUALITY_SHADER, SHADER_LOADER };
