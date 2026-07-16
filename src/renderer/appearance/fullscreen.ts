import type { AppearanceSettings } from './appearance-settings';

export interface FullscreenDocumentLike {
  readonly fullscreenElement: Element | null;
  readonly documentElement: Pick<Element, 'requestFullscreen'>;
  exitFullscreen(): Promise<void>;
}

export function withFullscreenSetting(settings: AppearanceSettings, enabled: boolean): AppearanceSettings {
  if (settings.writing.fullscreen === enabled) return settings;
  return {
    ...settings,
    writing: { ...settings.writing, fullscreen: enabled },
  };
}

/** Applies the DOM fullscreen request and reports the actual resulting state. */
export async function applyDocumentFullscreen(
  surface: FullscreenDocumentLike,
  enabled: boolean,
): Promise<boolean> {
  if (enabled && !surface.fullscreenElement) await surface.documentElement.requestFullscreen();
  else if (!enabled && surface.fullscreenElement) await surface.exitFullscreen();
  return Boolean(surface.fullscreenElement);
}
