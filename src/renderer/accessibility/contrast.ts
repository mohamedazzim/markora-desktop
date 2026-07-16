/** WCAG 2.x relative luminance and contrast helpers used by theme validation. */
export function parseHexColor(value: string): readonly [number, number, number] {
  const normalized = value.trim().replace(/^#/, '');
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((character) => `${character}${character}`)
          .join('')
      : normalized;
  if (!/^[\da-f]{6}$/i.test(expanded)) throw new Error(`Unsupported color value: ${value}`);
  return [0, 2, 4].map((offset) =>
    Number.parseInt(expanded.slice(offset, offset + 2), 16),
  ) as unknown as readonly [number, number, number];
}

function linearize(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: string): number {
  const [red, green, blue] = parseHexColor(color).map(linearize);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsWcagAA(
  foreground: string,
  background: string,
  size: 'normal' | 'large' = 'normal',
): boolean {
  return contrastRatio(foreground, background) >= (size === 'normal' ? 4.5 : 3);
}
