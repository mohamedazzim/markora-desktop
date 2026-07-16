import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/shared/contracts';
describe('settings defaults', () => { it('uses safe and offline-friendly defaults', () => { expect(defaultSettings.safeExternalLinks).toBe(true); expect(defaultSettings.autosaveSeconds).toBeGreaterThanOrEqual(5); }); });
