import { importWvd, MAX_DEVICE_BYTES } from './cdm-browser.js';
import { loadDevice, saveDevice, restoreBundledDevice } from './cdm-device-store.js';
import { buildDownloadPath } from './naming.js';
import {
  clearDirectoryHandle,
  directoryPermission,
  loadDirectoryHandle,
  saveDirectoryHandle,
} from './output-directory.js';
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from './settings.js';

const field = (id) => document.getElementById(id);
const message = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);
for (const element of document.querySelectorAll('[data-i18n]')) {
  element.textContent = message(element.dataset.i18n) || element.textContent;
}
for (const element of document.querySelectorAll('[data-i18n-aria]')) {
  element.setAttribute('aria-label', message(element.dataset.i18nAria) || element.getAttribute('aria-label'));
}
document.documentElement.lang = chrome.i18n.getUILanguage?.().replaceAll('_', '-') || 'zh-CN';
document.title = `RPlay · ${message('drmSettings')}`;
let isBusy = false;
function showDevice(device) {
  field('deviceCard').dataset.state = 'ready';
  field('deviceStatus').textContent = message(device.bundled ? 'drmBundledReady' : 'drmDeviceReady');
  field('deviceHint').textContent = message(device.bundled ? 'drmBundledHint' : 'drmCustomHint');
  field('restore').hidden = Boolean(device.bundled);
}
function showStatus(key, kind = 'progress') {
  field('status').dataset.kind = kind;
  field('status').textContent = key ? message(key) : '';
}
function busy(value) {
  isBusy = value;
  field('save').disabled = value || !field('device').files.length;
  field('restore').disabled = value;
  field('device').disabled = value;
  field('settings').setAttribute('aria-busy', String(value));
}
function showSelection() {
  const file = field('device').files[0];
  field('selectedFile').hidden = !file;
  field('fileName').textContent = file?.name || '';
  field('fileSize').textContent = file ? `${(file.size / 1024).toFixed(1)} KB` : '';
  busy(isBusy);
}
busy(true);
loadDevice().then(showDevice).catch(() => {
  field('deviceCard').dataset.state = 'error';
  field('deviceStatus').textContent = message('drmMissingTitle');
  field('deviceHint').textContent = message('drmDeviceMissing');
  field('restore').hidden = false;
}).finally(() => busy(false));

field('device').addEventListener('change', () => {
  showSelection();
  showStatus('');
});
field('settings').addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = field('device').files[0];
  if (!file || isBusy) return;
  busy(true);
  showStatus('drmChecking');
  let bytes;
  try {
    if (file.size > MAX_DEVICE_BYTES) throw new Error('Invalid file size');
    bytes = new Uint8Array(await file.arrayBuffer());
    const device = await importWvd(bytes);
    await saveDevice(device);
    showDevice(device);
    field('device').value = '';
    showSelection();
    showStatus('drmSaved', 'success');
  } catch {
    showStatus('drmInvalidDevice', 'error');
  } finally {
    bytes?.fill(0);
    busy(false);
  }
});
field('restore').addEventListener('click', async () => {
  if (isBusy) return;
  busy(true);
  showStatus('drmRestoring');
  try {
    showDevice(await restoreBundledDevice());
    field('device').value = '';
    showSelection();
    showStatus('drmRestored', 'success');
  } catch {
    showStatus('drmRestoreFailed', 'error');
  } finally { busy(false); }
});

const namingFields = {
  defaultFolder: field('defaultFolder'),
  outputTemplate: field('outputTemplate'),
  saveMode: field('saveMode'),
  embyEnabled: field('embyEnabled'),
  embyMediaType: field('embyMediaType'),
  embyNfo: field('embyNfo'),
  embyImages: field('embyImages'),
};

const SAMPLE_TASK = {
  title: '示例视频标题',
  videoId: 'abc123',
  channel: '示例频道',
  channelId: 'UC123456',
  resolution: '1920x1080',
  width: 1920,
  height: 1080,
  duration: 3_723,
  createdAt: Date.UTC(2026, 6, 12, 10, 30, 0),
  releaseDate: null,
};

function readNamingForm() {
  return {
    defaultFolder: namingFields.defaultFolder.value,
    outputTemplate: namingFields.outputTemplate.value,
    saveMode: namingFields.saveMode.value,
    embyEnabled: namingFields.embyEnabled.checked,
    embyMediaType: namingFields.embyMediaType.value,
    embyNfo: namingFields.embyNfo.checked,
    embyImages: namingFields.embyImages.checked,
  };
}

function syncEmbyControls() {
  const enabled = namingFields.embyEnabled.checked;
  namingFields.embyMediaType.disabled = !enabled;
  namingFields.embyNfo.disabled = !enabled;
  namingFields.embyImages.disabled = !enabled;
}

function updatePreview() {
  const settings = normalizeSettings(readNamingForm());
  field('templatePreview').textContent = buildDownloadPath(SAMPLE_TASK, 'mp4', settings).path;
}

function writeNamingForm(values) {
  namingFields.defaultFolder.value = values.defaultFolder;
  namingFields.outputTemplate.value = values.outputTemplate;
  namingFields.saveMode.value = values.saveMode;
  namingFields.embyEnabled.checked = values.embyEnabled;
  namingFields.embyMediaType.value = values.embyMediaType;
  namingFields.embyNfo.checked = values.embyNfo;
  namingFields.embyImages.checked = values.embyImages;
  syncEmbyControls();
  updatePreview();
}

function showNamingStatus() {
  field('namingStatus').textContent = message('namingSaved');
  setTimeout(() => { field('namingStatus').textContent = ''; }, 2_000);
}

let namingSaveTimer;
function scheduleNamingSave() {
  updatePreview();
  syncEmbyControls();
  clearTimeout(namingSaveTimer);
  namingSaveTimer = setTimeout(async () => {
    await saveSettings(readNamingForm()).catch(() => {});
    showNamingStatus();
  }, 300);
}

for (const element of Object.values(namingFields)) {
  element.addEventListener('input', scheduleNamingSave);
  element.addEventListener('change', scheduleNamingSave);
}
field('resetNaming').addEventListener('click', async () => {
  writeNamingForm(DEFAULT_SETTINGS);
  await saveSettings(DEFAULT_SETTINGS).catch(() => {});
  showNamingStatus();
});
loadSettings().then(writeNamingForm).catch(() => writeNamingForm({ ...DEFAULT_SETTINGS }));

async function renderDirectoryState() {
  const state = field('directoryState');
  const handle = await loadDirectoryHandle();
  if (!handle) {
    state.dataset.state = '';
    state.textContent = message('namingDirectoryNone');
    return;
  }
  const permission = await directoryPermission(handle);
  if (permission === 'granted') {
    state.dataset.state = 'ready';
    state.textContent = message('namingDirectorySelected', [handle.name]);
  } else {
    state.dataset.state = '';
    state.textContent = message('namingDirectoryPermission', [handle.name]);
  }
}

field('pickDirectory').addEventListener('click', async () => {
  if (!window.showDirectoryPicker) {
    field('namingStatus').textContent = message('namingDirectoryUnsupported');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ id: 'rplay-output', mode: 'readwrite' });
    await directoryPermission(handle, { request: true });
    await saveDirectoryHandle(handle);
    await saveSettings({ useCustomDirectory: true });
    await renderDirectoryState();
    showNamingStatus();
  } catch {
    // The user cancelled the picker or denied permission; keep the old setting.
  }
});

field('clearDirectory').addEventListener('click', async () => {
  await clearDirectoryHandle().catch(() => {});
  await saveSettings({ useCustomDirectory: false }).catch(() => {});
  await renderDirectoryState();
});

renderDirectoryState().catch(() => {});
