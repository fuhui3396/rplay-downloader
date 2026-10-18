import { describe, expect, it } from 'vitest';
import { formatDate, renderTemplate } from '../src/output-template.js';

const date = new Date(Date.UTC(2026, 6, 12, 10, 30, 5));

describe('output template', () => {
  it('renders plain fields and leaves unknown placeholders empty', () => {
    expect(renderTemplate('%(title)s [%(id)s].%(ext)s', {
      title: 'Hello', id: 'abc', ext: 'mp4',
    })).toBe('Hello [abc].mp4');
    expect(renderTemplate('x%(missing)sy', {})).toBe('xy');
  });

  it('falls back to the literal default when every field is empty', () => {
    expect(renderTemplate('%(release_date>%Y,upload_date>%Y|Unknown)s', {})).toBe('Unknown');
    expect(renderTemplate('%(release_date>%Y,upload_date>%Y|Unknown)s', { release_date: date })).toBe('2026');
    expect(renderTemplate('%(release_date>%Y,upload_date>%Y|Unknown)s', { upload_date: date })).toBe('2026');
  });

  it('formats dates with the requested pattern', () => {
    expect(formatDate(date, '%Y-%m-%dT%H-%M-%S')).toBe('2026-07-12T10-30-05');
    expect(renderTemplate('%(upload_date>%Y%m%d)s - %(title)s', {
      upload_date: date, title: 'T',
    })).toBe('20260712 - T');
  });

  it('limits characters with .N and bytes with .NB without splitting multibyte text', () => {
    expect(renderTemplate('%(title).3s', { title: 'abcdef' })).toBe('abc');
    expect(renderTemplate('%(title).3B', { title: 'abcdef' })).toBe('abc');
    expect(renderTemplate('%(title).5B', { title: '你好世界' })).toBe('你');
    expect(renderTemplate('%(title).6B', { title: '你好世界' })).toBe('你好');
  });

  it('keeps unrecognised conversions verbatim', () => {
    expect(renderTemplate('%(title)q REST', { title: 'T' })).toBe('%(title)q REST');
  });

  it('renders the yt-dlp example template', () => {
    const output = renderTemplate(
      '%(channel)s [%(channel_id|Unknown_id)s]/Season %(release_date>%Y,upload_date>%Y|Unknown)s/'
      + 'S%(release_date>%Y,upload_date>%Y)sE%(release_date>%m%d,upload_date>%m%d)s - %(title).100B [%(id)s].%(ext)s',
      {
        channel: '频道', channel_id: 'CH1', title: '标题', id: 'vid', ext: 'mp4', upload_date: date,
      },
    );
    expect(output).toBe('频道 [CH1]/Season 2026/S2026E0712 - 标题 [vid].mp4');
  });
});