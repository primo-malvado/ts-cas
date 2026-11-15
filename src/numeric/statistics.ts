export interface LinearRegressionResult {
  readonly slope: number;
  readonly intercept: number;
  readonly correlation: number;
  readonly rSquared: number;
}

export function mean(values: readonly number[]): number {
  assertNonEmptyFinite(values);
  return compensatedSum(values) / values.length;
}

export function median(values: readonly number[]): number {
  assertNonEmptyFinite(values);
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function variance(values: readonly number[], sample = false): number {
  assertNonEmptyFinite(values);
  if (sample && values.length < 2) throw new RangeError("Sample variance requires at least two observations.");
  const average = mean(values);
  const sumSquares = compensatedSum(values.map(value => (value - average) ** 2));
  return sumSquares / (values.length - (sample ? 1 : 0));
}

export function standardDeviation(values: readonly number[], sample = false): number {
  return Math.sqrt(variance(values, sample));
}

/** Quantile using linear interpolation between adjacent order statistics (R-7 convention). */
export function quantile(values: readonly number[], probability: number): number {
  assertNonEmptyFinite(values);
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new RangeError("Quantile probability must be between 0 and 1.");
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index), fraction = index - lower;
  const a = sorted[lower]!;
  const b = sorted[Math.min(lower + 1, sorted.length - 1)]!;
  return a + (b - a) * fraction;
}

export function mode(values: readonly number[]): number[] {
  assertNonEmptyFinite(values);
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const highest = Math.max(...counts.values());
  if (highest === 1) return [];
  return [...counts.entries()].filter(([, count]) => count === highest).map(([value]) => value).sort((a, b) => a - b);
}

export function covariance(x: readonly number[], y: readonly number[], sample = false): number {
  assertSameLength(x, y);
  assertNonEmptyFinite(x);
  assertNonEmptyFinite(y);
  if (sample && x.length < 2) throw new RangeError("Sample covariance requires at least two paired observations.");
  const mx = mean(x), my = mean(y);
  const sum = compensatedSum(x.map((value, index) => (value - mx) * (y[index]! - my)));
  return sum / (x.length - (sample ? 1 : 0));
}

export function correlation(x: readonly number[], y: readonly number[]): number {
  assertSameLength(x, y);
  const sx = standardDeviation(x), sy = standardDeviation(y);
  if (sx === 0 || sy === 0) throw new RangeError("Correlation is undefined when either dataset has zero variance.");
  return covariance(x, y) / (sx * sy);
}

export function linearRegression(x: readonly number[], y: readonly number[]): LinearRegressionResult {
  assertSameLength(x, y);
  assertNonEmptyFinite(x);
  assertNonEmptyFinite(y);
  const mx = mean(x), my = mean(y);
  const centeredX = x.map(value => value - mx);
  const denominator = compensatedSum(centeredX.map(value => value * value));
  if (denominator === 0) throw new RangeError("Linear regression requires at least two distinct x values.");
  const slope = compensatedSum(centeredX.map((value, index) => value * (y[index]! - my))) / denominator;
  const intercept = my - slope * mx;
  const corr = correlation(x, y);
  return { slope, intercept, correlation: corr, rSquared: corr * corr };
}

export interface HistogramBin { readonly lower: number; readonly upper: number; readonly count: number; }

export function histogram(values: readonly number[], binCount: number): HistogramBin[] {
  assertNonEmptyFinite(values);
  if (!Number.isSafeInteger(binCount) || binCount < 1) throw new RangeError("Bin count must be a positive integer.");
  const min = Math.min(...values), max = Math.max(...values);
  const width = max === min ? 1 : (max - min) / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({ lower: min + i * width, upper: i === binCount - 1 ? max : min + (i + 1) * width, count: 0 }));
  for (const value of values) {
    const index = max === min ? 0 : Math.min(binCount - 1, Math.floor((value - min) / width));
    bins[index]!.count++;
  }
  return bins;
}

function assertNonEmptyFinite(values: readonly number[]): void {
  if (values.length === 0) throw new RangeError("Dataset must not be empty.");
  if (values.some(value => !Number.isFinite(value))) throw new RangeError("Dataset values must be finite numbers.");
}

function assertSameLength(a: readonly number[], b: readonly number[]): void {
  if (a.length !== b.length) throw new RangeError("Datasets must have the same length.");
}

function compensatedSum(values: readonly number[]): number {
  let sum = 0, correction = 0;
  for (const value of values) {
    const adjusted = value - correction;
    const next = sum + adjusted;
    correction = (next - sum) - adjusted;
    sum = next;
  }
  return sum;
}
