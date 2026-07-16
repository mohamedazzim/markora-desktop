import { z } from 'zod';
import { defaultSettings, type AppSettings } from '../../src/shared/contracts';

export const appSettingsSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']),
    fontSize: z.number().finite().min(10).max(48),
    lineHeight: z.number().finite().min(1).max(3),
    contentWidth: z.number().finite().min(320).max(4_000),
    wordWrap: z.boolean(),
    autosaveSeconds: z.number().int().min(5).max(3_600),
    safeExternalLinks: z.boolean(),
  })
  .strict();

const appSettingsUpdateSchema = appSettingsSchema.partial().strict();

/** Accepts version-0 partial settings while rejecting unknown keys and unsafe values. */
export function parseAppSettings(value: unknown): AppSettings {
  const update = appSettingsUpdateSchema.parse(value);
  return appSettingsSchema.parse({ ...defaultSettings, ...update });
}
