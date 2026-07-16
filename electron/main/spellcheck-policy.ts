import { z } from 'zod';
import type { SpellcheckSettings } from '../../src/shared/contracts';

export const spellcheckWordSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[\p{L}\p{M}\p{N}'’-]+$/u);

export const spellcheckSettingsSchema = z.object({
  enabled: z.boolean(),
  languages: z.array(z.string().min(2).max(35)).max(10),
  userDictionary: z.array(spellcheckWordSchema).max(10_000),
});

export const documentSpellcheckSchema = z.object({
  enabled: z.boolean(),
  language: z.string().min(2).max(35).optional(),
});

export function validateSpellcheckSettings(value: unknown): SpellcheckSettings {
  return spellcheckSettingsSchema.parse(value);
}

export function normalizeSpellcheckLanguages(
  requested: readonly string[],
  available: readonly string[],
  fallback: readonly string[],
  locale: string,
): string[] {
  const result = Array.from(new Set(requested)).filter((language) => available.includes(language));
  if (result.length) return result;
  const retained = fallback.filter((language) => available.includes(language));
  if (retained.length) return Array.from(new Set(retained));
  return available.includes(locale)
    ? [locale]
    : available.includes('en-US')
      ? ['en-US']
      : available.slice(0, 1);
}
