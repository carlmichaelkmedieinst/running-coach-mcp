/**
 * Pure, generic deterministic downsampling.
 *
 * Kept free of any Intervals.icu/MCP concerns (like `pace.ts`) so it can be
 * unit tested in isolation and reused for any ordered time-series, not just
 * running streams.
 */

/**
 * Reduces `items` to at most `maxPoints` entries using deterministic
 * "nearest index" bucket sampling: it walks `maxPoints` evenly spaced
 * positions across the original index range and picks the closest real
 * sample for each. This always keeps the first and last item (when
 * `maxPoints >= 2`) and preserves the overall shape of the series without
 * any randomness.
 *
 * If `items.length <= maxPoints`, returns a shallow copy of `items`
 * unchanged (no unnecessary sampling).
 */
export function downsampleDeterministic<T>(items: readonly T[], maxPoints: number): T[] {
  const n = items.length;

  if (maxPoints <= 0 || n === 0) {
    return [];
  }

  if (n <= maxPoints) {
    return items.slice();
  }

  if (maxPoints === 1) {
    return [items[0]];
  }

  const result: T[] = [];
  const step = (n - 1) / (maxPoints - 1);

  for (let i = 0; i < maxPoints; i++) {
    const index = Math.min(Math.round(i * step), n - 1);
    result.push(items[index]);
  }

  return result;
}
