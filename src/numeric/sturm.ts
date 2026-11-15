/**
 * Exact Sturm-sequence isolation for real roots of rational polynomials.
 * All signs, gcds, square-free factors and root counts use BigInt rationals.
 * No floating-point threshold is used to decide whether a root exists.
 */

export interface ExactRational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export interface ExactRootInterval {
  readonly lower: ExactRational;
  readonly upper: ExactRational;
  /** Exactly one distinct real root is in this interval. */
  readonly distinctRootCount: 1;
  readonly multiplicity: number;
  readonly iterations: number;
  /** True iff the interval width satisfies the requested tolerance. */
  readonly converged: boolean;
}

export interface ExactUnresolvedRootInterval {
  readonly lower: ExactRational;
  readonly upper: ExactRational;
  /** Exact number of distinct roots still enclosed by this interval. */
  readonly distinctRootCount: number;
}

export interface ExactRootIsolationResult {
  readonly degree: number;
  readonly status: "finite" | "partial" | "none";
  readonly roots: readonly ExactRootInterval[];
  readonly unresolvedIntervals: readonly ExactUnresolvedRootInterval[];
  /** Exact number of distinct real roots, even if some are not yet isolated. */
  readonly totalDistinctRealRoots: number;
}

export interface ExactRationalText {
  readonly numerator: string;
  readonly denominator: string;
}

export interface ExactSturmVariations {
  readonly atLower: number;
  readonly atUpper: number;
}

export interface ExactCertifiedRootInterval {
  readonly lower: ExactRationalText;
  readonly upper: ExactRationalText;
  readonly multiplicity: number;
  readonly sturmVariations: ExactSturmVariations;
}

export interface ExactUnresolvedRootIntervalCertificate {
  readonly lower: ExactRationalText;
  readonly upper: ExactRationalText;
  readonly distinctRootCount: number;
  readonly sturmVariations: ExactSturmVariations;
}

/** JSON-serializable claims whose root counts can be checked using exact arithmetic. */
export interface ExactPolynomialRootCertificate {
  readonly version: 1;
  /** Polynomial coefficients in ascending order, as normalized rational strings. */
  readonly coefficients: readonly ExactRationalText[];
  readonly status: "complete" | "partial";
  readonly totalDistinctRealRoots: number;
  readonly roots: readonly ExactCertifiedRootInterval[];
  readonly unresolvedIntervals: readonly ExactUnresolvedRootIntervalCertificate[];
}

export type ExactRootCertificateCreationResult =
  | { readonly status: "complete" | "partial"; readonly certificate: ExactPolynomialRootCertificate }
  | { readonly status: "all" | "unsupported"; readonly message: string };

export interface ExactRootCertificateVerificationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

interface SquareFreeFactor {
  readonly coefficients: Q[];
  readonly multiplicity: number;
}

interface IntervalWork {
  readonly lower: Q;
  readonly upper: Q;
  readonly count: number;
  readonly depth: number;
}

type Q = ExactRational;
type QPoly = Q[];

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function gcdBigInt(a: bigint, b: bigint): bigint {
  a = absBigInt(a);
  b = absBigInt(b);
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function lcmBigInt(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n;
  return absBigInt((a / gcdBigInt(a, b)) * b);
}

export function exactRational(numerator: bigint, denominator: bigint = 1n): ExactRational {
  if (denominator === 0n) throw new RangeError("Exact rational denominator cannot be zero.");
  if (numerator === 0n) return { numerator: 0n, denominator: 1n };
  let n = numerator;
  let d = denominator;
  if (d < 0n) { n = -n; d = -d; }
  const g = gcdBigInt(n, d);
  return { numerator: n / g, denominator: d / g };
}

function qZero(): Q { return exactRational(0n); }
function qOne(): Q { return exactRational(1n); }
function qIsZero(value: Q): boolean { return value.numerator === 0n; }
function qSign(value: Q): -1 | 0 | 1 {
  return value.numerator < 0n ? -1 : value.numerator > 0n ? 1 : 0;
}
function qNegate(value: Q): Q { return exactRational(-value.numerator, value.denominator); }
function qAbs(value: Q): Q { return value.numerator < 0n ? qNegate(value) : value; }

function qAdd(a: Q, b: Q): Q {
  const common = gcdBigInt(a.denominator, b.denominator);
  const aFactor = b.denominator / common;
  const bFactor = a.denominator / common;
  return exactRational(
    a.numerator * aFactor + b.numerator * bFactor,
    a.denominator * aFactor,
  );
}

function qSubtract(a: Q, b: Q): Q { return qAdd(a, qNegate(b)); }

function qMultiply(a: Q, b: Q): Q {
  const g1 = gcdBigInt(a.numerator, b.denominator);
  const g2 = gcdBigInt(b.numerator, a.denominator);
  return exactRational(
    (a.numerator / g1) * (b.numerator / g2),
    (a.denominator / g2) * (b.denominator / g1),
  );
}

function qDivide(a: Q, b: Q): Q {
  if (b.numerator === 0n) throw new RangeError("Exact rational division by zero.");
  return qMultiply(a, exactRational(b.denominator, b.numerator));
}

function qCompare(a: Q, b: Q): -1 | 0 | 1 {
  const left = a.numerator * b.denominator;
  const right = b.numerator * a.denominator;
  return left < right ? -1 : left > right ? 1 : 0;
}

function qMax(a: Q, b: Q): Q { return qCompare(a, b) >= 0 ? a : b; }
function qMin(a: Q, b: Q): Q { return qCompare(a, b) <= 0 ? a : b; }

export function exactRationalFromDecimalParts(coefficient: bigint, scale: number): ExactRational {
  if (!Number.isSafeInteger(scale) || Math.abs(scale) > 100_000) {
    throw new RangeError("Decimal scale is outside the supported exact-rational range.");
  }
  return scale >= 0
    ? exactRational(coefficient, 10n ** BigInt(scale))
    : exactRational(coefficient * (10n ** BigInt(-scale)), 1n);
}

export function exactRationalToString(value: ExactRational): string {
  const normalized = exactRational(value.numerator, value.denominator);
  return normalized.denominator === 1n
    ? normalized.numerator.toString()
    : `${normalized.numerator}/${normalized.denominator}`;
}

export function evaluateExactPolynomialSign(
  inputCoefficients: readonly ExactRational[],
  point: ExactRational,
): -1 | 0 | 1 {
  const coefficients = trimPoly(inputCoefficients.map(value =>
    exactRational(value.numerator, value.denominator),
  ));
  const normalizedPoint = exactRational(point.numerator, point.denominator);
  return qSign(qEvaluate(coefficients, normalizedPoint));
}

function trimPoly(input: readonly Q[]): QPoly {
  const result = [...input];
  while (result.length > 1 && qIsZero(result[result.length - 1]!)) result.pop();
  return result.length === 0 ? [qZero()] : result;
}

function polyDegree(poly: readonly Q[]): number {
  const trimmed = trimPoly(poly);
  return trimmed.length === 1 && qIsZero(trimmed[0]!) ? -1 : trimmed.length - 1;
}

function polyIsZero(poly: readonly Q[]): boolean { return polyDegree(poly) < 0; }

/** Scales by a positive rational to primitive integer coefficients, preserving signs. */
function primitiveNormalize(input: readonly Q[]): QPoly {
  const poly = trimPoly(input);
  if (polyIsZero(poly)) return [qZero()];
  let denominatorLcm = 1n;
  for (const coefficient of poly) {
    denominatorLcm = lcmBigInt(denominatorLcm, coefficient.denominator);
  }
  const integers = poly.map(coefficient =>
    coefficient.numerator * (denominatorLcm / coefficient.denominator),
  );
  let common = 0n;
  for (const value of integers) common = gcdBigInt(common, value);
  if (common === 0n) return [qZero()];
  return trimPoly(integers.map(value => exactRational(value / common)));
}

function polyMonic(input: readonly Q[]): QPoly {
  const poly = trimPoly(input);
  if (polyIsZero(poly)) return [qZero()];
  const leading = poly[poly.length - 1]!;
  return trimPoly(poly.map(coefficient => qDivide(coefficient, leading)));
}

function polyDerivative(input: readonly Q[]): QPoly {
  const poly = trimPoly(input);
  if (poly.length <= 1) return [qZero()];
  return trimPoly(poly.slice(1).map((coefficient, index) =>
    qMultiply(coefficient, exactRational(BigInt(index + 1))),
  ));
}

function polyAdd(a: readonly Q[], b: readonly Q[]): QPoly {
  const size = Math.max(a.length, b.length);
  const result: Q[] = [];
  for (let i = 0; i < size; i++) result.push(qAdd(a[i] ?? qZero(), b[i] ?? qZero()));
  return trimPoly(result);
}

function polyNegate(input: readonly Q[]): QPoly {
  return trimPoly(input.map(qNegate));
}

function polyMultiply(a: readonly Q[], b: readonly Q[]): QPoly {
  if (polyIsZero(a) || polyIsZero(b)) return [qZero()];
  const result = Array.from({ length: a.length + b.length - 1 }, () => qZero());
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      result[i + j] = qAdd(result[i + j]!, qMultiply(a[i]!, b[j]!));
    }
  }
  return trimPoly(result);
}

function polyDivRem(dividendInput: readonly Q[], divisorInput: readonly Q[]): { quotient: QPoly; remainder: QPoly } {
  const dividend = trimPoly(dividendInput);
  const divisor = trimPoly(divisorInput);
  if (polyIsZero(divisor)) throw new RangeError("Polynomial division by the zero polynomial.");
  const remainder = [...dividend];
  const quotient = Array.from(
    { length: Math.max(1, dividend.length - divisor.length + 1) },
    () => qZero(),
  );
  while (!polyIsZero(remainder) && remainder.length >= divisor.length) {
    const offset = remainder.length - divisor.length;
    const factor = qDivide(remainder[remainder.length - 1]!, divisor[divisor.length - 1]!);
    quotient[offset] = qAdd(quotient[offset]!, factor);
    for (let i = 0; i < divisor.length; i++) {
      remainder[offset + i] = qSubtract(
        remainder[offset + i]!,
        qMultiply(factor, divisor[i]!),
      );
    }
    const trimmed = trimPoly(remainder);
    remainder.length = 0;
    remainder.push(...trimmed);
  }
  return { quotient: trimPoly(quotient), remainder: trimPoly(remainder) };
}

function polyRemainder(a: readonly Q[], b: readonly Q[]): QPoly {
  const remainder = polyDivRem(a, b).remainder;
  return polyIsZero(remainder) ? [qZero()] : primitiveNormalize(remainder);
}

function polyDivideExact(a: readonly Q[], b: readonly Q[]): QPoly {
  const { quotient, remainder } = polyDivRem(a, b);
  if (!polyIsZero(remainder)) throw new Error("Internal exact polynomial division failed.");
  return primitiveNormalize(quotient);
}

function polyGcd(aInput: readonly Q[], bInput: readonly Q[]): QPoly {
  let a = primitiveNormalize(aInput);
  let b = primitiveNormalize(bInput);
  while (!polyIsZero(b)) {
    const remainder = polyRemainder(a, b);
    a = b;
    b = remainder;
  }
  return polyMonic(a);
}

function squareFreeFactorization(input: readonly Q[]): { squareFreePart: QPoly; factors: SquareFreeFactor[] } {
  const polynomial = polyMonic(input);
  const common = polyGcd(polynomial, polyDerivative(polynomial));
  const squareFreePart = polyMonic(polyDivideExact(polynomial, common));
  let repeatedPart = common;
  let remaining = squareFreePart;
  let multiplicity = 1;
  const factors: SquareFreeFactor[] = [];
  const degree = polyDegree(polynomial);

  while (polyDegree(remaining) > 0) {
    if (multiplicity > degree + 1) throw new Error("Square-free factorization did not terminate.");
    const shared = polyGcd(remaining, repeatedPart);
    const exactMultiplicityFactor = polyDivideExact(remaining, shared);
    if (polyDegree(exactMultiplicityFactor) > 0) {
      factors.push({ coefficients: polyMonic(exactMultiplicityFactor), multiplicity });
    }
    remaining = polyMonic(shared);
    repeatedPart = polyMonic(polyDivideExact(repeatedPart, shared));
    multiplicity++;
  }
  return { squareFreePart, factors };
}

function qEvaluate(poly: readonly Q[], x: Q): Q {
  let result = poly[poly.length - 1] ?? qZero();
  for (let index = poly.length - 2; index >= 0; index--) {
    result = qAdd(qMultiply(result, x), poly[index]!);
  }
  return result;
}

function sturmSequence(input: readonly Q[]): QPoly[] {
  const first = primitiveNormalize(input);
  const second = primitiveNormalize(polyDerivative(first));
  if (polyIsZero(second)) return [first];
  const sequence: QPoly[] = [first, second];
  while (polyDegree(sequence[sequence.length - 1]!) > 0) {
    if (sequence.length > first.length + 1) throw new Error("Sturm sequence failed to decrease in degree.");
    const beforeLast = sequence[sequence.length - 2]!;
    const last = sequence[sequence.length - 1]!;
    const remainder = polyRemainder(beforeLast, last);
    if (polyIsZero(remainder)) break;
    sequence.push(primitiveNormalize(polyNegate(remainder)));
  }
  return sequence;
}

function signVariations(sequence: readonly QPoly[], x: Q): number {
  let previous = 0;
  let variations = 0;
  for (const polynomial of sequence) {
    const current = qSign(qEvaluate(polynomial, x));
    if (current === 0) continue;
    if (previous !== 0 && current !== previous) variations++;
    previous = current;
  }
  return variations;
}

function sturmCount(sequence: readonly QPoly[], lower: Q, upper: Q): number {
  if (qCompare(lower, upper) >= 0) throw new RangeError("Root isolation interval must have positive width.");
  const lowerVariation = signVariations(sequence, lower);
  const upperVariation = signVariations(sequence, upper);
  const count = lowerVariation - upperVariation;
  if (count < 0) throw new Error("Sturm variation count became negative; exact isolation invariant failed.");
  return count;
}

/** Sign of a polynomial immediately to one side of x, determined exactly from its Taylor coefficients. */
function polynomialSignAtSide(input: readonly Q[], x: Q, side: -1 | 1): -1 | 0 | 1 {
  let current = trimPoly(input);
  let order = 0;
  while (!polyIsZero(current)) {
    const value = qEvaluate(current, x);
    if (!qIsZero(value)) {
      const sign = qSign(value);
      return side === -1 && order % 2 === 1 ? (sign === 1 ? -1 : 1) : sign;
    }
    current = polyDerivative(current);
    order++;
  }
  return 0;
}

function signVariationsAtSide(sequence: readonly QPoly[], x: Q, side: -1 | 1): number {
  let previous = 0;
  let variations = 0;
  for (const polynomial of sequence) {
    const current = polynomialSignAtSide(polynomial, x, side);
    if (current === 0) continue;
    if (previous !== 0 && current !== previous) variations++;
    previous = current;
  }
  return variations;
}

/** Counts roots strictly inside (lower, upper), also when either endpoint is itself a root. */
function sturmCountOpen(sequence: readonly QPoly[], lower: Q, upper: Q): number {
  if (qCompare(lower, upper) >= 0) throw new RangeError("Root isolation interval must have positive width.");
  const count = signVariationsAtSide(sequence, lower, 1) - signVariationsAtSide(sequence, upper, -1);
  if (count < 0) throw new Error("One-sided Sturm count became negative; exact isolation invariant failed.");
  return count;
}

function cauchyBound(coefficients: readonly Q[]): Q {
  const leading = coefficients[coefficients.length - 1]!;
  if (qIsZero(leading)) throw new Error("Polynomial must be trimmed before computing a root bound.");
  let largest = qZero();
  for (let i = 0; i < coefficients.length - 1; i++) {
    largest = qMax(largest, qAbs(qDivide(coefficients[i]!, leading)));
  }
  // Strictly larger than the classic Cauchy bound 1 + max(|a_i/a_n|).
  return qAdd(exactRational(2n), largest);
}

function qMidpoint(lower: Q, upper: Q): Q {
  return qDivide(qAdd(lower, upper), exactRational(2n));
}

function intervalMeetsTolerance(lower: Q, upper: Q, tolerance: Q): boolean {
  const middle = qMidpoint(lower, upper);
  const scale = qMax(exactRational(1n), qAbs(middle));
  return qCompare(qSubtract(upper, lower), qMultiply(tolerance, scale)) <= 0;
}

function chooseNonRootSplit(poly: readonly Q[], lower: Q, upper: Q): Q {
  const midpoint = qMidpoint(lower, upper);
  // Almost every subdivision point is not a root. Use the exact midpoint in that
  // overwhelmingly common case: repeated multiplication of arbitrary rational
  // denominators caused severe coefficient growth in high-precision bisection.
  // For dyadic endpoints this keeps denominators dyadic and their bit length
  // grows linearly with the number of subdivisions.
  if (!qIsZero(qEvaluate(poly, midpoint))) return midpoint;

  // If the midpoint is an exact rational root, avoid placing a root on an
  // interval boundary (the standard Sturm endpoint formula assumes non-root
  // endpoints). Try distinct dyadic fractions on either side of the midpoint.
  // A degree-n polynomial has at most n roots, while this gives 2(n+1) candidates.
  const width = qSubtract(upper, lower);
  const degree = Math.max(1, polyDegree(poly));
  for (let k = 2; k <= degree + 2; k++) {
    const denominator = 1n << BigInt(k);
    const centre = denominator >> 1n;
    for (const numerator of [centre - 1n, centre + 1n]) {
      const fraction = exactRational(numerator, denominator);
      const candidate = qAdd(lower, qMultiply(width, fraction));
      if (!qIsZero(qEvaluate(poly, candidate))) return candidate;
    }
  }
  throw new Error("Could not choose a non-root subdivision point despite the degree bound.");
}

function isolateIntervals(
  squareFreePart: readonly Q[],
  tolerance: Q,
  maxIterations: number,
  range?: { readonly lower: Q; readonly upper: Q },
): { roots: { interval: ExactRootInterval; midpoint: Q }[]; unresolvedIntervals: ExactUnresolvedRootInterval[]; total: number } {
  const sturm = sturmSequence(squareFreePart);
  const bound = range ? null : cauchyBound(squareFreePart);
  const lower = range?.lower ?? qNegate(bound!);
  const upper = range?.upper ?? bound!;
  const total = range ? sturmCountOpen(sturm, lower, upper) : sturmCount(sturm, lower, upper);
  if (total === 0) return { roots: [], unresolvedIntervals: [], total };

  const queue: IntervalWork[] = [{ lower, upper, count: total, depth: 0 }];
  const roots: { interval: ExactRootInterval; midpoint: Q }[] = [];
  const unresolvedIntervals: ExactUnresolvedRootInterval[] = [];

  while (queue.length > 0) {
    const current = queue.pop()!;
    if (current.count === 0) continue;
    const hasRootEndpoint = qIsZero(qEvaluate(squareFreePart, current.lower)) ||
      qIsZero(qEvaluate(squareFreePart, current.upper));
    if (current.count === 1 && !hasRootEndpoint && intervalMeetsTolerance(current.lower, current.upper, tolerance)) {
      const middle = qMidpoint(current.lower, current.upper);
      roots.push({
        midpoint: middle,
        interval: {
          lower: current.lower,
          upper: current.upper,
          distinctRootCount: 1,
          multiplicity: 0,
          iterations: current.depth,
          converged: true,
        },
      });
      continue;
    }

    if (current.depth >= maxIterations) {
      if (current.count === 1 && !hasRootEndpoint) {
        const middle = qMidpoint(current.lower, current.upper);
        roots.push({
          midpoint: middle,
          interval: {
            lower: current.lower,
            upper: current.upper,
            distinctRootCount: 1,
            multiplicity: 0,
            iterations: current.depth,
            converged: false,
          },
        });
      } else {
        unresolvedIntervals.push({
          lower: current.lower,
          upper: current.upper,
          distinctRootCount: current.count,
        });
      }
      continue;
    }

    const split = chooseNonRootSplit(squareFreePart, current.lower, current.upper);
    const leftCount = sturmCountOpen(sturm, current.lower, split);
    const rightCount = sturmCountOpen(sturm, split, current.upper);
    if (leftCount + rightCount !== current.count) {
      throw new Error("Sturm isolation invariant failed: root counts changed during subdivision.");
    }
    if (rightCount > 0) {
      queue.push({ lower: split, upper: current.upper, count: rightCount, depth: current.depth + 1 });
    }
    if (leftCount > 0) {
      queue.push({ lower: current.lower, upper: split, count: leftCount, depth: current.depth + 1 });
    }
  }

  roots.sort((a, b) => qCompare(a.midpoint, b.midpoint));
  unresolvedIntervals.sort((a, b) => qCompare(a.lower, b.lower));
  return { roots, unresolvedIntervals, total };
}

/** Isolates every distinct real root of an exact rational polynomial. */
export function isolateRealRootsExact(
  inputCoefficients: readonly ExactRational[],
  tolerance: ExactRational,
  maxDegree = 24,
  maxIterations = 200,
): ExactRootIsolationResult {
  const coefficients = trimPoly(inputCoefficients);
  const degree = polyDegree(coefficients);
  if (degree <= 0) {
    return { degree, status: "none", roots: [], unresolvedIntervals: [], totalDistinctRealRoots: 0 };
  }
  if (degree > maxDegree) throw new RangeError(`Polynomial degree ${degree} exceeds configured maximum ${maxDegree}.`);
  if (qSign(tolerance) <= 0) throw new RangeError("Root isolation tolerance must be positive.");
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > 20_000) {
    throw new RangeError("maxIterations must be an integer in [1, 20000].");
  }

  const decomposition = squareFreeFactorization(coefficients);
  const isolated = isolateIntervals(decomposition.squareFreePart, tolerance, maxIterations);
  const factorSequences = decomposition.factors.map(factor => ({
    factor,
    sturm: sturmSequence(factor.coefficients),
  }));

  const roots: ExactRootInterval[] = isolated.roots.map(({ interval }) => {
    const multiplicities = factorSequences
      .filter(({ sturm }) => sturmCount(sturm, interval.lower, interval.upper) === 1)
      .map(({ factor }) => factor.multiplicity);
    if (multiplicities.length !== 1) {
      throw new Error("Could not certify a unique square-free factor for an isolated root.");
    }
    return { ...interval, multiplicity: multiplicities[0]! };
  });

  const unresolvedIntervals = isolated.unresolvedIntervals;
  const converged = roots.every(root => root.converged);
  const complete = unresolvedIntervals.length === 0 && converged && roots.length === isolated.total;
  return {
    degree,
    status: complete ? (roots.length > 0 ? "finite" : "none") : "partial",
    roots,
    unresolvedIntervals,
    totalDistinctRealRoots: isolated.total,
  };
}

/**
 * Isolates all distinct real roots of an exact rational polynomial in a caller-supplied
 * closed interval. Bounds are exact rationals. Roots exactly at either bound are returned
 * as zero-width intervals; roots strictly inside are isolated by one-sided Sturm counts.
 */
export function isolateRealRootsExactInInterval(
  inputCoefficients: readonly ExactRational[],
  lowerInput: ExactRational,
  upperInput: ExactRational,
  tolerance: ExactRational,
  maxDegree = 24,
  maxIterations = 200,
): ExactRootIsolationResult {
  const coefficients = trimPoly(inputCoefficients);
  const degree = polyDegree(coefficients);
  if (degree <= 0) {
    return { degree, status: "none", roots: [], unresolvedIntervals: [], totalDistinctRealRoots: 0 };
  }
  if (degree > maxDegree) throw new RangeError(`Polynomial degree ${degree} exceeds configured maximum ${maxDegree}.`);
  if (qSign(tolerance) <= 0) throw new RangeError("Root isolation tolerance must be positive.");
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > 20_000) {
    throw new RangeError("maxIterations must be an integer in [1, 20000].");
  }

  let lower = exactRational(lowerInput.numerator, lowerInput.denominator);
  let upper = exactRational(upperInput.numerator, upperInput.denominator);
  if (qCompare(lower, upper) > 0) [lower, upper] = [upper, lower];
  if (qCompare(lower, upper) === 0) throw new RangeError("Root isolation interval must have positive width.");

  const decomposition = squareFreeFactorization(coefficients);
  const factorSequences = decomposition.factors.map(factor => ({
    factor,
    sturm: sturmSequence(factor.coefficients),
  }));

  const roots: ExactRootInterval[] = [];
  const addEndpointRoot = (x: Q): void => {
    const matches = factorSequences.filter(({ factor }) => qIsZero(qEvaluate(factor.coefficients, x)));
    if (matches.length === 1) {
      roots.push({ lower: x, upper: x, distinctRootCount: 1, multiplicity: matches[0]!.factor.multiplicity, iterations: 0, converged: true });
    } else if (matches.length > 1) {
      throw new Error("Square-free factors unexpectedly share an endpoint root.");
    }
  };
  addEndpointRoot(lower);
  addEndpointRoot(upper);

  const isolated = isolateIntervals(decomposition.squareFreePart, tolerance, maxIterations, { lower, upper });
  for (const { interval } of isolated.roots) {
    const multiplicities = factorSequences
      .filter(({ sturm }) => sturmCount(sturm, interval.lower, interval.upper) === 1)
      .map(({ factor }) => factor.multiplicity);
    if (multiplicities.length !== 1) {
      throw new Error("Could not certify a unique square-free factor for an isolated root.");
    }
    roots.push({ ...interval, multiplicity: multiplicities[0]! });
  }

  roots.sort((a, b) => qCompare(qMidpoint(a.lower, a.upper), qMidpoint(b.lower, b.upper)));
  const unresolvedIntervals = isolated.unresolvedIntervals;
  const converged = roots.every(root => root.converged);
  // The open-interval Sturm count excludes roots at the bounds, which were added above.
  const endpointCount = roots.filter(root => qCompare(root.lower, root.upper) === 0).length;
  const totalDistinctRealRoots = isolated.total + endpointCount;
  const isComplete = unresolvedIntervals.length === 0 && converged && roots.length === totalDistinctRealRoots;
  return {
    degree,
    status: !isComplete ? "partial" : roots.length > 0 ? "finite" : "none",
    roots,
    unresolvedIntervals,
    totalDistinctRealRoots,
  };
}

function rationalText(value: ExactRational): ExactRationalText {
  const normalized = exactRational(value.numerator, value.denominator);
  return {
    numerator: normalized.numerator.toString(),
    denominator: normalized.denominator.toString(),
  };
}

function variationCounts(sequence: readonly QPoly[], lower: Q, upper: Q): ExactSturmVariations {
  return {
    atLower: signVariations(sequence, lower),
    atUpper: signVariations(sequence, upper),
  };
}

/**
 * Isolate polynomial roots and package the exact rational brackets and Sturm
 * variation counts into a JSON-serializable certificate.
 */
export function createExactPolynomialRootCertificate(
  inputCoefficients: readonly ExactRational[],
  tolerance: ExactRational = exactRational(1n, 1_000_000_000_000n),
  maxDegree = 24,
  maxIterations = 512,
): ExactRootCertificateCreationResult {
  const coefficients = trimPoly(inputCoefficients.map(value =>
    exactRational(value.numerator, value.denominator),
  ));
  if (polyIsZero(coefficients)) {
    return {
      status: "all",
      message: "The zero polynomial has infinitely many real roots and no finite root certificate.",
    };
  }

  const isolation = isolateRealRootsExact(coefficients, tolerance, maxDegree, maxIterations);
  const decomposition = squareFreeFactorization(coefficients);
  const sequence = sturmSequence(decomposition.squareFreePart);
  const roots: ExactCertifiedRootInterval[] = isolation.roots.map(root => ({
    lower: rationalText(root.lower),
    upper: rationalText(root.upper),
    multiplicity: root.multiplicity,
    sturmVariations: variationCounts(sequence, root.lower, root.upper),
  }));
  const unresolvedIntervals: ExactUnresolvedRootIntervalCertificate[] =
    isolation.unresolvedIntervals.map(interval => ({
      lower: rationalText(interval.lower),
      upper: rationalText(interval.upper),
      distinctRootCount: interval.distinctRootCount,
      sturmVariations: variationCounts(sequence, interval.lower, interval.upper),
    }));
  const status = unresolvedIntervals.length === 0 ? "complete" : "partial";
  const certificate: ExactPolynomialRootCertificate = {
    version: 1,
    coefficients: coefficients.map(rationalText),
    status,
    totalDistinctRealRoots: isolation.totalDistinctRealRoots,
    roots,
    unresolvedIntervals,
  };
  const verification = verifyExactPolynomialRootCertificate(certificate);
  if (!verification.valid) {
    throw new Error(`Generated root certificate failed verification: ${verification.errors.join("; ")}`);
  }
  return { status, certificate };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRationalText(value: unknown): ExactRational | null {
  if (!isRecord(value) || typeof value.numerator !== "string" || typeof value.denominator !== "string") {
    return null;
  }
  if (!/^-?\d+$/.test(value.numerator) || !/^[1-9]\d*$/.test(value.denominator)) return null;
  const parsed = exactRational(BigInt(value.numerator), BigInt(value.denominator));
  if (parsed.numerator.toString() !== value.numerator || parsed.denominator.toString() !== value.denominator) {
    return null;
  }
  return parsed;
}

function readVariationCounts(value: unknown): ExactSturmVariations | null {
  if (!isRecord(value)) return null;
  const { atLower, atUpper } = value;
  if (!Number.isSafeInteger(atLower) || !Number.isSafeInteger(atUpper) ||
      (atLower as number) < 0 || (atUpper as number) < 0) {
    return null;
  }
  return { atLower: atLower as number, atUpper: atUpper as number };
}

function invalidCertificate(message: string): ExactRootCertificateVerificationResult {
  return { valid: false, errors: [message] };
}

/**
 * Verifies a serialized certificate using exact rational Sturm counts. The
 * verifier recomputes the Sturm sequence and multiplicity decomposition rather
 * than trusting the stored variation counts.
 */
export function verifyExactPolynomialRootCertificate(
  value: unknown,
): ExactRootCertificateVerificationResult {
  if (!isRecord(value) || value.version !== 1) {
    return invalidCertificate("Certificate must be an object with version 1.");
  }
  if (value.status !== "complete" && value.status !== "partial") {
    return invalidCertificate("Certificate status must be complete or partial.");
  }
  if (!Array.isArray(value.coefficients) || value.coefficients.length === 0) {
    return invalidCertificate("Certificate must include polynomial coefficients.");
  }

  const coefficients: ExactRational[] = [];
  for (const coefficient of value.coefficients) {
    const parsed = readRationalText(coefficient);
    if (!parsed) return invalidCertificate("Polynomial coefficients must be normalized exact rationals.");
    coefficients.push(parsed);
  }
  const polynomial = trimPoly(coefficients);
  if (polyIsZero(polynomial)) return invalidCertificate("The zero polynomial has no finite root certificate.");
  if (polynomial.length !== coefficients.length) {
    return invalidCertificate("Polynomial coefficients must not contain trailing zero coefficients.");
  }
  if (polyDegree(polynomial) > 64) {
    return invalidCertificate("Certificate polynomial degree exceeds the verification limit of 64.");
  }

  if (!Number.isSafeInteger(value.totalDistinctRealRoots) ||
      (value.totalDistinctRealRoots as number) < 0 ||
      (value.totalDistinctRealRoots as number) > polyDegree(polynomial)) {
    return invalidCertificate("Certificate has an invalid total distinct-root count.");
  }
  if (!Array.isArray(value.roots) || !Array.isArray(value.unresolvedIntervals)) {
    return invalidCertificate("Certificate roots and unresolvedIntervals must be arrays.");
  }

  const roots: {
    lower: Q;
    upper: Q;
    multiplicity: number;
    variations: ExactSturmVariations;
  }[] = [];
  for (const entry of value.roots) {
    if (!isRecord(entry)) return invalidCertificate("A certified root entry is malformed.");
    const lower = readRationalText(entry.lower);
    const upper = readRationalText(entry.upper);
    const variations = readVariationCounts(entry.sturmVariations);
    if (!lower || !upper || !variations || !Number.isSafeInteger(entry.multiplicity) ||
        (entry.multiplicity as number) < 1 || (entry.multiplicity as number) > polyDegree(polynomial)) {
      return invalidCertificate("A certified root entry has invalid bounds, variations, or multiplicity.");
    }
    roots.push({ lower, upper, variations, multiplicity: entry.multiplicity as number });
  }

  const unresolved: {
    lower: Q;
    upper: Q;
    distinctRootCount: number;
    variations: ExactSturmVariations;
  }[] = [];
  for (const entry of value.unresolvedIntervals) {
    if (!isRecord(entry)) return invalidCertificate("An unresolved interval entry is malformed.");
    const lower = readRationalText(entry.lower);
    const upper = readRationalText(entry.upper);
    const variations = readVariationCounts(entry.sturmVariations);
    if (!lower || !upper || !variations || !Number.isSafeInteger(entry.distinctRootCount) ||
        (entry.distinctRootCount as number) < 1 || (entry.distinctRootCount as number) > polyDegree(polynomial)) {
      return invalidCertificate("An unresolved interval has invalid bounds, variations, or root count.");
    }
    unresolved.push({ lower, upper, variations, distinctRootCount: entry.distinctRootCount as number });
  }

  try {
    const decomposition = squareFreeFactorization(polynomial);
    const sequence = sturmSequence(decomposition.squareFreePart);
    const bound = cauchyBound(decomposition.squareFreePart);
    const total = sturmCount(sequence, qNegate(bound), bound);
    if (total !== value.totalDistinctRealRoots) {
      return invalidCertificate("Certificate total does not match the exact global Sturm root count.");
    }
    const factorSequences = decomposition.factors.map(factor => ({
      factor,
      sturm: sturmSequence(factor.coefficients),
    }));

    const certifiedIntervals: { lower: Q; upper: Q; count: number }[] = [];
    for (const root of roots) {
      if (qCompare(root.lower, root.upper) >= 0 ||
          qIsZero(qEvaluate(decomposition.squareFreePart, root.lower)) ||
          qIsZero(qEvaluate(decomposition.squareFreePart, root.upper))) {
        return invalidCertificate("Certified root intervals must have ordered, non-root endpoints.");
      }
      const expected = variationCounts(sequence, root.lower, root.upper);
      if (expected.atLower !== root.variations.atLower || expected.atUpper !== root.variations.atUpper ||
          expected.atLower - expected.atUpper !== 1) {
        return invalidCertificate("A certified interval does not have exactly one distinct root by Sturm count.");
      }

      const matchingFactors = factorSequences.filter(({ factor, sturm: factorSturm }) =>
        sturmCount(factorSturm, root.lower, root.upper) === 1 &&
        factor.multiplicity === root.multiplicity,
      );
      if (matchingFactors.length !== 1) {
        return invalidCertificate("A certified root multiplicity does not match the exact square-free decomposition.");
      }
      certifiedIntervals.push({ lower: root.lower, upper: root.upper, count: 1 });
    }

    for (const interval of unresolved) {
      if (qCompare(interval.lower, interval.upper) >= 0 ||
          qIsZero(qEvaluate(decomposition.squareFreePart, interval.lower)) ||
          qIsZero(qEvaluate(decomposition.squareFreePart, interval.upper))) {
        return invalidCertificate("Unresolved intervals must have ordered, non-root endpoints.");
      }
      const expected = variationCounts(sequence, interval.lower, interval.upper);
      const count = expected.atLower - expected.atUpper;
      if (expected.atLower !== interval.variations.atLower ||
          expected.atUpper !== interval.variations.atUpper ||
          count !== interval.distinctRootCount) {
        return invalidCertificate("An unresolved interval's declared root count does not match its Sturm count.");
      }
      certifiedIntervals.push({ lower: interval.lower, upper: interval.upper, count });
    }

    certifiedIntervals.sort((a, b) => qCompare(a.lower, b.lower));
    for (let index = 1; index < certifiedIntervals.length; index++) {
      if (qCompare(certifiedIntervals[index - 1]!.upper, certifiedIntervals[index]!.lower) > 0) {
        return invalidCertificate("Certificate intervals overlap.");
      }
    }
    const representedCount = certifiedIntervals.reduce((sum, interval) => sum + interval.count, 0);
    if (representedCount !== total) {
      return invalidCertificate("Certified and unresolved intervals do not account for every real root.");
    }
    if (value.status === "complete" && unresolved.length > 0) {
      return invalidCertificate("A complete certificate cannot contain unresolved intervals.");
    }
    if (value.status === "partial" && unresolved.length === 0) {
      return invalidCertificate("A partial certificate must identify at least one unresolved interval.");
    }
  } catch (error) {
    return invalidCertificate(error instanceof Error
      ? `Certificate verification failed: ${error.message}`
      : "Certificate verification failed.");
  }

  return { valid: true, errors: [] };
}

