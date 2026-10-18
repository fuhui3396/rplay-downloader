import { DEFAULT_OUTPUT_TEMPLATE, renderTemplate } from './output-template.js';

export function normalizeVideoTitle(value) {
  const normalized = String(value || '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(/\s*[|｜]\s*RPLAY\s*$/i, '')
    .trim();
  return /^(?:rplay|rplay\.live)$/i.test(normalized) ? '' : normalized;
}

export function selectVideoTitle(candidates) {
  for (const candidate of candidates) {
    const title = normalizeVideoTitle(candidate);
    if (title) return title;
  }
  return '';
}

const RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function sanitizePathSegment(value) {
  const cleaned = String(value ?? '')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!cleaned || RESERVED_NAMES.test(cleaned)) return cleaned ? `_${cleaned}` : '';
  return [...cleaned].slice(0, 120).join('');
}

export function sanitizeFilename(value) {
  return sanitizePathSegment(normalizeVideoTitle(value || 'rplay')) || 'rplay';
}

function toDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date;
}

// Values are inserted into a path, so separators inside a field must never
// create extra directories (the template controls structure, not the data).
function asFieldText(value) {
  return String(value ?? '').replace(/[\\/]+/g, '_');
}

export function buildTemplateFields(task, extension) {
  return {
    title: asFieldText(normalizeVideoTitle(task?.title) || 'rplay'),
    id: asFieldText(task?.videoId || ''),
    channel: asFieldText(task?.channel || ''),
    channel_id: asFieldText(task?.channelId || ''),
    upload_date: toDate(task?.createdAt),
    release_date: toDate(task?.releaseDate),
    resolution: asFieldText(task?.resolution || ''),
    width: task?.width || '',
    height: task?.height || '',
    duration: Number.isFinite(task?.duration) ? Math.round(task.duration) : '',
    ext: asFieldText(extension || 'mp4'),
  };
}

function splitSegments(value) {
  return String(value ?? '').split(/[\\/]+/);
}

function joinPath(segments) {
  return segments.join('/');
}

export function buildDownloadPath(task, extension, settings) {
  const fields = buildTemplateFields(task, extension);
  const template = settings?.outputTemplate || DEFAULT_OUTPUT_TEMPLATE;
  const folderSegments = splitSegments(settings?.defaultFolder || '').map(sanitizePathSegment).filter(Boolean);
  const extensionSuffix = `.${fields.ext}`;

  const render = (candidate) => {
    const segments = splitSegments(renderTemplate(candidate, fields))
      .map(sanitizePathSegment)
      .filter(Boolean);
    const name = segments.pop() || '';
    if (!name) return;
    const filename = name.toLowerCase().endsWith(extensionSuffix.toLowerCase())
      ? name : `${name}${extensionSuffix}`;
    const directory = joinPath([...folderSegments, ...segments].filter(Boolean));
    const path = joinPath([directory, filename].filter(Boolean));
    return { path, directory, name: filename, basename: filename.slice(0, filename.length - extensionSuffix.length) };
  };

  return render(template) || render(DEFAULT_OUTPUT_TEMPLATE) || {
    path: `rplay_${fields.ext}`,
    directory: '',
    name: `rplay_${fields.ext}`,
    basename: 'rplay',
  };
}

export function makeDownloadFilename(task, extension) {
  return buildDownloadPath(task, extension, null).name;
}