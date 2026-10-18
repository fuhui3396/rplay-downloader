import { formatDate } from './output-template.js';

function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[character]));
}

function tag(name, value) {
  const text = String(value ?? '').trim();
  return text ? `  <${name}>${xmlEscape(text)}</${name}>` : '';
}

function uniqueIdTag(task) {
  return task.videoId ? `  <uniqueid type="rplay" default="true">${xmlEscape(task.videoId)}</uniqueid>` : '';
}

function runtimeMinutes(duration) {
  return Number.isFinite(duration) && duration > 0 ? Math.max(1, Math.round(duration / 60)) : '';
}

function episodeInfo(task) {
  const value = task.releaseDate || task.createdAt;
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    season: date.getUTCFullYear(),
    episode: (date.getUTCMonth() + 1) * 100 + date.getUTCDate(),
    aired: formatDate(date, '%Y-%m-%d'),
  };
}

function buildXml(root, lines) {
  return [
    '<?xml version="1.0" encoding="utf-8" standalone="yes"?>',
    `<${root}>`,
    ...lines.filter(Boolean),
    `</${root}>`,
    '',
  ].join('\n');
}

function seriesDirectories(directory) {
  if (!directory) return { seriesDir: '', seasonDir: '' };
  const segments = directory.split('/');
  if (/^season[\s._-]*\d*$/i.test(segments[segments.length - 1] || '')) {
    return { seriesDir: segments.slice(0, -1).join('/'), seasonDir: directory };
  }
  return { seriesDir: directory, seasonDir: '' };
}

export function buildItemNfo(task, settings) {
  const info = episodeInfo(task);
  const description = task.description || '';
  if (settings.embyMediaType === 'movie') {
    return buildXml('movie', [
      tag('title', task.title),
      tag('originaltitle', task.title),
      tag('plot', description),
      tag('outline', description),
      tag('studio', task.channel),
      uniqueIdTag(task),
      tag('premiered', info?.aired),
      tag('releasedate', info?.aired),
      tag('runtime', runtimeMinutes(task.duration)),
    ]);
  }
  return buildXml('episodedetails', [
    tag('title', task.title),
    tag('showtitle', task.channel || task.title),
    tag('season', info?.season),
    tag('episode', info?.episode),
    tag('plot', description),
    tag('aired', info?.aired),
    tag('runtime', runtimeMinutes(task.duration)),
    tag('studio', task.channel),
    uniqueIdTag(task),
  ]);
}

export function buildTvShowNfo(task) {
  return buildXml('tvshow', [
    tag('title', task.channel || task.title),
    tag('plot', task.description),
    tag('studio', task.channel),
    task.channelId ? `  <uniqueid type="rplay" default="true">${xmlEscape(task.channelId)}</uniqueid>` : '',
  ]);
}

export function buildSeasonNfo(task) {
  const info = episodeInfo(task);
  return buildXml('season', [tag('seasonnumber', info?.season)]);
}

export function buildSidecarPlan(task, settings, target) {
  if (!target || !target.basename) return { files: [], images: [] };
  const directory = target.directory;
  const base = directory ? `${directory}/${target.basename}` : target.basename;
  const files = [];
  const images = [];

  if (settings.embyImages) {
    const poster = task.posterUrl || task.thumbUrl || '';
    const fanart = task.fanartUrl || task.posterUrl || task.thumbUrl || '';
    const thumb = task.thumbUrl || task.posterUrl || '';
    if (poster) images.push({ filename: `${base}-poster.jpg`, url: poster });
    if (fanart) images.push({ filename: `${base}-fanart.jpg`, url: fanart });
    if (thumb) images.push({ filename: `${base}-thumb.jpg`, url: thumb });
  }

  if (settings.embyNfo) {
    files.push({ filename: `${base}.nfo`, content: buildItemNfo(task, settings), conflictAction: 'uniquify' });
    if (settings.embyMediaType === 'tv') {
      const { seriesDir, seasonDir } = seriesDirectories(directory);
      if (seriesDir) {
        files.push({ filename: `${seriesDir}/tvshow.nfo`, content: buildTvShowNfo(task), conflictAction: 'overwrite' });
      }
      if (seasonDir) {
        files.push({ filename: `${seasonDir}/season.nfo`, content: buildSeasonNfo(task), conflictAction: 'overwrite' });
      }
    }
  }
  return { files, images };
}