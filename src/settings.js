import { DEFAULT_OUTPUT_TEMPLATE } from './output-template.js';

export const SETTINGS_KEY = 'rplaySettings';

export const SAVE_MODES = Object.freeze(['folder', 'ask']);
export const EMBY_MEDIA_TYPES = Object.freeze(['tv', 'movie']);

export const DEFAULT_SETTINGS = Object.freeze({
  saveMode: 'folder',
  defaultFolder: 'RPlay',
  outputTemplate: DEFAULT_OUTPUT_TEMPLATE,
  embyEnabled: true,
  embyMediaType: 'tv',
  embyNfo: true,
  embyImages: true,
  useCustomDirectory: false,
});

function normalizeString(value, fallback, { allowEmpty = true, limit = 512 } = {}) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.replace(/\r\n?/g, '\n');
  const result = allowEmpty ? trimmed : trimmed.trim();
  if (!allowEmpty && result.trim() === '') return fallback;
  return [...result].slice(0, limit).join('');
}

export function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    saveMode: SAVE_MODES.includes(source.saveMode) ? source.saveMode : DEFAULT_SETTINGS.saveMode,
    defaultFolder: normalizeString(source.defaultFolder, DEFAULT_SETTINGS.defaultFolder),
    outputTemplate: normalizeString(source.outputTemplate, DEFAULT_SETTINGS.outputTemplate, { allowEmpty: false }),
    embyEnabled: typeof source.embyEnabled === 'boolean' ? source.embyEnabled : DEFAULT_SETTINGS.embyEnabled,
    embyMediaType: EMBY_MEDIA_TYPES.includes(source.embyMediaType)
      ? source.embyMediaType : DEFAULT_SETTINGS.embyMediaType,
    embyNfo: typeof source.embyNfo === 'boolean' ? source.embyNfo : DEFAULT_SETTINGS.embyNfo,
    embyImages: typeof source.embyImages === 'boolean' ? source.embyImages : DEFAULT_SETTINGS.embyImages,
    useCustomDirectory: typeof source.useCustomDirectory === 'boolean'
      ? source.useCustomDirectory : DEFAULT_SETTINGS.useCustomDirectory,
  };
}

function storageArea() {
  if (typeof chrome === 'undefined' || !chrome.storage) return null;
  return chrome.storage.sync || chrome.storage.local || null;
}

export async function loadSettings() {
  const area = storageArea();
  if (!area) return { ...DEFAULT_SETTINGS };
  const stored = await area.get(SETTINGS_KEY).catch(() => ({}));
  return normalizeSettings(stored?.[SETTINGS_KEY]);
}

export async function saveSettings(patch) {
  const current = await loadSettings();
  const next = normalizeSettings({ ...current, ...patch });
  const area = storageArea();
  if (area) await area.set({ [SETTINGS_KEY]: next });
  return next;
}