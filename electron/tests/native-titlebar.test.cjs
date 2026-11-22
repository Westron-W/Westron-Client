const assert = require('node:assert/strict');
const test = require('node:test');
const { getTitleBarOverlayOptions } = require('../native-titlebar.cjs');

test('matches title bar backgrounds to the launcher base theme colors', () => {
  assert.equal(getTitleBarOverlayOptions('dark').color, '#0b0d11');
  assert.equal(getTitleBarOverlayOptions('light').color, '#f3f5f9');
});

test('matches title bar backgrounds to the enabled performance mode', () => {
  assert.equal(getTitleBarOverlayOptions('dark', 'performance').color, '#081110');
  assert.equal(getTitleBarOverlayOptions('dark', 'quality').color, '#120f0b');
  assert.equal(getTitleBarOverlayOptions('light', 'performance').color, '#edf7f4');
  assert.equal(getTitleBarOverlayOptions('light', 'quality').color, '#faf4ea');
  assert.equal(getTitleBarOverlayOptions('dark', 'performance', false).color, '#0b0d11');
});

test('matches native window control symbols to the selected theme accent', () => {
  assert.equal(getTitleBarOverlayOptions('dark').symbolColor, '#c1b2ff');
  assert.equal(getTitleBarOverlayOptions('dark', 'performance').symbolColor, '#78e1d0');
  assert.equal(getTitleBarOverlayOptions('dark', 'quality').symbolColor, '#efbd82');
  assert.equal(getTitleBarOverlayOptions('light').symbolColor, '#7659cf');
  assert.equal(getTitleBarOverlayOptions('light', 'performance').symbolColor, '#137f70');
  assert.equal(getTitleBarOverlayOptions('light', 'quality').symbolColor, '#9a5c1f');
});

test('rejects invalid title bar theme inputs', () => {
  assert.throws(() => getTitleBarOverlayOptions('blue'), /Arayüz teması/);
  assert.throws(() => getTitleBarOverlayOptions('dark', 'turbo'), /Performans teması/);
  assert.throws(() => getTitleBarOverlayOptions('dark', 'default', 'yes'), /teması seçimi/);
});
