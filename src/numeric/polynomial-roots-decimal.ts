/**
 * High-precision real polynomial roots with exact Sturm certification.
 *
 * The AST contains exact rational coefficients. Root counting, square-free
 * factorization and multiplicity calculation use BigInt rational arithmetic;
 * decimal arithmetic is only used for the displayed approximation and residual.
 */
import { numericParts, type Expr } from "../core/expr.js";
import {
  isUnivariatePolynomial,
  polynomialDegree,
  polynomialFromExpr,
  type Polynomial,
} from "../algebra/polynomial.js";
import {
  decimal,
  decimalAbs,
  decimalAdd,
  decimalCompare,
  decimalDivide,
  decimalMultiply,
  decimalPowerOfTen,
  decimalRound,
  decimalToString,
  type BigDecimal,
  type DecimalContext,
  type DecimalInput,
  type DecimalRoundingMode,
} from "./decimal.js";
import {
  exactRational,
  exactRationalFromDecimalParts,
  exactRationalToString,
  isolateRealRootsExact,
  type ExactRational,
} from "./sturm.js";

export type DecimalPolynomialRootMethod = "sturm-isolation" | "linear" | "critical-point" | "bisection";
export type DecimalPolynomialRootStatus = "finite" | "partial" | "none" | "all" | "unsupported";

export interface DecimalPolynomialRoot {
  /** Arbitrary-precision decimal approximation to the root. */
  readonly value: BigDecimal;
  readonly valueText: string;
  /** Exact algebraic multiplicity, obtained by square-free factorization over Q. */
  readonly multiplicity: number;
  /** True when an exact Sturm count proves the interval contains this distinct root. */
  readonly certified: boolean;
  /** Exact rational bounds enclosing this root and no other distinct real root. */
  readonly isolationInterval: { readonly lowerExact: string; readonly upperExact: string };
  /** Residual is an approximate diagnostic, not the certificate of existence. */
  readonly residual: BigDecimal;
  readonly residualText: string;
  readonly relativeResidual: BigDecimal;
  readonly relativeResidualText: string;
  readonly method: DecimalPolynomialRootMethod;
  /** True only if the certified interval meets the requested root-location tolerance. */
  readonly converged: boolean;
  readonly iterations: number;
}

export interface DecimalPolynomialRootsResult {
  readonly variable: string;
  readonly degree: number;
  readonly precision: number;
  readonly roots: readonly DecimalPolynomialRoot[];
  readonly status: DecimalPolynomialRootStatus;
  readonly message?: string;
  /** Exact count of distinct real roots, including roots in unresolved intervals; "infinite" for the zero polynomial. */
  readonly totalDistinctRealRoots?: number | "infinite";
  /** Intervals that still contain multiple roots because maxIterations was reached. */
  readonly unresolvedIntervals?: readonly {
    readonly lowerExact: string;
    readonly upperExact: string;
    readonly distinctRootCount: number;
  }[];
}

export interface DecimalPolynomialRootsOptions {
  /** Significant decimal digits. Defaults to 50. Supported range: 2..1000. */
  readonly precision?: number;
  /** Rounding used for decimal approximations and residual diagnostics. Defaults to half-even. */
  readonly rounding?: DecimalRoundingMode;
  /** Root-location tolerance; string values are parsed without Number conversion. */
  readonly tolerance?: DecimalInput;
  /** Maximum interval subdivisions; defaults to max(200, 4*precision). */
  readonly maxIterations?: number;
  /** Maximum polynomial degree accepted by exact isolation; defaults to 24, configurable up to 64. */
  readonly maxDegree?: number;
}

interface ResidualInfo {
  readonly absolute: BigDecimal;
  readonly relative: BigDecimal;
}

function unsupported(variable: string, degree: number, precision: number, message: string): DecimalPolynomialRootsResult {
  return { variable, degree, precision, roots: [], status: "unsupported", message };
}

function validatePrecision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 2 || value > 1000) {
    throw new RangeError("High-precision root solving requires precision between 2 and 1000 significant digits.");
  }
}

function validateOptions(precision: number, tolerance: BigDecimal, maxIterations: number, maxDegree: number): void {
  validatePrecision(precision);
  if (tolerance.coefficient <= 0n) throw new RangeError("Tolerance must be positive.");
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > 20_000) {
    throw new RangeError("maxIterations must be an integer in [1, 20000].");
  }
  if (!Number.isSafeInteger(maxDegree) || maxDegree < 1 || maxDegree > 64) {
    throw new RangeError("maxDegree must be an integer in [1, 64].");
  }
}

function exactCoefficientsFromPolynomial(
  polynomial: Polynomial,
  variable: string,
  degree: number,
): ExactRational[] {
  const coefficients = Array.from({ length: degree + 1 }, () => exactRational(0n));
  for (const term of polynomial.terms.values()) {
    const exponent = term.monomial.powers.get(variable) ?? 0;
    const [numerator, denominator] = numericParts(term.coefficient);
    coefficients[exponent] = exactRational(numerator, denominator);
  }
  while (coefficients.length > 1 && coefficients[coefficients.length - 1]!.numerator === 0n) {
    coefficients.pop();
  }
  return coefficients;
}

function decimalCoefficientsFromPolynomial(
  polynomial: Polynomial,
  variable: string,
  degree: number,
  context: DecimalContext,
): BigDecimal[] {
  const coefficients = Array.from({ length: degree + 1 }, () => decimal(0n));
  for (const term of polynomial.terms.values()) {
    const exponent = term.monomial.powers.get(variable) ?? 0;
    const [numerator, denominator] = numericParts(term.coefficient);
    coefficients[exponent] = decimalDivide(decimal(numerator), decimal(denominator), context);
  }
  while (coefficients.length > 1 && coefficients[coefficients.length - 1]!.coefficient === 0n) {
    coefficients.pop();
  }
  return coefficients;
}

function exactRationalToDecimal(value: ExactRational, context: DecimalContext): BigDecimal {
  return decimalDivide(decimal(value.numerator), decimal(value.denominator), context);
}

function exactRationalMidpoint(
  lower: ExactRational,
  upper: ExactRational,
  context: DecimalContext,
): BigDecimal {
  return decimalDivide(
    decimalAdd(exactRationalToDecimal(lower, context), exactRationalToDecimal(upper, context), context),
    decimal(2n),
    context,
  );
}

function magnitudeAt(coefficients: readonly BigDecimal[], x: BigDecimal, context: DecimalContext): BigDecimal {
  const absoluteX = decimalAbs(x);
  // Normalize around the unit scale so residual diagnostics remain meaningful
  // near zero (for P(x)=x, |P(x)|/sum(|a_i||x|^i) is 1 at every nonzero x).
  const absX = decimalCompare(absoluteX, decimal(1n)) < 0 ? decimal(1n) : absoluteX;
  let result = decimalAbs(coefficients[coefficients.length - 1] ?? decimal(0n));
  for (let index = coefficients.length - 2; index >= 0; index--) {
    result = decimalAdd(decimalMultiply(result, absX, context), decimalAbs(coefficients[index]!), context);
  }
  return result;
}

function residualInfo(coefficients: readonly BigDecimal[], x: BigDecimal, context: DecimalContext): ResidualInfo {
  let value = coefficients[coefficients.length - 1] ?? decimal(0n);
  for (let index = coefficients.length - 2; index >= 0; index--) {
    value = decimalAdd(decimalMultiply(value, x, context), coefficients[index]!, context);
  }
  const absolute = decimalAbs(value);
  const magnitude = magnitudeAt(coefficients, x, context);
  const relative = magnitude.coefficient === 0n
    ? absolute
    : decimalDivide(absolute, magnitude, context);
  return { absolute, relative };
}

/**
 * Isolates all distinct real roots of a univariate polynomial with exact rational
 * coefficients. Sturm's theorem certifies the count in every returned rational
 * interval. Square-free factorization gives exact multiplicities. The returned
 * decimal is only an approximation; use isolationInterval for the certificate.
 */
export function solvePolynomialNumericallyDecimal(
  expression: Expr,
  variable: string,
  options: DecimalPolynomialRootsOptions = {},
): DecimalPolynomialRootsResult {
  const precision = options.precision ?? 50;
  validatePrecision(precision);
  const rounding = options.rounding ?? "half-even";
  const context: DecimalContext = { precision: Math.min(1000, precision + 12), rounding };
  // Require enough bisections to deliver approximately all requested significant digits.
  const tolerance = options.tolerance === undefined
    ? decimalPowerOfTen(-(precision + 2))
    : decimal(options.tolerance);
  const maxIterations = options.maxIterations ?? Math.max(200, precision * 4);
  const maxDegree = options.maxDegree ?? 24;
  validateOptions(precision, tolerance, maxIterations, maxDegree);

  let polynomial: Polynomial;
  try {
    polynomial = polynomialFromExpr(expression);
  } catch (error) {
    return unsupported(variable, -1, precision, error instanceof Error ? error.message : "Expression is not a polynomial.");
  }
  if (!isUnivariatePolynomial(polynomial, variable)) {
    return unsupported(variable, polynomialDegree(polynomial, variable), precision, "Only univariate polynomials with exact rational coefficients are supported.");
  }

  const degree = polynomialDegree(polynomial, variable);
  if (degree < 0) {
    return {
      variable, degree, precision, roots: [], status: "all", totalDistinctRealRoots: "infinite",
      unresolvedIntervals: [],
      message: "The zero polynomial vanishes for every real number; every real value is a root.",
    };
  }
  if (degree === 0) {
    return {
      variable, degree, precision, roots: [], status: "none", totalDistinctRealRoots: 0,
      unresolvedIntervals: [], message: "A nonzero constant polynomial has no roots.",
    };
  }
  if (degree > maxDegree) {
    return unsupported(variable, degree, precision, `Polynomial degree ${degree} exceeds the configured maximum of ${maxDegree}.`);
  }

  try {
    const exactCoefficients = exactCoefficientsFromPolynomial(polynomial, variable, degree);
    const exactTolerance = exactRationalFromDecimalParts(tolerance.coefficient, tolerance.scale);
    const isolation = isolateRealRootsExact(exactCoefficients, exactTolerance, maxDegree, maxIterations);
    const decimalCoefficients = decimalCoefficientsFromPolynomial(polynomial, variable, degree, context);
    const roots: DecimalPolynomialRoot[] = isolation.roots.map(isolated => {
      const midpoint = exactRationalMidpoint(isolated.lower, isolated.upper, context);
      const diagnostic = residualInfo(decimalCoefficients, midpoint, context);
      const value = decimalRound(midpoint, precision, rounding);
      const residual = decimalRound(diagnostic.absolute, precision, rounding);
      const relativeResidual = decimalRound(diagnostic.relative, precision, rounding);
      return {
        value,
        valueText: decimalToString(value),
        multiplicity: isolated.multiplicity,
        certified: true,
        isolationInterval: {
          lowerExact: exactRationalToString(isolated.lower),
          upperExact: exactRationalToString(isolated.upper),
        },
        residual,
        residualText: decimalToString(residual),
        relativeResidual,
        relativeResidualText: decimalToString(relativeResidual),
        method: "sturm-isolation",
        converged: isolated.converged,
        iterations: isolated.iterations,
      };
    });
    const unresolvedIntervals = isolation.unresolvedIntervals.map(interval => ({
      lowerExact: exactRationalToString(interval.lower),
      upperExact: exactRationalToString(interval.upper),
      distinctRootCount: interval.distinctRootCount,
    }));
    const partial = isolation.status === "partial" || roots.some(root => !root.converged);
    return {
      variable,
      degree,
      precision,
      roots,
      status: partial ? "partial" : roots.length > 0 ? "finite" : "none",
      totalDistinctRealRoots: isolation.totalDistinctRealRoots,
      unresolvedIntervals,
      message: partial
        ? `Exact Sturm counts prove ${isolation.totalDistinctRealRoots} distinct real root(s) exist, but maxIterations prevented narrowing every interval to the requested tolerance. Each listed root still has a certified rational interval.`
        : roots.length === 0
          ? "Sturm's theorem certifies that the polynomial has no real roots."
          : `Sturm's theorem certifies all ${roots.length} distinct real root(s); exact square-free factorization certifies their multiplicities. Decimal approximations are accompanied by exact rational isolating intervals.`,
    };
  } catch (error) {
    return unsupported(variable, degree, precision, error instanceof Error ? error.message : "Exact Sturm root isolation failed.");
  }
}
