import { describe, expect, it, vi } from 'vitest';
import { createDefaultAppearanceSettings } from '../../src/renderer/appearance/appearance-settings';
import {
  applyDocumentFullscreen,
  withFullscreenSetting,
  type FullscreenDocumentLike,
} from '../../src/renderer/appearance/fullscreen';

function surface(initiallyFullscreen = false) {
  let fullscreen = initiallyFullscreen;
  const requestFullscreen = vi.fn(async () => {
    fullscreen = true;
  });
  const exitFullscreen = vi.fn(async () => {
    fullscreen = false;
  });
  const value: FullscreenDocumentLike = {
    get fullscreenElement() {
      return fullscreen ? document.documentElement : null;
    },
    documentElement: { requestFullscreen },
    exitFullscreen,
  };
  return { value, requestFullscreen, exitFullscreen };
}

describe('fullscreen state synchronization', () => {
  it('requests and exits DOM fullscreen only when a transition is needed', async () => {
    const target = surface();
    await expect(applyDocumentFullscreen(target.value, true)).resolves.toBe(true);
    await expect(applyDocumentFullscreen(target.value, true)).resolves.toBe(true);
    expect(target.requestFullscreen).toHaveBeenCalledTimes(1);

    await expect(applyDocumentFullscreen(target.value, false)).resolves.toBe(false);
    await expect(applyDocumentFullscreen(target.value, false)).resolves.toBe(false);
    expect(target.exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('propagates a rejected restore so callers can revert the persisted flag', async () => {
    const denied: FullscreenDocumentLike = {
      fullscreenElement: null,
      documentElement: { requestFullscreen: vi.fn().mockRejectedValue(new Error('gesture required')) },
      exitFullscreen: vi.fn(),
    };
    await expect(applyDocumentFullscreen(denied, true)).rejects.toThrow('gesture required');
  });

  it('updates only the persisted fullscreen token without mutating the input', () => {
    const initial = createDefaultAppearanceSettings();
    const enabled = withFullscreenSetting(initial, true);
    expect(enabled).not.toBe(initial);
    expect(enabled.writing.fullscreen).toBe(true);
    expect(initial.writing.fullscreen).toBe(false);
    expect(withFullscreenSetting(enabled, true)).toBe(enabled);
  });
});
