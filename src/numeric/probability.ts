const SQRT_TWO_PI = Math.sqrt(2 * Math.PI);

export function factorial(n: number): bigint {
  assertNonNegativeInteger(n, "n");
  let result = 1n;
  for (let i = 2; i <= n; i++) result *= BigInt(i);
  return result;
}

export function permutations(n: number, r: number = n): bigint {
  assertNonNegativeInteger(n, "n");
  assertNonNegativeInteger(r, "r");
  if (r > n) return 0n;
  let result = 1n;
  for (let i = 0; i < r; i++) result *= BigInt(n - i);
  return result;
}

export function combinations(n: number, r: number): bigint {
  assertNonNegativeInteger(n, "n");
  assertNonNegativeInteger(r, "r");
  if (r > n) return 0n;
  const k = Math.min(r, n - r);
  let result = 1n;
  for (let i = 1; i <= k; i++) result = (result * BigInt(n - k + i)) / BigInt(i);
  return result;
}

export function binomialPmf(n: number, p: number, k: number): number {
  assertNonNegativeInteger(n, "n");
  assertProbability(p);
  assertNonNegativeInteger(k, "k");
  if (k > n) return 0;
  const coefficient = Number(combinations(n, k));
  return coefficient * p ** k * (1 - p) ** (n - k);
}

export function binomialCdf(n: number, p: number, k: number): number {
  assertNonNegativeInteger(n, "n");
  assertProbability(p);
  if (!Number.isInteger(k)) throw new RangeError("k must be an integer.");
  if (k < 0) return 0;
  if (k >= n) return 1;
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += binomialPmf(n, p, i);
  return Math.min(1, sum);
}

export function normalPdf(x: number, mean = 0, standardDeviation = 1): number {
  assertNormalParameters(mean, standardDeviation);
  const z = (x - mean) / standardDeviation;
  return Math.exp(-0.5 * z * z) / (standardDeviation * SQRT_TWO_PI);
}

/** Normal cumulative distribution using a documented-quality numerical erf approximation (absolute error typically < 1.5e-7). */
export function normalCdf(x: number, mean = 0, standardDeviation = 1): number {
  assertNormalParameters(mean, standardDeviation);
  const z = (x - mean) / (standardDeviation * Math.SQRT2);
  return 0.5 * (1 + erfApprox(z));
}

function erfApprox(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - polynomial * Math.exp(-a * a));
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer.`);
}
function assertProbability(p: number): void {
  if (!Number.isFinite(p) || p < 0 || p > 1) throw new RangeError("Probability must lie in [0, 1].");
}
function assertNormalParameters(mean: number, standardDeviation: number): void {
  if (!Number.isFinite(mean)) throw new RangeError("Normal mean must be finite.");
  if (!Number.isFinite(standardDeviation) || standardDeviation <= 0) throw new RangeError("Standard deviation must be positive and finite.");
}
