import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings.js';

describe('settings normalization', () => {
  it('returns defaults for missing or invalid input', () => {
    expect(normalizeSettings()).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ saveMode: 'nope', embyMediaType: 'nope' })).toMatchObject({
      saveMode: 'folder', embyMediaType: 'tv',
    });
  });

  it('keeps valid values and rejects an empty template', () => {
    expect(normalizeSettings({
      saveMode: 'ask',
      defaultFolder: 'Shows',
      outputTemplate: '%(title)s.%(ext)s',
      embyEnabled: false,
      embyMediaType: 'movie',
      embyNfo: false,
      embyImages: false,
    })).toEqual({
      saveMode: 'ask',
      defaultFolder: 'Shows',
      outputTemplate: '%(title)s.%(ext)s',
      embyEnabled: false,
      embyMediaType: 'movie',
      embyNfo: false,
      embyImages: false,
      useCustomDirectory: false,
    });
    expect(normalizeSettings({ outputTemplate: '' }).outputTemplate).toBe(DEFAULT_SETTINGS.outputTemplate);
  });
});