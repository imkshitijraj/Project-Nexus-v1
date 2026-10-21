import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../appearance.js', import.meta.url), 'utf8');
const key = 'nexus.appearance.v1';
function boot({ raw = null, dark = false, unavailable = false, full = false } = {}) {
  const entries = new Map(raw === null ? [] : [[key, raw]]);
  const listeners = new Map();
  const dataset = {};
  const meta = {};
  const changes = [];
  let systemHandler;
  const storage = {
    getItem: name => entries.get(name) ?? null,
    setItem: (name, value) => {
      if (full) throw new Error('Quota exceeded');
      entries.set(name, value);
    },
  };
  const media = { matches: dark, addEventListener: (name, listener) => { systemHandler = listener; } };
  const window = {
    get localStorage() { if (unavailable) throw new Error('Storage blocked'); return storage; },
    matchMedia: () => media,
    addEventListener: (name, listener) => listeners.set(name, listener),
    dispatchEvent: event => changes.push(event.detail),
  };
  vm.runInNewContext(source, {
    window,
    document: { documentElement: { dataset }, querySelector: () => meta },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
  });
  return {
    api: window.NexusAppearance, entries, dataset, meta, storage, changes,
    systemChange(matches) { media.matches = matches; systemHandler(); },
    storageChange(value, area = storage, eventKey = key) { listeners.get('storage')({ key: eventKey, newValue: value, storageArea: area }); },
  };
}

test('saved appearance is applied synchronously and stores only validated preferences', () => {
  const scene = boot({ raw: JSON.stringify({ version: 1, mode: 'dark', accent: 'ocean' }) });
  assert.equal(scene.dataset.theme, 'dark');
  assert.equal(scene.dataset.accent, 'ocean');
  assert.equal(scene.meta.content, '#101916');
  scene.api.set({ accent: 'amber', workspace: 'private data' });
  assert.deepEqual(JSON.parse(scene.entries.get(key)), { version: 1, mode: 'dark', accent: 'amber' });
  assert.equal(scene.entries.size, 1);
  assert.equal(Object.isFrozen(scene.api.get()), true);
});

test('malformed and unsupported saved preferences safely follow the device without overwriting storage', () => {
  for (const raw of ['{', 'null', '[]', '"dark"', 'x'.repeat(201), JSON.stringify({ version: 1, mode: 'dark', accent: '<script>' })]) {
    const scene = boot({ raw, dark: true });
    assert.equal(scene.dataset.theme, 'dark');
    assert.equal(scene.dataset.themeMode, 'system');
    assert.equal(scene.dataset.accent, 'forest');
    assert.equal(scene.entries.get(key), raw);
  }
});

test('system changes apply only while the system preference is selected', () => {
  const scene = boot();
  scene.systemChange(true);
  assert.equal(scene.dataset.theme, 'dark');
  scene.api.set({ mode: 'light' });
  scene.systemChange(true);
  assert.equal(scene.dataset.theme, 'light');
  scene.api.set({ mode: 'system' });
  assert.equal(scene.dataset.theme, 'dark');
});

test('blocked or full storage still permits in-memory appearance changes', () => {
  for (const config of [{ unavailable: true }, { full: true }]) {
    const scene = boot(config);
    const selected = scene.api.set({ mode: 'dark', accent: 'violet' });
    assert.equal(selected.persisted, false);
    assert.equal(scene.dataset.theme, 'dark');
    assert.equal(scene.dataset.accent, 'violet');
  }
});

test('cross-tab changes follow the correct storage area and removals restore defaults', () => {
  const scene = boot();
  const saved = JSON.stringify({ version: 1, mode: 'dark', accent: 'violet' });
  scene.storageChange(saved, {});
  assert.equal(scene.dataset.accent, 'forest');
  scene.storageChange(saved, scene.storage, 'unrelated');
  assert.equal(scene.dataset.accent, 'forest');
  scene.storageChange(saved);
  assert.equal(scene.dataset.accent, 'violet');
  scene.storageChange(null);
  assert.equal(scene.dataset.themeMode, 'system');
  assert.equal(scene.dataset.accent, 'forest');
  scene.api.set({ mode: 'dark' });
  scene.storageChange(null, scene.storage, null);
  assert.equal(scene.dataset.themeMode, 'system');
});

test('invalid setter values never become HTML attributes or persisted data', () => {
  const scene = boot();
  for (const patch of [null, { mode: 'url(javascript:1)' }, { accent: '<script>' }]) scene.api.set(patch);
  assert.equal(scene.dataset.themeMode, 'system');
  assert.equal(scene.dataset.accent, 'forest');
  assert.equal(scene.entries.size, 0);
});
