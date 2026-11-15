import { integer, isNumeric, numericMul, numericParts, type Expr, type NumericExpr } from "../core/expr.js";
import { polynomialFromExpr, polynomialMultiply, polynomialDivide, polynomialDegree, polynomialConstant, polynomialZero, isUnivariatePolynomial, type Polynomial, type PolynomialTerm } from "./polynomial.js";
import { simplifyRational } from "./rational.js";
import {
  exactRational,
  isolateRealRootsExactInInterval,
  type ExactRational,
  type ExactRootInterval,
  type ExactUnresolvedRootInterval,
} from "../numeric/sturm.js";

export type RationalSingularityKind = "removable" | "pole";
export type RationalDomainAnalysisStatus = "complete" | "partial" | "unsupported" | "undefined";

export interface RationalDomainAnalysisOptions {
  /** Exact positive width requested for each isolated singularity. Defaults to 10^-12. */
  readonly tolerance?: ExactRational;
  /** Maximum polynomial degree handled by exact Sturm isolation. Defaults to 24. */
  readonly maxDegree?: number;
  /** Maximum exact subdivision iterations per Sturm isolation. Defaults to 512. */
  readonly maxIterations?: number;
}

export interface RationalSingularity {
  /** Exact rational interval containing exactly one distinct singular point. */
  readonly interval: ExactRootInterval;
  /** A removable singularity is a hole; a pole remains in the reduced denominator. */
  readonly kind: RationalSingularityKind;
  /** For poles, the exact order of the zero in the reduced denominator. */
  readonly poleOrder?: number;
  /** Original non-zero conditions that vanish at this singularity. */
  readonly excludedFactors: readonly Expr[];
}

export interface RationalDomainAnalysisResult {
  readonly status: RationalDomainAnalysisStatus;
  readonly variable: string;
  readonly singularities: readonly RationalSingularity[];
  readonly unresolvedIntervals: readonly ExactUnresolvedRootInterval[];
  readonly restrictions: readonly Expr[];
  readonly simplifiedExpression?: Expr;
  readonly message?: string;
}

function isZeroPolynomial(poly: Polynomial): boolean {
  return poly.terms.size === 0;
}

function rationalAdd(a: ExactRational, b: ExactRational): ExactRational {
  return exactRational(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}

function rationalMultiply(a: ExactRational, b: ExactRational): ExactRational {
  return exactRational(a.numerator * b.numerator, a.denominator * b.denominator);
}

function coefficientsOf(poly: Polynomial, variable: string): ExactRational[] {
  if (!isUnivariatePolynomial(poly, variable)) {
    throw new TypeError(`Rational singularity analysis requires a polynomial in '${variable}' only.`);
  }
  const degree = polynomialDegree(poly, variable);
  if (degree < 0) return [exactRational(0n)];
  const result = Array.from({ length: degree + 1 }, () => exactRational(0n));
  for (const term of poly.terms.values()) {
    const exponent = term.monomial.powers.get(variable) ?? 0;
    const [numerator, denominator] = numericParts(term.coefficient);
    result[exponent] = exactRational(numerator, denominator);
  }
  return result;
}

function evaluatePolynomialAt(poly: Polynomial, variable: string, x: ExactRational): ExactRational {
  const coefficients = coefficientsOf(poly, variable);
  let value = exactRational(0n);
  for (let index = coefficients.length - 1; index >= 0; index--) {
    value = rationalAdd(rationalMultiply(value, x), coefficients[index]!);
  }
  return value;
}

function polynomialGcd(a: Polynomial, b: Polynomial): Polynomial {
  let left = a;
  let right = b;
  while (!isZeroPolynomial(right)) {
    const remainder = polynomialDivide(left, right).remainder;
    left = right;
    right = remainder;
  }
  return left;
}

function monomialKey(powers: ReadonlyMap<string, number>): string {
  return [...powers]
    .filter(([, exponent]) => exponent > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, exponent]) => `${name.length}:${name}^${exponent}`)
    .join("*") || "1";
}

function polynomialDerivative(poly: Polynomial, variable: string): Polynomial {
  const terms = new Map<string, PolynomialTerm>();
  for (const term of poly.terms.values()) {
    const exponent = term.monomial.powers.get(variable) ?? 0;
    if (exponent === 0) continue;
    const powers = new Map(term.monomial.powers);
    if (exponent === 1) powers.delete(variable);
    else powers.set(variable, exponent - 1);
    const coefficient = numericMul(term.coefficient, integer(exponent));
    if (!isNumeric(coefficient)) throw new TypeError("Expected an exact rational derivative coefficient.");
    terms.set(monomialKey(powers), { monomial: { powers }, coefficient: coefficient as NumericExpr });
  }
  return { kind: "Polynomial", terms };
}

function compareRational(a: ExactRational, b: ExactRational): number {
  const left = a.numerator * b.denominator;
  const right = b.numerator * a.denominator;
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Tests a root condition exactly. The candidate interval isolates one root of `union`;
 * any root of gcd(union, candidate) in that interval must therefore be the same root.
 */
function candidateRootIsShared(
  union: Polynomial,
  candidate: Polynomial,
  variable: string,
  interval: ExactRootInterval,
  tolerance: ExactRational,
  maxDegree: number,
  maxIterations: number,
): boolean {
  if (isZeroPolynomial(candidate)) return true;
  const common = polynomialGcd(union, candidate);
  if (polynomialDegree(common, variable) <= 0) return false;
  if (compareRational(interval.lower, interval.upper) === 0) {
    return evaluatePolynomialAt(common, variable, interval.lower).numerator === 0n;
  }
  const local = isolateRealRootsExactInInterval(
    coefficientsOf(common, variable),
    interval.lower,
    interval.upper,
    tolerance,
    maxDegree,
    maxIterations,
  );
  return local.totalDistinctRealRoots > 0;
}

function emptyResult(
  status: RationalDomainAnalysisStatus,
  variable: string,
  message: string,
  restrictions: readonly Expr[] = [],
): RationalDomainAnalysisResult {
  return { status, variable, singularities: [], unresolvedIntervals: [], restrictions, message };
}

/**
 * Analyzes real singularities of a univariate rational expression over a closed interval.
 * The excluded points are isolated by exact Sturm sequences. A point is classified as a
 * removable singularity when its original domain restriction vanishes but the reduced
 * denominator does not; otherwise it is a pole, with its exact pole order.
 *
 * Bounds and tolerance are exact rationals. Non-rational functions and multivariate
 * restrictions are reported as unsupported instead of being approximated silently.
 */
export function analyzeRationalSingularities(
  expression: Expr,
  variable: string,
  lower: ExactRational,
  upper: ExactRational,
  options: RationalDomainAnalysisOptions = {},
): RationalDomainAnalysisResult {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) {
    throw new TypeError(`Invalid variable name: ${variable}`);
  }
  const tolerance = options.tolerance ?? exactRational(1n, 1_000_000_000_000n);
  const maxDegree = options.maxDegree ?? 24;
  const maxIterations = options.maxIterations ?? 512;
  if (!Number.isSafeInteger(maxDegree) || maxDegree < 1 || maxDegree > 128) {
    throw new RangeError("maxDegree must be an integer in [1, 128].");
  }
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > 20_000) {
    throw new RangeError("maxIterations must be an integer in [1, 20000].");
  }
  if (tolerance.numerator <= 0n) throw new RangeError("tolerance must be positive.");
  if (compareRational(lower, upper) === 0) {
    throw new RangeError("The analysis interval must have positive width.");
  }

  let simplification: ReturnType<typeof simplifyRational>;
  try {
    simplification = simplifyRational(expression);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rational simplification failed.";
    const status: RationalDomainAnalysisStatus = /zero|undefined|divide by zero/i.test(message)
      ? "undefined"
      : "unsupported";
    return emptyResult(status, variable, message);
  }
  if (simplification.status === "undefined") {
    return emptyResult("undefined", variable, simplification.message ?? "The expression is undefined on its entire domain.", simplification.restrictions);
  }
  if (simplification.status === "unsupported" || !simplification.expression || !simplification.denominator) {
    return emptyResult("unsupported", variable, simplification.message ?? "The expression is not a supported rational expression.", simplification.restrictions);
  }

  try {
    let union = polynomialConstant(1);
    const restrictions: { expression: Expr; polynomial: Polynomial }[] = [];
    for (const restriction of simplification.restrictions) {
      const polynomial = polynomialFromExpr(restriction);
      if (!isUnivariatePolynomial(polynomial, variable)) {
        return emptyResult(
          "unsupported", variable,
          `Domain restriction '${restriction.kind === "Symbol" ? restriction.name : "expression"}' is not univariate in '${variable}'.`,
          simplification.restrictions,
        );
      }
      if (polynomialDegree(polynomial, variable) <= 0) continue;
      restrictions.push({ expression: restriction, polynomial });
      union = polynomialMultiply(union, polynomial);
    }

    const unionDegree = polynomialDegree(union, variable);
    if (unionDegree <= 0 || restrictions.length === 0) {
      return {
        status: simplification.status === "partial" ? "partial" : "complete",
        variable,
        singularities: [],
        unresolvedIntervals: [],
        restrictions: simplification.restrictions,
        simplifiedExpression: simplification.expression,
        ...(simplification.status === "partial" ? { message: simplification.message } : {}),
      };
    }
    if (unionDegree > maxDegree) {
      return emptyResult(
        "partial", variable,
        `The combined domain-restriction polynomial has degree ${unionDegree}, above the configured maximum ${maxDegree}.`,
        simplification.restrictions,
      );
    }

    const isolation = isolateRealRootsExactInInterval(
      coefficientsOf(union, variable), lower, upper, tolerance, maxDegree, maxIterations,
    );
    const reducedDenominator = polynomialFromExpr(simplification.denominator);
    if (!isUnivariatePolynomial(reducedDenominator, variable)) {
      return emptyResult("unsupported", variable, "The reduced denominator is not univariate.", simplification.restrictions);
    }

    const singularities: RationalSingularity[] = [];
    for (const interval of isolation.roots) {
      const excludedFactors = restrictions
        .filter(item => candidateRootIsShared(union, item.polynomial, variable, interval, tolerance, maxDegree, maxIterations))
        .map(item => item.expression);
      const firstDerivativeCheck = candidateRootIsShared(
        union, reducedDenominator, variable, interval, tolerance, maxDegree, maxIterations,
      );

      let poleOrder = 0;
      if (firstDerivativeCheck) {
        let derivative = reducedDenominator;
        const denominatorDegree = polynomialDegree(reducedDenominator, variable);
        for (let order = 0; order <= denominatorDegree; order++) {
          if (!candidateRootIsShared(union, derivative, variable, interval, tolerance, maxDegree, maxIterations)) break;
          poleOrder++;
          derivative = polynomialDerivative(derivative, variable);
          if (isZeroPolynomial(derivative)) break;
        }
      }

      singularities.push({
        interval,
        kind: poleOrder > 0 ? "pole" : "removable",
        ...(poleOrder > 0 ? { poleOrder } : {}),
        excludedFactors,
      });
    }

    const status: RationalDomainAnalysisStatus =
      isolation.status === "partial" || simplification.status === "partial" ? "partial" : "complete";
    return {
      status,
      variable,
      singularities,
      unresolvedIntervals: isolation.unresolvedIntervals,
      restrictions: simplification.restrictions,
      simplifiedExpression: simplification.expression,
      ...(status === "partial"
        ? { message: isolation.status === "partial"
          ? "Some singularity intervals remain unresolved by exact Sturm isolation."
          : simplification.message ?? "Rational simplification was partial." }
        : {}),
    };
  } catch (error) {
    return emptyResult(
      "unsupported", variable,
      error instanceof Error ? error.message : "Rational singularity analysis failed.",
      simplification.restrictions,
    );
  }
}
