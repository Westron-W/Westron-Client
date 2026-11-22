const TITLE_BAR_BACKGROUNDS = {
  dark: { default: '#0b0d11', performance: '#081110', quality: '#120f0b' },
  light: { default: '#f3f5f9', performance: '#edf7f4', quality: '#faf4ea' },
};
const TITLE_BAR_SYMBOL_COLORS = {
  dark: { default: '#c1b2ff', performance: '#78e1d0', quality: '#efbd82' },
  light: { default: '#7659cf', performance: '#137f70', quality: '#9a5c1f' },
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
    symbolColor: TITLE_BAR_SYMBOL_COLORS[theme][mode],
    height: 32,
  };
}

module.exports = { getTitleBarOverlayOptions };
