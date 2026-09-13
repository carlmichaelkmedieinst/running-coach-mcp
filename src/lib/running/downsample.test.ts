import { describe, expect, it } from "vitest";

import { downsampleDeterministic } from "./downsample";

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

describe("downsampleDeterministic", () => {
  it("returns all items unchanged when count <= maxPoints", () => {
    const items = range(50);
    expect(downsampleDeterministic(items, 100)).toEqual(items);
  });

  it("returns all items unchanged when count === maxPoints (no unnecessary sampling)", () => {
    const items = range(600);
    const result = downsampleDeterministic(items, 600);
    expect(result).toEqual(items);
    expect(result.length).toBe(600);
  });

  it("caps the result at maxPoints when count > maxPoints", () => {
    const items = range(3319);
    const result = downsampleDeterministic(items, 600);
    expect(result.length).toBe(600);
  });

  it("always preserves the first and last item", () => {
    const items = range(3319);
    const result = downsampleDeterministic(items, 600);
    expect(result[0]).toBe(items[0]);
    expect(result[result.length - 1]).toBe(items[items.length - 1]);
  });

  it("is deterministic (same input/maxPoints always yields the same output)", () => {
    const items = range(2731);
    const first = downsampleDeterministic(items, 337);
    const second = downsampleDeterministic(items, 337);
    expect(first).toEqual(second);
  });

  it("preserves overall shape (result stays monotonically increasing for sorted input)", () => {
    const items = range(1000);
    const result = downsampleDeterministic(items, 137);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]).toBeGreaterThan(result[i - 1]);
    }
  });

  it("returns an empty array for an empty input", () => {
    expect(downsampleDeterministic([], 600)).toEqual([]);
  });

  it("returns a single item when maxPoints is 1", () => {
    const items = range(100);
    expect(downsampleDeterministic(items, 1)).toEqual([items[0]]);
  });

  it("does not mutate the input array", () => {
    const items = range(1000);
    const copy = [...items];
    downsampleDeterministic(items, 100);
    expect(items).toEqual(copy);
  });
});
