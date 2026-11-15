import { mean, median, mode, quantile, standardDeviation, variance } from "./statistics.js";

export interface FrequencyRow<T extends string | number> {
  readonly value: T;
  readonly absoluteFrequency: number;
  readonly relativeFrequency: number;
  readonly cumulativeFrequency: number;
  readonly cumulativeRelativeFrequency: number;
}
export interface DescriptiveStatistics {
  readonly count: number;
  readonly minimum: number;
  readonly firstQuartile: number;
  readonly median: number;
  readonly thirdQuartile: number;
  readonly maximum: number;
  readonly range: number;
  readonly mean: number;
  readonly variance: number;
  readonly standardDeviation: number;
  readonly modes: readonly number[];
  readonly interquartileRange: number;
  readonly quartileMethod: "median-of-halves" | "linear-interpolation";
}

/** Frequency table for discrete numeric or string-valued data, in ascending/natural order. */
export function frequencyTable<T extends string | number>(values: readonly T[]): FrequencyRow<T>[] {
  if (values.length === 0) throw new RangeError("Dataset must not be empty.");
  const counts = new Map<T, number>();
  for (const value of values) {
    if (typeof value === "number" && !Number.isFinite(value)) throw new RangeError("Numeric data must be finite.");
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const compare = (a: T, b: T): number => typeof a === "number" && typeof b === "number"
    ? a - b : String(a).localeCompare(String(b), "pt-PT");
  const sorted = [...counts.entries()].sort(([a], [b]) => compare(a, b));
  let cumulative = 0;
  return sorted.map(([value, absoluteFrequency]) => {
    cumulative += absoluteFrequency;
    return {
      value,
      absoluteFrequency,
      relativeFrequency: absoluteFrequency / values.length,
      cumulativeFrequency: cumulative,
      cumulativeRelativeFrequency: cumulative / values.length,
    };
  });
}

/**
 * Descriptive summary for univariate quantitative data.
 * Quartiles are explicitly configurable because school exercises may specify different conventions.
 * `median-of-halves` excludes the overall median from both halves when n is odd.
 */
export function describeQuantitativeData(
  values: readonly number[],
  quartileMethod: "median-of-halves" | "linear-interpolation" = "median-of-halves",
): DescriptiveStatistics {
  if (values.length === 0 || values.some(value => !Number.isFinite(value))) {
    throw new RangeError("Dataset must contain at least one finite numeric value.");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const lowerHalf = n % 2 === 0 ? sorted.slice(0, n / 2) : sorted.slice(0, Math.floor(n / 2));
  const upperHalf = n % 2 === 0 ? sorted.slice(n / 2) : sorted.slice(Math.floor(n / 2) + 1);
  const firstQuartile = quartileMethod === "linear-interpolation"
    ? quantile(sorted, 0.25)
    : lowerHalf.length === 0 ? sorted[0]! : median(lowerHalf);
  const thirdQuartile = quartileMethod === "linear-interpolation"
    ? quantile(sorted, 0.75)
    : upperHalf.length === 0 ? sorted[n - 1]! : median(upperHalf);
  const minimum = sorted[0]!;
  const maximum = sorted[n - 1]!;
  return {
    count: n,
    minimum,
    firstQuartile,
    median: median(sorted),
    thirdQuartile,
    maximum,
    range: maximum - minimum,
    mean: mean(sorted),
    variance: variance(sorted),
    standardDeviation: standardDeviation(sorted),
    modes: mode(sorted),
    interquartileRange: thirdQuartile - firstQuartile,
    quartileMethod,
  };
}
