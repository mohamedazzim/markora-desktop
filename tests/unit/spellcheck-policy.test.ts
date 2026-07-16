import { describe, expect, it } from 'vitest';
import {
  documentSpellcheckSchema,
  normalizeSpellcheckLanguages,
  spellcheckWordSchema,
  validateSpellcheckSettings,
} from '../../electron/main/spellcheck-policy';

describe('offline spell-check policy', () => {
  it('deduplicates requested languages and drops unavailable dictionaries', () => {
    expect(
      normalizeSpellcheckLanguages(
        ['fr-FR', 'not-installed', 'fr-FR'],
        ['en-US', 'fr-FR'],
        ['en-US'],
        'en-US',
      ),
    ).toEqual(['fr-FR']);
  });

  it('falls back through current languages, locale, en-US, and the first available dictionary', () => {
    expect(normalizeSpellcheckLanguages([], ['de-DE', 'en-US'], ['de-DE'], 'fr-FR')).toEqual(['de-DE']);
    expect(normalizeSpellcheckLanguages([], ['fr-FR', 'en-US'], [], 'fr-FR')).toEqual(['fr-FR']);
    expect(normalizeSpellcheckLanguages([], ['de-DE', 'en-US'], [], 'fr-FR')).toEqual(['en-US']);
    expect(normalizeSpellcheckLanguages([], ['de-DE'], [], 'fr-FR')).toEqual(['de-DE']);
    expect(normalizeSpellcheckLanguages([], [], [], 'fr-FR')).toEqual([]);
  });

  it('validates persistent settings and rejects malformed dictionaries', () => {
    expect(
      validateSpellcheckSettings({ enabled: true, languages: ['en-US'], userDictionary: ['Markora'] }),
    ).toEqual({ enabled: true, languages: ['en-US'], userDictionary: ['Markora'] });
    expect(() =>
      validateSpellcheckSettings({ enabled: true, languages: ['x'], userDictionary: [] }),
    ).toThrow();
    expect(() => spellcheckWordSchema.parse('<script>')).toThrow();
    expect(spellcheckWordSchema.parse('l’écriture')).toBe('l’écriture');
  });

  it('validates the per-document override contract', () => {
    expect(documentSpellcheckSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(documentSpellcheckSchema.parse({ enabled: true, language: 'en-GB' })).toEqual({
      enabled: true,
      language: 'en-GB',
    });
    expect(() => documentSpellcheckSchema.parse({ enabled: true, language: '/' })).toThrow();
  });
});
