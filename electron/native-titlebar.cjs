const TITLE_BAR_BACKGROUNDS = {
  dark: { default: '#0b0d11', performance: '#081110', quality: '#120f0b' },
  light: { default: '#f3f5f9', performance: '#edf7f4', quality: '#faf4ea' },
};

function getTitleBarOverlayOptions(theme, performanceMode = 'default', performanceThemeEnabled = true) {
  if (theme !== 'dark' && theme !== 'light') throw new Error('Arayüz teması geçersiz.');
  if (!['default', 'performance', 'quality'].includes(performanceMode)) {
    throw new Error('Performans teması geçersiz.');
  }
  if (typeof performanceThemeEnabled !== 'boolean') {
    throw new Error('Performans teması seçimi geçersiz.');
  }

  const mode = performanceThemeEnabled ? performanceMode : 'default';
  return {
    color: TITLE_BAR_BACKGROUNDS[theme][mode],
    symbolColor: theme === 'light' ? '#596274' : '#a0a6b2',
    height: 32,
  };
}

module.exports = { getTitleBarOverlayOptions };
