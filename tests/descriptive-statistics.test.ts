import { describe, expect, it } from "vitest";
import { describeQuantitativeData, frequencyTable } from "../src/index.js";

describe("descriptive statistics", () => {
  it("builds an absolute, relative, and cumulative frequency table", () => {
    expect(frequencyTable([2, 1, 2, 3, 1])).toEqual([
      { value: 1, absoluteFrequency: 2, relativeFrequency: 0.4, cumulativeFrequency: 2, cumulativeRelativeFrequency: 0.4 },
      { value: 2, absoluteFrequency: 2, relativeFrequency: 0.4, cumulativeFrequency: 4, cumulativeRelativeFrequency: 0.8 },
      { value: 3, absoluteFrequency: 1, relativeFrequency: 0.2, cumulativeFrequency: 5, cumulativeRelativeFrequency: 1 },
    ]);
  });

  it("makes the quartile convention explicit in the five-number summary", () => {
    const summary = describeQuantitativeData([1, 2, 3, 4, 5, 6, 7]);
    expect(summary.minimum).toBe(1);
    expect(summary.firstQuartile).toBe(2);
    expect(summary.median).toBe(4);
    expect(summary.thirdQuartile).toBe(6);
    expect(summary.maximum).toBe(7);
    expect(summary.range).toBe(6);
    expect(summary.interquartileRange).toBe(4);
    expect(describeQuantitativeData([1, 2, 3, 4], "linear-interpolation").firstQuartile).toBe(1.75);
  });
});
