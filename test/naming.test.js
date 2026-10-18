import { describe, expect, it } from 'vitest';
import {
  buildDownloadPath,
  makeDownloadFilename,
  normalizeVideoTitle,
  sanitizeFilename,
  selectVideoTitle,
} from '../src/naming.js';

describe('download filename', () => {
  it('rejects the RPlay placeholder and selects the first real SPA title', () => {
    expect(normalizeVideoTitle('RPLAY')).toBe('');
    expect(normalizeVideoTitle('rplay.live')).toBe('');
    expect(selectVideoTitle([
      'RPLAY',
      '[当前视频标题] | RPLAY',
      '[上一条视频标题]',
    ])).toBe('[当前视频标题]');
  });

  it('uses the video title without the RPLAY tab suffix', () => {
    const title = normalizeVideoTitle('  视频 标题 | RPLAY  ');
    expect(title).toBe('视频 标题');
    expect(makeDownloadFilename({
      title,
      resolution: '1920x1080',
      createdAt: Date.UTC(2026, 0, 2, 3, 4, 5),
    }, 'mp4')).toMatch(/^视频 标题_1920x1080_2026-01-02T03-04-05/);
  });

  it('keeps unicode and replaces only characters illegal in Windows filenames', () => {
    expect(normalizeVideoTitle('标题💋:测试?')).toBe('标题💋:测试?');
    expect(sanitizeFilename('标题💋:测试?')).toBe('标题💋_测试_');
  });
});

describe('download path', () => {
  const task = {
    title: '第7集',
    videoId: 'vid1',
    channel: '频道',
    channelId: 'CH1',
    resolution: '1920x1080',
    createdAt: Date.UTC(2026, 6, 12),
  };

  it('joins the default folder with a templated path', () => {
    const { path, directory, name, basename } = buildDownloadPath(task, 'mp4', {
      defaultFolder: 'RPlay',
      outputTemplate: '%(channel)s [%(channel_id|Unknown_id)s]/Season %(upload_date>%Y)s/'
        + 'S%(upload_date>%Y)sE%(upload_date>%m%d)s - %(title).100B [%(id)s].%(ext)s',
    });
    expect(path).toBe('RPlay/频道 [CH1]/Season 2026/S2026E0712 - 第7集 [vid1].mp4');
    expect(directory).toBe('RPlay/频道 [CH1]/Season 2026');
    expect(name).toBe('S2026E0712 - 第7集 [vid1].mp4');
    expect(basename).toBe('S2026E0712 - 第7集 [vid1]');
  });

  it('sanitizes path separators and uses defaults without settings', () => {
    const { path } = buildDownloadPath({ ...task, title: 'a/b:c' }, 'mp4', { defaultFolder: '', outputTemplate: '%(title)s.%(ext)s' });
    expect(path).toBe('a_b_c.mp4');
    expect(makeDownloadFilename(task, 'mp4')).toMatch(/^第7集_1920x1080_2026-07-12T00-00-00\.mp4$/);
  });

  it('appends the extension when the template omits it', () => {
    expect(buildDownloadPath(task, 'mp4', { defaultFolder: 'RPlay', outputTemplate: '%(title)s' }).path)
      .toBe('RPlay/第7集.mp4');
  });
});
