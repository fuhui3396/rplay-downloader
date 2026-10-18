import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/settings.js';
import { buildDownloadPath } from '../src/naming.js';
import { buildItemNfo, buildSidecarPlan, buildTvShowNfo } from '../src/sidecars.js';

const task = {
  title: '第7集',
  videoId: 'vid1',
  channel: '频道',
  channelId: 'CH1',
  resolution: '1920x1080',
  duration: 3_723,
  description: '简介 & <更多>',
  createdAt: Date.UTC(2026, 6, 12),
  posterUrl: 'https://cdn.rplay.live/poster.jpg',
  fanartUrl: 'https://cdn.rplay.live/fanart.jpg',
  thumbUrl: 'https://cdn.rplay.live/thumb.jpg',
};

const settings = {
  ...DEFAULT_SETTINGS,
  defaultFolder: 'RPlay',
  embyMediaType: 'tv',
  outputTemplate: '%(channel)s [%(channel_id|Unknown_id)s]/Season %(upload_date>%Y)s/S%(upload_date>%m%d)s - %(title)s.%(ext)s',
};

describe('Emby sidecars', () => {
  it('builds an episode NFO plus tvshow and season files', () => {
    const target = buildDownloadPath(task, 'mp4', settings);
    const plan = buildSidecarPlan(task, settings, target);
    const filenames = plan.files.map((file) => file.filename);
    expect(filenames).toEqual([
      'RPlay/频道 [CH1]/Season 2026/S0712 - 第7集.nfo',
      'RPlay/频道 [CH1]/tvshow.nfo',
      'RPlay/频道 [CH1]/Season 2026/season.nfo',
    ]);
    const episode = plan.files[0].content;
    expect(episode).toContain('<episodedetails>');
    expect(episode).toContain('<season>2026</season>');
    expect(episode).toContain('<episode>712</episode>');
    expect(episode).toContain('<aired>2026-07-12</aired>');
    expect(episode).toContain('简介 &amp; &lt;更多&gt;');
    expect(episode).toContain('<uniqueid type="rplay" default="true">vid1</uniqueid>');
    expect(plan.files[1].content).toContain('<tvshow>');
    expect(plan.files[2].content).toContain('<seasonnumber>2026</seasonnumber>');
  });

  it('plans poster, fanart and thumb images with derived names', () => {
    const target = buildDownloadPath(task, 'mp4', settings);
    const plan = buildSidecarPlan(task, settings, target);
    expect(plan.images).toEqual([
      { filename: 'RPlay/频道 [CH1]/Season 2026/S0712 - 第7集-poster.jpg', url: task.posterUrl },
      { filename: 'RPlay/频道 [CH1]/Season 2026/S0712 - 第7集-fanart.jpg', url: task.fanartUrl },
      { filename: 'RPlay/频道 [CH1]/Season 2026/S0712 - 第7集-thumb.jpg', url: task.thumbUrl },
    ]);
  });

  it('builds a movie NFO with release metadata', () => {
    const movieSettings = { ...settings, embyMediaType: 'movie' };
    const target = buildDownloadPath(task, 'mp4', movieSettings);
    const plan = buildSidecarPlan(task, movieSettings, target);
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0].content).toContain('<movie>');
    expect(plan.files[0].content).toContain('<runtime>62</runtime>');
    expect(plan.files[0].content).toContain('<studio>频道</studio>');
  });

  it('skips NFO and images when disabled', () => {
    const disabled = { ...settings, embyNfo: false, embyImages: false };
    const target = buildDownloadPath(task, 'mp4', disabled);
    expect(buildSidecarPlan(task, disabled, target)).toEqual({ files: [], images: [] });
    expect(buildItemNfo(task, disabled)).toContain('<episodedetails>');
    expect(buildTvShowNfo(task)).toContain('<title>频道</title>');
  });
});