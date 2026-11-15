/**
 * Outward-rounded interval arithmetic for a supported subset of real expressions.
 *
 * Every primitive operation rounds the lower endpoint toward -infinity and the
 * upper endpoint toward +infinity at the configured significant-digit precision.
 * For this supported subset, the exact value is enclosed by the returned interval.
 *
 * The exp/log/trigonometric extensions use explicit series remainder bounds; square- and cube-root bounds use outward-directed rounding.
 * Trigonometric argument reduction uses a certified interval for pi and integer
 * multiples of pi/2. Inputs whose magnitude or requested precision exceed the
 * available guard-digit budget are rejected rather than approximated with Number.
 */
import type { Expr, NumericExpr } from "../core/expr.js";
import { numericParts } from "../core/expr.js";
import {
  decimal,
  decimalAbs,
  decimalCbrt,
  decimalAdd,
  decimalCompare,
  decimalDivide,
  decimalMultiply,
  decimalNegate,
  decimalPowInteger,
  decimalPowerOfTen,
  decimalRound,
  decimalSqrt,
  decimalSubtract,
  decimalToString,
  type BigDecimal,
  type DecimalContext,
  type DecimalInput,
} from "./decimal.js";

export interface DecimalInterval {
  readonly lower: BigDecimal;
  readonly upper: BigDecimal;
}

export type DecimalIntervalInput =
  | DecimalInterval
  | DecimalInput
  | { readonly lower: DecimalInput; readonly upper: DecimalInput };

export type DecimalIntervalBindings = Readonly<Record<string, DecimalIntervalInput | undefined>>;

export interface DecimalIntervalOptions {
  /** Significant decimal digits used for outward rounding. Default: 50. */
  readonly precision?: number;
  /** Maximum integer exponent magnitude accepted for interval powers. Default: 10000. */
  readonly maxExponent?: number;
}

export interface DecimalIntervalEvaluationResult {
  readonly interval: DecimalInterval;
  readonly lowerText: string;
  readonly upperText: string;
  readonly precision: number;
  readonly certified: true;
  readonly method: "outward-rounded-interval-arithmetic";
}

const ZERO = decimal(0n);
const ONE = decimal(1n);

function precisionOf(options: DecimalIntervalOptions = {}): number {
  const precision = options.precision ?? 50;
  if (!Number.isSafeInteger(precision) || precision < 2 || precision > 1000) {
    throw new RangeError("Interval precision must be an integer between 2 and 1000.");
  }
  return precision;
}

function down(precision: number): DecimalContext {
  return { precision, rounding: "floor" };
}

function up(precision: number): DecimalContext {
  return { precision, rounding: "ceil" };
}

function isIntervalLike(value: unknown): value is { lower: DecimalInput; upper: DecimalInput } {
  return typeof value === "object" && value !== null && "lower" in value && "upper" in value;
}

/** Creates an interval, checking that the lower endpoint does not exceed the upper endpoint. */
export function decimalInterval(lower: DecimalInput, upper: DecimalInput = lower): DecimalInterval {
  const lo = decimal(lower);
  const hi = decimal(upper);
  if (decimalCompare(lo, hi) > 0) throw new RangeError("Interval lower endpoint must not exceed its upper endpoint.");
  return Object.freeze({ lower: lo, upper: hi });
}

export function asDecimalInterval(value: DecimalIntervalInput): DecimalInterval {
  if (isIntervalLike(value)) return decimalInterval(value.lower, value.upper);
  return decimalInterval(value as DecimalInput);
}

export function decimalIntervalContains(interval: DecimalInterval, value: DecimalInput): boolean {
  const candidate = decimal(value);
  return decimalCompare(interval.lower, candidate) <= 0 && decimalCompare(candidate, interval.upper) <= 0;
}

export function decimalIntervalContainsZero(interval: DecimalInterval): boolean {
  return decimalCompare(interval.lower, ZERO) <= 0 && decimalCompare(interval.upper, ZERO) >= 0;
}

export function decimalIntervalWidth(interval: DecimalInterval, precision = 50): BigDecimal {
  return decimalSubtract(interval.upper, interval.lower, up(precision));
}

export function decimalIntervalAdd(
  a: DecimalInterval,
  b: DecimalInterval,
  precision = 50,
): DecimalInterval {
  return decimalInterval(
    decimalAdd(a.lower, b.lower, down(precision)),
    decimalAdd(a.upper, b.upper, up(precision)),
  );
}

export function decimalIntervalNegate(a: DecimalInterval): DecimalInterval {
  return decimalInterval(decimalNegate(a.upper), decimalNegate(a.lower));
}

export function decimalIntervalSubtract(
  a: DecimalInterval,
  b: DecimalInterval,
  precision = 50,
): DecimalInterval {
  return decimalInterval(
    decimalSubtract(a.lower, b.upper, down(precision)),
    decimalSubtract(a.upper, b.lower, up(precision)),
  );
}

export function decimalIntervalMultiply(
  a: DecimalInterval,
  b: DecimalInterval,
  precision = 50,
): DecimalInterval {
  const lowerContext = down(precision);
  const upperContext = up(precision);
  const leftEndpoints = [a.lower, a.upper] as const;
  const rightEndpoints = [b.lower, b.upper] as const;
  const lowerCandidates: BigDecimal[] = [];
  const upperCandidates: BigDecimal[] = [];
  for (const x of leftEndpoints) {
    for (const y of rightEndpoints) {
      lowerCandidates.push(decimalMultiply(x, y, lowerContext));
      upperCandidates.push(decimalMultiply(x, y, upperContext));
    }
  }
  lowerCandidates.sort(decimalCompare);
  upperCandidates.sort(decimalCompare);
  return decimalInterval(lowerCandidates[0]!, upperCandidates[upperCandidates.length - 1]!);
}

export function decimalIntervalDivide(
  a: DecimalInterval,
  b: DecimalInterval,
  precision = 50,
): DecimalInterval {
  if (decimalIntervalContainsZero(b)) {
    throw new RangeError("Interval division is undefined when the denominator interval contains zero.");
  }
  const lowerContext = down(precision);
  const upperContext = up(precision);
  const leftEndpoints = [a.lower, a.upper] as const;
  const rightEndpoints = [b.lower, b.upper] as const;
  const lowerCandidates: BigDecimal[] = [];
  const upperCandidates: BigDecimal[] = [];
  for (const x of leftEndpoints) {
    for (const y of rightEndpoints) {
      lowerCandidates.push(decimalDivide(x, y, lowerContext));
      upperCandidates.push(decimalDivide(x, y, upperContext));
    }
  }
  lowerCandidates.sort(decimalCompare);
  upperCandidates.sort(decimalCompare);
  return decimalInterval(lowerCandidates[0]!, upperCandidates[upperCandidates.length - 1]!);
}

function evenPower(
  a: DecimalInterval,
  exponent: bigint,
  precision: number,
  maxExponent: number,
): DecimalInterval {
  if (exponent > BigInt(maxExponent)) throw new RangeError(`Interval exponent exceeds configured limit ${maxExponent}.`);
  const positiveExponent = exponent;
  const upperMagnitude = decimalCompare(decimalAbs(a.lower), decimalAbs(a.upper)) >= 0
    ? decimalAbs(a.lower)
    : decimalAbs(a.upper);
  const upper = decimalPowInteger(upperMagnitude, positiveExponent, up(precision));
  const lower = decimalIntervalContainsZero(a)
    ? ZERO
    : decimalPowInteger(
      decimalCompare(decimalAbs(a.lower), decimalAbs(a.upper)) <= 0 ? decimalAbs(a.lower) : decimalAbs(a.upper),
      positiveExponent,
      down(precision),
    );
  return decimalInterval(lower, upper);
}

export function decimalIntervalPowInteger(
  a: DecimalInterval,
  exponent: bigint,
  precision = 50,
  maxExponent = 10_000,
): DecimalInterval {
  if (exponent > BigInt(maxExponent) || exponent < -BigInt(maxExponent)) {
    throw new RangeError(`Interval exponent magnitude exceeds configured limit ${maxExponent}.`);
  }
  if (exponent === 0n) return decimalInterval(ONE);
  if (exponent < 0n) {
    if (decimalIntervalContainsZero(a)) {
      throw new RangeError("A negative interval power is undefined when the base interval contains zero.");
    }
    const positivePower = decimalIntervalPowInteger(a, -exponent, precision, maxExponent);
    return decimalIntervalDivide(decimalInterval(ONE), positivePower, precision);
  }
  if (exponent % 2n === 0n) return evenPower(a, exponent, precision, maxExponent);

  return decimalInterval(
    decimalPowInteger(a.lower, exponent, down(precision)),
    decimalPowInteger(a.upper, exponent, up(precision)),
  );
}

export function decimalIntervalSqrt(a: DecimalInterval, precision = 50): DecimalInterval {
  if (decimalCompare(a.lower, ZERO) < 0) {
    throw new RangeError("Interval square root requires a non-negative interval.");
  }
  return decimalInterval(
    decimalSqrt(a.lower, down(precision)),
    decimalSqrt(a.upper, up(precision)),
  );
}

/** Certified monotone cube-root extension, including negative real intervals. */
export function decimalIntervalCbrt(a: DecimalInterval, precision = 50): DecimalInterval {
  return decimalInterval(
    decimalCbrt(a.lower, down(precision)),
    decimalCbrt(a.upper, up(precision)),
  );
}

export function decimalIntervalAbs(a: DecimalInterval): DecimalInterval {
  if (decimalCompare(a.lower, ZERO) >= 0) return a;
  if (decimalCompare(a.upper, ZERO) <= 0) return decimalInterval(decimalAbs(a.upper), decimalAbs(a.lower));
  const upper = decimalCompare(decimalAbs(a.lower), decimalAbs(a.upper)) >= 0
    ? decimalAbs(a.lower)
    : decimalAbs(a.upper);
  return decimalInterval(ZERO, upper);
}


const ln10BoundsCache = new Map<number, DecimalInterval>();

function workingPrecision(precision: number): number {
  return Math.min(1000, precision + 12);
}

function positiveExpSmallPoint(value: BigDecimal, precision: number): DecimalInterval {
  if (decimalCompare(value, ZERO) < 0 || decimalCompare(value, decimal("0.125")) > 0) {
    throw new RangeError("Internal exp series requires an argument in [0, 0.125].");
  }
  if (decimalCompare(value, ZERO) === 0) return decimalInterval(ONE);

  const p = workingPrecision(precision);
  const lower = down(p);
  const upper = up(p);
  const targetFactor = decimalPowerOfTen(-Math.max(2, precision - 2));
  let termLower = ONE;
  let termUpper = ONE;
  let sumLower = ONE;
  let sumUpper = ONE;
  const maximumTerms = Math.max(1000, precision * 12 + 100);

  for (let n = 1; n <= maximumTerms; n++) {
    termLower = decimalDivide(decimalMultiply(termLower, value, lower), decimal(BigInt(n)), lower);
    termUpper = decimalDivide(decimalMultiply(termUpper, value, upper), decimal(BigInt(n)), upper);
    sumLower = decimalAdd(sumLower, termLower, lower);
    sumUpper = decimalAdd(sumUpper, termUpper, upper);

    // For k >= n+2, t_(k+1)/t_k = x/(k+1) <= x/(n+2).
    // Hence the remaining positive tail is bounded by t_(n+1)/(1 - x/(n+2)).
    const nextTerm = decimalDivide(
      decimalMultiply(termUpper, value, upper),
      decimal(BigInt(n + 1)),
      upper,
    );
    const ratio = decimalDivide(value, decimal(BigInt(n + 2)), upper);
    if (decimalCompare(ratio, ONE) >= 0) continue;
    const denominatorLower = decimalSubtract(ONE, ratio, lower);
    const tailUpper = decimalDivide(nextTerm, denominatorLower, upper);
    const target = decimalMultiply(sumUpper, targetFactor, upper);
    if (decimalCompare(tailUpper, target) <= 0) {
      return decimalInterval(sumLower, decimalAdd(sumUpper, tailUpper, upper));
    }
  }
  throw new RangeError("Certified exponential series did not reach the requested precision.");
}

function expPositivePoint(value: BigDecimal, precision: number): DecimalInterval {
  if (decimalCompare(value, ZERO) < 0) throw new RangeError("Internal positive exponential expects x >= 0.");
  if (decimalCompare(value, ZERO) === 0) return decimalInterval(ONE);
  if (decimalCompare(value, decimal(10_000n)) > 0) {
    throw new RangeError("Certified exponential currently requires arguments <= 10000.");
  }

  const p = workingPrecision(precision);
  const lowerContext = down(p);
  const upperContext = up(p);
  let lowerReduced = value;
  let upperReduced = value;
  let squarings = 0;
  const threshold = decimal("0.125");
  const two = decimal(2n);

  // x = y * 2^s. Maintain an outward-rounded enclosure of y while reducing the
  // argument; exp is monotone, so point bounds at each endpoint enclose exp(y).
  while (decimalCompare(upperReduced, threshold) > 0) {
    lowerReduced = decimalDivide(lowerReduced, two, lowerContext);
    upperReduced = decimalDivide(upperReduced, two, upperContext);
    squarings++;
    if (squarings > 20) throw new RangeError("Certified exponential range reduction exceeded its limit.");
  }

  const low = positiveExpSmallPoint(lowerReduced, p);
  const high = positiveExpSmallPoint(upperReduced, p);
  let result = decimalInterval(low.lower, high.upper);
  for (let index = 0; index < squarings; index++) {
    result = decimalIntervalMultiply(result, result, p);
  }
  return result;
}

function expPointBounds(value: BigDecimal, precision: number): DecimalInterval {
  const comparison = decimalCompare(value, ZERO);
  if (comparison === 0) return decimalInterval(ONE);
  if (comparison > 0) return expPositivePoint(value, precision);
  const positive = expPositivePoint(decimalNegate(value), precision);
  return decimalIntervalDivide(decimalInterval(ONE), positive, workingPrecision(precision));
}

/** Certified enclosure of exp(x) over a finite real interval. */
export function decimalIntervalExp(value: DecimalInterval, precision = 50): DecimalInterval {
  precisionOf({ precision });
  if (decimalCompare(decimalAbs(value.lower), decimal(10_000n)) > 0 ||
      decimalCompare(decimalAbs(value.upper), decimal(10_000n)) > 0) {
    throw new RangeError("Certified exponential currently requires |x| <= 10000.");
  }
  const lower = expPointBounds(value.lower, precision);
  const upper = expPointBounds(value.upper, precision);
  return decimalInterval(lower.lower, upper.upper);
}

function atanhLogSeries(zLower: BigDecimal, zUpper: BigDecimal, precision: number): DecimalInterval {
  if (decimalCompare(zLower, ZERO) < 0 || decimalCompare(zUpper, decimal("0.9")) >= 0) {
    throw new RangeError("Internal logarithm series requires 0 <= z < 0.9.");
  }
  if (decimalCompare(zUpper, ZERO) === 0) return decimalInterval(ZERO);

  const p = workingPrecision(precision);
  const lower = down(p);
  const upper = up(p);
  const z2Lower = decimalMultiply(zLower, zLower, lower);
  const z2Upper = decimalMultiply(zUpper, zUpper, upper);
  const targetFactor = decimalPowerOfTen(-Math.max(2, precision - 2));
  let termLower = zLower;
  let termUpper = zUpper;
  let sumLower = ZERO;
  let sumUpper = ZERO;
  const maximumTerms = Math.max(2000, precision * 80 + 200);

  for (let n = 0; n < maximumTerms; n++) {
    const odd = decimal(BigInt(2 * n + 1));
    const contributionLower = decimalDivide(termLower, odd, lower);
    const contributionUpper = decimalDivide(termUpper, odd, upper);
    sumLower = decimalAdd(sumLower, contributionLower, lower);
    sumUpper = decimalAdd(sumUpper, contributionUpper, upper);

    const nextPower = decimalMultiply(termUpper, z2Upper, upper);
    // Subsequent powers shrink by at least z^2 and denominators only grow.
    // Dropping the future denominators gives a conservative geometric tail bound.
    const denominatorLower = decimalSubtract(ONE, z2Upper, lower);
    if (decimalCompare(denominatorLower, ZERO) <= 0) {
      throw new RangeError("Certified logarithm tail bound became non-positive.");
    }
    const tailUpper = decimalDivide(nextPower, denominatorLower, upper);
    const target = decimalMultiply(sumUpper, targetFactor, upper);
    if (n >= 1 && decimalCompare(tailUpper, target) <= 0) {
      return decimalInterval(
        decimalMultiply(decimal(2n), sumLower, lower),
        decimalMultiply(decimal(2n), decimalAdd(sumUpper, tailUpper, upper), upper),
      );
    }

    termLower = decimalMultiply(termLower, z2Lower, lower);
    termUpper = nextPower;
  }
  throw new RangeError("Certified logarithm series did not reach the requested precision.");
}

function logMantissaBounds(mantissa: BigDecimal, precision: number): DecimalInterval {
  if (decimalCompare(mantissa, ONE) === 0) return decimalInterval(ZERO);
  const p = workingPrecision(precision);
  const numerator = decimalSubtract(mantissa, ONE);
  const denominator = decimalAdd(mantissa, ONE);
  const zLower = decimalDivide(numerator, denominator, down(p));
  const zUpper = decimalDivide(numerator, denominator, up(p));
  return atanhLogSeries(zLower, zUpper, precision);
}

function log10Bounds(precision: number): DecimalInterval {
  const p = workingPrecision(precision);
  const cached = ln10BoundsCache.get(p);
  if (cached) return cached;
  const result = logMantissaBounds(decimal(10n), p);
  ln10BoundsCache.set(p, result);
  return result;
}

function lnPointBounds(value: BigDecimal, precision: number): DecimalInterval {
  if (decimalCompare(value, ZERO) <= 0) {
    throw new RangeError("Certified logarithm requires a strictly positive real argument.");
  }
  const coefficientDigits = value.coefficient.toString();
  const digits = coefficientDigits.startsWith("-") ? coefficientDigits.slice(1) : coefficientDigits;
  const exponent = digits.length - 1 - value.scale;
  const mantissaText = digits.length === 1 ? digits : `${digits[0]}.${digits.slice(1)}`;
  const mantissa = decimal(mantissaText);
  const lnMantissa = logMantissaBounds(mantissa, precision);
  if (exponent === 0) return lnMantissa;
  const scaledLn10 = decimalIntervalMultiply(
    decimalInterval(decimal(BigInt(exponent))),
    log10Bounds(precision),
    workingPrecision(precision),
  );
  return decimalIntervalAdd(lnMantissa, scaledLn10, workingPrecision(precision));
}

/** Certified enclosure of ln(x) over an interval whose complete domain is positive. */
export function decimalIntervalLn(value: DecimalInterval, precision = 50): DecimalInterval {
  precisionOf({ precision });
  if (decimalCompare(value.lower, ZERO) <= 0) {
    throw new RangeError("Certified logarithm requires an interval with a strictly positive lower endpoint.");
  }
  const lower = lnPointBounds(value.lower, precision);
  const upper = lnPointBounds(value.upper, precision);
  return decimalInterval(lower.lower, upper.upper);
}

const certifiedPiCache = new Map<number, DecimalInterval>();

function roundIntervalOutward(value: DecimalInterval, precision: number): DecimalInterval {
  return decimalInterval(
    decimalRound(value.lower, precision, "floor"),
    decimalRound(value.upper, precision, "ceil"),
  );
}

/** atan(z) for a positive, small interval; the alternating-series tail is bounded by the first omitted term. */
function atanSmallInterval(z: DecimalInterval, precision: number): DecimalInterval {
  const p = workingPrecision(precision);
  const zSquared = decimalIntervalMultiply(z, z, p);
  const target = decimalPowerOfTen(-(precision + 2));
  let power = z;
  let sum = decimalInterval(ZERO);
  const maximumTerms = Math.max(100, precision * 3 + 100);

  for (let index = 0; index < maximumTerms; index++) {
    const denominator = decimalInterval(BigInt(2 * index + 1));
    const term = decimalIntervalDivide(power, denominator, p);
    sum = index % 2 === 0
      ? decimalIntervalAdd(sum, term, p)
      : decimalIntervalSubtract(sum, term, p);

    const nextPower = decimalIntervalMultiply(power, zSquared, p);
    const nextTerm = decimalIntervalDivide(
      nextPower,
      decimalInterval(BigInt(2 * index + 3)),
      p,
    );
    if (decimalCompare(nextTerm.upper, target) <= 0) {
      const nextIndexIsPositive = (index + 1) % 2 === 0;
      const enclosed = nextIndexIsPositive
        ? decimalInterval(sum.lower, decimalAdd(sum.upper, nextTerm.upper, up(p)))
        : decimalInterval(decimalSubtract(sum.lower, nextTerm.upper, down(p)), sum.upper);
      return roundIntervalOutward(enclosed, precision);
    }
    power = nextPower;
  }
  throw new RangeError("Certified arctangent series did not reach the requested precision.");
}

/** Machin formula with outward-rounded arctangent series: pi = 16 atan(1/5) - 4 atan(1/239). */
export function decimalIntervalPi(precision = 50): DecimalInterval {
  precisionOf({ precision });
  if (precision > 988) {
    throw new RangeError("Certified pi precision is limited to 988 digits to reserve guard digits for the series remainder.");
  }
  const cached = certifiedPiCache.get(precision);
  if (cached) return cached;
  const p = workingPrecision(precision);
  const atanOneFifth = atanSmallInterval(
    decimalIntervalDivide(decimalInterval(ONE), decimalInterval(5n), p),
    precision,
  );
  const atanOne239 = atanSmallInterval(
    decimalIntervalDivide(decimalInterval(ONE), decimalInterval(239n), p),
    precision,
  );
  const sixteenTimes = decimalIntervalMultiply(decimalInterval(16n), atanOneFifth, p);
  const fourTimes = decimalIntervalMultiply(decimalInterval(4n), atanOne239, p);
  const result = roundIntervalOutward(decimalIntervalSubtract(sixteenTimes, fourTimes, p), precision);
  certifiedPiCache.set(precision, result);
  return result;
}

function decimalOrder10(value: BigDecimal): number {
  if (value.coefficient === 0n) return Number.NEGATIVE_INFINITY;
  const coefficient = value.coefficient < 0n ? -value.coefficient : value.coefficient;
  return coefficient.toString().length - 1 - value.scale;
}

function trigWorkingPrecision(value: DecimalInterval, precision: number): number {
  const maxArgument = decimalPowerOfTen(30);
  if (
    decimalCompare(decimalAbs(value.lower), maxArgument) > 0 ||
    decimalCompare(decimalAbs(value.upper), maxArgument) > 0
  ) {
    throw new RangeError("Certified trigonometric argument magnitude is limited to |x| <= 1e30.");
  }
  const magnitudeOrder = Math.max(0, decimalOrder10(value.lower), decimalOrder10(value.upper));
  const required = precision + magnitudeOrder + 24;
  if (required > 988) {
    throw new RangeError(
      "Requested precision and argument magnitude leave insufficient guard digits for certified trigonometric reduction; lower precision or reduce the argument first.",
    );
  }
  return required;
}

function nearestInteger(value: BigDecimal): bigint {
  if (value.coefficient === 0n) return 0n;
  const negative = value.coefficient < 0n;
  const absolute = negative ? -value.coefficient : value.coefficient;
  if (value.scale <= 0) {
    const integer = absolute * (10n ** BigInt(-value.scale));
    return negative ? -integer : integer;
  }
  const divisor = 10n ** BigInt(value.scale);
  let quotient = absolute / divisor;
  const remainder = absolute % divisor;
  if (2n * remainder >= divisor) quotient++;
  return negative ? -quotient : quotient;
}

interface ReducedPoint {
  readonly quadrant: bigint;
  readonly remainder: DecimalInterval;
}

function reducePointByCertifiedPi(value: BigDecimal, precision: number): ReducedPoint {
  const pi = decimalIntervalPi(precision);
  const halfPi = decimalIntervalDivide(pi, decimalInterval(2n), precision);
  const context: DecimalContext = { precision, rounding: "half-even" };
  const piMidpoint = decimalDivide(decimalAdd(pi.lower, pi.upper, context), decimal(2n), context);
  const halfPiMidpoint = decimalDivide(piMidpoint, decimal(2n), context);
  const quotient = decimalDivide(value, halfPiMidpoint, context);
  const candidate = nearestInteger(quotient);
  const one = decimal(1n);
  const minusOne = decimal(-1n);
  const offsets = [0n, -1n, 1n, -2n, 2n];

  for (const offset of offsets) {
    const quadrant = candidate + offset;
    const multiple = decimalIntervalMultiply(decimalInterval(quadrant), halfPi, precision);
    const remainder = decimalIntervalSubtract(decimalInterval(value), multiple, precision);
    if (
      decimalCompare(remainder.lower, minusOne) >= 0 &&
      decimalCompare(remainder.upper, one) <= 0
    ) {
      return { quadrant, remainder };
    }
  }
  throw new RangeError("Certified trigonometric argument reduction could not prove a remainder inside [-1, 1].");
}

/** Rigorous alternating Taylor enclosure for sin(x) at a point in [-1, 1]. */
function sinPointBounds(value: BigDecimal, precision: number): DecimalInterval {
  if (decimalCompare(value, ZERO) === 0) return decimalInterval(ZERO);
  const p = workingPrecision(precision);
  const x = decimalInterval(value);
  const xSquared = decimalIntervalPowInteger(x, 2n, p);
  const lower = down(p);
  const upper = up(p);
  const target = decimalPowerOfTen(-(precision + 2));
  let term = x;
  let sum = x;
  const maximumTerms = Math.max(100, precision * 2 + 100);

  for (let n = 0; n < maximumTerms; n++) {
    const denominator = decimal(BigInt((2 * n + 2) * (2 * n + 3)));
    const next = decimalIntervalNegate(
      decimalIntervalDivide(decimalIntervalMultiply(term, xSquared, p), decimalInterval(denominator), p),
    );
    sum = decimalIntervalAdd(sum, next, p);

    const nextDenominator = decimal(BigInt((2 * n + 4) * (2 * n + 5)));
    const following = decimalIntervalNegate(
      decimalIntervalDivide(decimalIntervalMultiply(next, xSquared, p), decimalInterval(nextDenominator), p),
    );
    const remainderBound = decimalIntervalAbs(following).upper;
    if (decimalCompare(remainderBound, target) <= 0) {
      return decimalInterval(
        decimalRound(decimalSubtract(sum.lower, remainderBound, lower), precision, "floor"),
        decimalRound(decimalAdd(sum.upper, remainderBound, upper), precision, "ceil"),
      );
    }
    term = next;
  }
  throw new RangeError("Certified sine Taylor series did not reach the requested precision.");
}

/** Rigorous alternating Taylor enclosure for cos(x) at a point in [-1, 1]. */
function cosPointBounds(value: BigDecimal, precision: number): DecimalInterval {
  if (decimalCompare(value, ZERO) === 0) return decimalInterval(ONE);
  const p = workingPrecision(precision);
  const x = decimalInterval(value);
  const xSquared = decimalIntervalPowInteger(x, 2n, p);
  const lower = down(p);
  const upper = up(p);
  const target = decimalPowerOfTen(-(precision + 2));
  let term = decimalInterval(ONE);
  let sum = term;
  const maximumTerms = Math.max(100, precision * 2 + 100);

  for (let n = 0; n < maximumTerms; n++) {
    const denominator = decimal(BigInt((2 * n + 1) * (2 * n + 2)));
    const next = decimalIntervalNegate(
      decimalIntervalDivide(decimalIntervalMultiply(term, xSquared, p), decimalInterval(denominator), p),
    );
    sum = decimalIntervalAdd(sum, next, p);

    const nextDenominator = decimal(BigInt((2 * n + 3) * (2 * n + 4)));
    const following = decimalIntervalNegate(
      decimalIntervalDivide(decimalIntervalMultiply(next, xSquared, p), decimalInterval(nextDenominator), p),
    );
    const remainderBound = decimalIntervalAbs(following).upper;
    if (decimalCompare(remainderBound, target) <= 0) {
      return decimalInterval(
        decimalRound(decimalSubtract(sum.lower, remainderBound, lower), precision, "floor"),
        decimalRound(decimalAdd(sum.upper, remainderBound, upper), precision, "ceil"),
      );
    }
    term = next;
  }
  throw new RangeError("Certified cosine Taylor series did not reach the requested precision.");
}

function smallSineRange(value: DecimalInterval, precision: number): DecimalInterval {
  if (decimalCompare(value.lower, decimal(-1n)) < 0 || decimalCompare(value.upper, ONE) > 0) {
    throw new RangeError("Internal reduced sine interval is outside [-1, 1].");
  }
  const lower = sinPointBounds(value.lower, precision);
  const upper = sinPointBounds(value.upper, precision);
  return decimalInterval(lower.lower, upper.upper);
}

function smallCosineRange(value: DecimalInterval, precision: number): DecimalInterval {
  if (decimalCompare(value.lower, decimal(-1n)) < 0 || decimalCompare(value.upper, ONE) > 0) {
    throw new RangeError("Internal reduced cosine interval is outside [-1, 1].");
  }
  const left = cosPointBounds(value.lower, precision);
  const right = cosPointBounds(value.upper, precision);
  const lower = decimalCompare(left.lower, right.lower) <= 0 ? left.lower : right.lower;
  let upper = decimalCompare(left.upper, right.upper) >= 0 ? left.upper : right.upper;
  if (decimalIntervalContainsZero(value) && decimalCompare(upper, ONE) < 0) upper = ONE;
  return decimalInterval(lower, upper);
}

function moduloFour(value: bigint): bigint {
  return ((value % 4n) + 4n) % 4n;
}

interface PointSinCosBounds {
  readonly sine: DecimalInterval;
  readonly cosine: DecimalInterval;
}

function sinCosPointBounds(value: BigDecimal, precision: number, outputPrecision = precision): PointSinCosBounds {
  const reduced = reducePointByCertifiedPi(value, precision);
  const sineRemainder = smallSineRange(reduced.remainder, precision);
  const cosineRemainder = smallCosineRange(reduced.remainder, precision);
  const quadrant = moduloFour(reduced.quadrant);
  let sine: DecimalInterval;
  let cosine: DecimalInterval;
  switch (quadrant) {
    case 0n:
      sine = sineRemainder;
      cosine = cosineRemainder;
      break;
    case 1n:
      sine = cosineRemainder;
      cosine = decimalIntervalNegate(sineRemainder);
      break;
    case 2n:
      sine = decimalIntervalNegate(sineRemainder);
      cosine = decimalIntervalNegate(cosineRemainder);
      break;
    default:
      sine = decimalIntervalNegate(cosineRemainder);
      cosine = sineRemainder;
      break;
  }
  return {
    sine: roundIntervalOutward(sine, outputPrecision),
    cosine: roundIntervalOutward(cosine, outputPrecision),
  };
}

function minDecimal(a: BigDecimal, b: BigDecimal): BigDecimal {
  return decimalCompare(a, b) <= 0 ? a : b;
}

function maxDecimal(a: BigDecimal, b: BigDecimal): BigDecimal {
  return decimalCompare(a, b) >= 0 ? a : b;
}

function intervalOverlaps(a: DecimalInterval, b: DecimalInterval): boolean {
  return decimalCompare(a.upper, b.lower) >= 0 && decimalCompare(a.lower, b.upper) <= 0;
}

function includeTrigCriticalValues(
  kind: "sin" | "cos",
  value: DecimalInterval,
  centerQuadrant: bigint,
  precision: number,
  initialLower: BigDecimal,
  initialUpper: BigDecimal,
): DecimalInterval {
  const halfPi = decimalIntervalDivide(decimalIntervalPi(precision), decimalInterval(2n), precision);
  let lower = initialLower;
  let upper = initialUpper;
  // The interval has width below one full period; +/-8 half-pi multiples safely
  // cover all possible extrema around the reduced lower endpoint.
  for (let offset = -8n; offset <= 8n; offset++) {
    const multipleIndex = centerQuadrant + offset;
    const criticalPoint = decimalIntervalMultiply(decimalInterval(multipleIndex), halfPi, precision);
    if (!intervalOverlaps(criticalPoint, value)) continue;
    const quadrant = moduloFour(multipleIndex);
    if (kind === "sin" && multipleIndex % 2n !== 0n) {
      if (quadrant === 1n) upper = ONE;
      else if (quadrant === 3n) lower = decimal(-1n);
    } else if (kind === "cos" && multipleIndex % 2n === 0n) {
      if (quadrant === 0n) upper = ONE;
      else if (quadrant === 2n) lower = decimal(-1n);
    }
  }
  return decimalInterval(lower, upper);
}

function trigRange(
  kind: "sin" | "cos",
  value: DecimalInterval,
  precision: number,
): DecimalInterval {
  precisionOf({ precision });
  const workPrecision = trigWorkingPrecision(value, precision);
  const pi = decimalIntervalPi(workPrecision);
  const period = decimalIntervalMultiply(decimalInterval(2n), pi, workPrecision);
  const widthInterval = decimalIntervalSubtract(decimalInterval(value.upper), decimalInterval(value.lower), workPrecision);
  if (decimalCompare(widthInterval.lower, period.upper) >= 0) {
    return decimalInterval(-1n, 1n);
  }

  const lowerPoint = sinCosPointBounds(value.lower, workPrecision, workPrecision);
  const upperPoint = sinCosPointBounds(value.upper, workPrecision, workPrecision);
  const lowerRange = kind === "sin" ? lowerPoint.sine : lowerPoint.cosine;
  const upperRange = kind === "sin" ? upperPoint.sine : upperPoint.cosine;
  let lower = minDecimal(lowerRange.lower, upperRange.lower);
  let upper = maxDecimal(lowerRange.upper, upperRange.upper);
  const centerQuadrant = reducePointByCertifiedPi(value.lower, workPrecision).quadrant;
  const extremaIncluded = includeTrigCriticalValues(kind, value, centerQuadrant, workPrecision, lower, upper);
  lower = extremaIncluded.lower;
  upper = extremaIncluded.upper;
  return roundIntervalOutward(decimalInterval(lower, upper), precision);
}

/** Certified sine range for finite intervals up to |x| <= 1e30. */
export function decimalIntervalSin(value: DecimalInterval, precision = 50): DecimalInterval {
  return trigRange("sin", value, precision);
}

/** Certified cosine range for finite intervals up to |x| <= 1e30. */
export function decimalIntervalCos(value: DecimalInterval, precision = 50): DecimalInterval {
  return trigRange("cos", value, precision);
}

/** Certified tangent range, provided the cosine range proves that no pole lies in the interval. */
export function decimalIntervalTan(value: DecimalInterval, precision = 50): DecimalInterval {
  precisionOf({ precision });
  const cosineRange = decimalIntervalCos(value, precision);
  if (decimalIntervalContainsZero(cosineRange)) {
    throw new RangeError("Certified tangent interval may contain a pole where cosine is zero.");
  }
  const workPrecision = trigWorkingPrecision(value, precision);
  const left = sinCosPointBounds(value.lower, workPrecision, workPrecision);
  const right = sinCosPointBounds(value.upper, workPrecision, workPrecision);
  const leftTangent = decimalIntervalDivide(left.sine, left.cosine, workPrecision);
  const rightTangent = decimalIntervalDivide(right.sine, right.cosine, workPrecision);
  const lower = minDecimal(leftTangent.lower, rightTangent.lower);
  const upper = maxDecimal(leftTangent.upper, rightTangent.upper);
  return roundIntervalOutward(decimalInterval(lower, upper), precision);
}

function exactRationalInterval(value: NumericExpr, precision: number): DecimalInterval {
  const [numerator, denominator] = numericParts(value);
  if (denominator === 1n) return decimalInterval(numerator);
  return decimalInterval(
    decimalDivide(decimal(numerator), decimal(denominator), down(precision)),
    decimalDivide(decimal(numerator), decimal(denominator), up(precision)),
  );
}

function integerExponent(expr: Expr, maxExponent: number): bigint | null {
  if (expr.kind === "Integer") {
    if (expr.value > BigInt(maxExponent) || expr.value < -BigInt(maxExponent)) {
      throw new RangeError(`Interval exponent magnitude exceeds configured limit ${maxExponent}.`);
    }
    return expr.value;
  }
  if (expr.kind !== "Rational") return null;
  if (expr.numerator % expr.denominator !== 0n) return null;
  const value = expr.numerator / expr.denominator;
  if (value > BigInt(maxExponent) || value < -BigInt(maxExponent)) {
    throw new RangeError(`Interval exponent magnitude exceeds configured limit ${maxExponent}.`);
  }
  return value;
}

/**
 * Evaluates a supported real expression over an interval.
 * Supported nodes: rationals, bound symbols, sums, products, integer powers,
 * sqrt, abs, sign, exp, ln/log, and sin/cos/tan on finite intervals with |x| <= 1e30.
 * Trigonometric reduction uses an interval for pi and refuses cases that exceed the
 * precision/guard-digit budget. Transcendental bounds use explicit remainder estimates.
 */
export function evaluateDecimalInterval(
  expression: Expr,
  bindings: DecimalIntervalBindings = {},
  options: DecimalIntervalOptions = {},
): DecimalIntervalEvaluationResult {
  const precision = precisionOf(options);
  const maxExponent = options.maxExponent ?? 10_000;
  if (!Number.isSafeInteger(maxExponent) || maxExponent < 0 || maxExponent > 10_000) {
    throw new RangeError("maxExponent must be an integer between 0 and 10000.");
  }
  const interval = evaluateInner(expression, bindings, precision, maxExponent);
  return {
    interval,
    lowerText: decimalToString(interval.lower),
    upperText: decimalToString(interval.upper),
    precision,
    certified: true,
    method: "outward-rounded-interval-arithmetic",
  };
}

function evaluateInner(
  expression: Expr,
  bindings: DecimalIntervalBindings,
  precision: number,
  maxExponent: number,
): DecimalInterval {
  switch (expression.kind) {
    case "Integer":
    case "Rational":
      return exactRationalInterval(expression, precision);
    case "Symbol": {
      const binding = bindings[expression.name];
      if (binding === undefined) throw new ReferenceError(`No interval supplied for symbol '${expression.name}'.`);
      return asDecimalInterval(binding);
    }
    case "Add": {
      return expression.terms.reduce(
        (sum, term) => decimalIntervalAdd(sum, evaluateInner(term, bindings, precision, maxExponent), precision),
        decimalInterval(ZERO),
      );
    }
    case "Mul": {
      return expression.factors.reduce(
        (product, factor) => decimalIntervalMultiply(product, evaluateInner(factor, bindings, precision, maxExponent), precision),
        decimalInterval(ONE),
      );
    }
    case "Pow": {
      const exponent = integerExponent(expression.exponent, maxExponent);
      if (exponent === null) {
        throw new RangeError("Certified interval evaluation currently requires an integer exponent.");
      }
      return decimalIntervalPowInteger(
        evaluateInner(expression.base, bindings, precision, maxExponent),
        exponent,
        precision,
        maxExponent,
      );
    }
    case "Function": {
      if (expression.args.length !== 1) throw new RangeError(`Function '${expression.name}' expects one argument.`);
      const argument = evaluateInner(expression.args[0]!, bindings, precision, maxExponent);
      switch (expression.name) {
        case "sqrt": return decimalIntervalSqrt(argument, precision);
        case "cbrt": return decimalIntervalCbrt(argument, precision);
        case "abs": return decimalIntervalAbs(argument);
        case "exp": return decimalIntervalExp(argument, precision);
        case "ln":
        case "log": return decimalIntervalLn(argument, precision);
        case "sin": return decimalIntervalSin(argument, precision);
        case "cos": return decimalIntervalCos(argument, precision);
        case "tan": return decimalIntervalTan(argument, precision);
        case "sign": {
          if (decimalCompare(argument.lower, ZERO) > 0) return decimalInterval(ONE);
          if (decimalCompare(argument.upper, ZERO) < 0) return decimalInterval(-1n);
          if (decimalCompare(argument.lower, ZERO) === 0 && decimalCompare(argument.upper, ZERO) === 0) return decimalInterval(ZERO);
          return decimalInterval(-1n, 1n);
        }
        default: throw new RangeError(`Function '${expression.name}' is not supported by certified interval evaluation.`);
      }
    }
  }
}

/** Convenient text representation for logs and diagnostics. */
export function decimalIntervalToString(interval: DecimalInterval): string {
  return `[${decimalToString(interval.lower)}, ${decimalToString(interval.upper)}]`;
}
