/* Runs before CSS paints. Keep this external script compatible with the strict CSP. */
(() => {
  'use strict';
  const key = 'nexus.appearance.v1';
  const modes = ['light', 'dark', 'system'];
  const accents = ['forest', 'ocean', 'violet', 'amber'];
  const defaults = () => ({ mode: 'system', accent: 'forest' });
  const parse = raw => {
    if (!raw || raw.length > 200) return defaults();
    try {
      const value = JSON.parse(raw);
      if (!value || value.version !== 1 || !modes.includes(value.mode) || !accents.includes(value.accent)) return defaults();
      return { mode: value.mode, accent: value.accent };
    } catch { return defaults(); }
  };
  let storage = null;
  let preference = defaults();
  let persisted = true;
  try {
    storage = window.localStorage;
    preference = parse(storage.getItem(key));
  } catch { persisted = false; }
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const snapshot = () => Object.freeze({
    ...preference,
    resolved: preference.mode === 'system' ? (system.matches ? 'dark' : 'light') : preference.mode,
    persisted,
  });
  const apply = () => {
    const value = snapshot();
    document.documentElement.dataset.theme = value.resolved;
    document.documentElement.dataset.accent = value.accent;
    document.documentElement.dataset.themeMode = value.mode;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = value.resolved === 'dark' ? '#101916' : '#f8faf8';
    window.dispatchEvent(new CustomEvent('nexus:appearance', { detail: value }));
    return value;
  };
  const set = patch => {
    if (!patch || (patch.mode !== undefined && !modes.includes(patch.mode)) ||
        (patch.accent !== undefined && !accents.includes(patch.accent))) return snapshot();
    preference = {
      mode: patch.mode ?? preference.mode,
      accent: patch.accent ?? preference.accent,
    };
    try {
      if (!storage) throw new Error('Appearance storage is unavailable');
      storage.setItem(key, JSON.stringify({ version: 1, ...preference }));
      persisted = true;
    } catch { persisted = false; }
    return apply();
  };
  Object.defineProperty(window, 'NexusAppearance', {
    value: Object.freeze({ get: snapshot, set }),
    writable: false,
    configurable: false,
  });
  system.addEventListener('change', () => {
    if (preference.mode === 'system') apply();
  });
  window.addEventListener('storage', event => {
    if ((event.key !== key && event.key !== null) || (event.storageArea && event.storageArea !== storage)) return;
    preference = parse(event.key === null ? null : event.newValue);
    persisted = storage !== null;
    apply();
  });
  apply();
})();
