/**
 * Continuity and discontinuity analysis for supported real expressions.
 * The routine combines exact rational domain partitions with one-sided symbolic limits.
 */
import {
  add,
  integer,
  isNumeric,
  isZero,
  mul,
  numericParts,
  rational,
  type Expr,
} from "../core/expr.js";
import { simplify } from "../algebra/simplify.js";
import { polynomialDegree, polynomialFromExpr, isUnivariatePolynomial, type Polynomial } from "../algebra/polynomial.js";
import { substitute } from "../algebra/substitute.js";
import {
  analyzeRealDomain,
  type RealDomainAnalysisOptions,
  type RealDomainAnalysisResult,
  type RealDomainRestriction,
  type RealDomainCondition,
} from "../algebra/real-domain.js";
import { exactRational, type ExactRational } from "../numeric/sturm.js";
import { limit, normalizeNegativeRadicalPowers, type LimitResult } from "./limit.js";

export type ContinuityAnalysisStatus = "complete" | "partial" | "unsupported";
export type ContinuityClassification =
  | "continuous"
  | "removable-discontinuity"
  | "jump-discontinuity"
  | "infinite-discontinuity"
  | "oscillatory-discontinuity"
  | "undefined-at-point"
  | "undetermined";
export type PointDomainStatus = "defined" | "undefined" | "unknown";
export type SideDomainStatus = "available" | "excluded" | "uncertain";

export interface ContinuityAnalysisOptions extends RealDomainAnalysisOptions {
  /** Rational radius of the neighborhood used for exact domain partitioning. Defaults to 1. */
  readonly neighborhoodRadius?: ExactRational;
}

export interface ContinuityAnalysisResult {
  readonly status: ContinuityAnalysisStatus;
  readonly classification: ContinuityClassification;
  readonly variable: string;
  readonly point: Expr;
  readonly pointDomain: PointDomainStatus;
  readonly leftDomain: SideDomainStatus;
  readonly rightDomain: SideDomainStatus;
  readonly leftLimit: LimitResult;
  readonly rightLimit: LimitResult;
  /** Exact/symbolic function value, present only when pointDomain is certified defined. */
  readonly pointValue?: Expr;
  /** Common finite one-sided limit, present when all domain-admissible sides agree finitely. */
  readonly commonLimit?: Expr;
  readonly domainAnalysis?: RealDomainAnalysisResult;
  readonly message?: string;
}

const ZERO = exactRational(0n);
const ONE = exactRational(1n);

function compareRational(a: ExactRational, b: ExactRational): number {
  const left = a.numerator * b.denominator;
  const right = b.numerator * a.denominator;
  return left < right ? -1 : left > right ? 1 : 0;
}

function addRational(a: ExactRational, b: ExactRational): ExactRational {
  return exactRational(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}

function subtractRational(a: ExactRational, b: ExactRational): ExactRational {
  return exactRational(
    a.numerator * b.denominator - b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}

function pointAsRational(point: Expr): ExactRational | null {
  const normalized = simplify(point);
  if (!isNumeric(normalized)) return null;
  const [numerator, denominator] = numericParts(normalized);
  return exactRational(numerator, denominator);
}

function multiplyRational(a: ExactRational, b: ExactRational): ExactRational {
  return exactRational(a.numerator * b.numerator, a.denominator * b.denominator);
}

function powerRational(base: ExactRational, exponent: number): ExactRational {
  let result = ONE;
  let factor = base;
  let n = exponent;
  while (n > 0) {
    if (n % 2 === 1) result = multiplyRational(result, factor);
    n = Math.floor(n / 2);
    if (n > 0) factor = multiplyRational(factor, factor);
  }
  return result;
}

function binomial(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  let result = 1n;
  for (let i = 1; i <= Math.min(k, n - k); i++) result = result * BigInt(n - i + 1) / BigInt(i);
  return result;
}

function univariateCoefficients(source: Expr, variable: string): ExactRational[] | null {
  let polynomial: Polynomial;
  try {
    polynomial = polynomialFromExpr(source);
  } catch {
    return null;
  }
  if (!isUnivariatePolynomial(polynomial, variable)) return null;
  const degree = polynomialDegree(polynomial, variable);
  const coefficients = Array.from({ length: Math.max(1, degree + 1) }, () => ZERO);
  for (const term of polynomial.terms.values()) {
    for (const name of term.monomial.powers.keys()) if (name !== variable) return null;
    const exponent = term.monomial.powers.get(variable) ?? 0;
    const [n, d] = numericParts(term.coefficient);
    coefficients[exponent] = addRational(coefficients[exponent]!, exactRational(n, d));
  }
  return coefficients;
}

function signRational(value: ExactRational): -1 | 0 | 1 {
  return value.numerator < 0n ? -1 : value.numerator > 0n ? 1 : 0;
}

function evaluatePolynomialAt(coefficients: readonly ExactRational[], point: ExactRational): ExactRational {
  let value = ZERO;
  for (let i = coefficients.length - 1; i >= 0; i--) {
    value = addRational(multiplyRational(value, point), coefficients[i]!);
  }
  return value;
}

/** Exact sign immediately to one side, found from the first nonzero Taylor coefficient. */
function signImmediately(
  coefficients: readonly ExactRational[],
  point: ExactRational,
  side: "left" | "right",
): -1 | 0 | 1 {
  for (let order = 0; order < coefficients.length; order++) {
    let taylor = ZERO;
    for (let degree = order; degree < coefficients.length; degree++) {
      const term = multiplyRational(
        multiplyRational(coefficients[degree]!, exactRational(binomial(degree, order))),
        powerRational(point, degree - order),
      );
      taylor = addRational(taylor, term);
    }
    const sign = signRational(taylor);
    if (sign !== 0) return side === "left" && order % 2 === 1 ? sign === 1 ? -1 : 1 : sign;
  }
  return 0;
}

function conditionSatisfied(condition: RealDomainCondition, sign: -1 | 0 | 1): boolean {
  switch (condition) {
    case "nonzero": return sign !== 0;
    case "nonnegative": return sign >= 0;
    case "positive": return sign > 0;
    case "avoid-tan-poles": return true;
  }
}

/**
 * For an affine or polynomial rational argument at a rational point, tan is defined:
 * its argument is rational, while every real pole is an odd rational multiple of pi/2.
 * Non-polynomial arguments are left unknown rather than guessed.
 */
function tangentLocallyDefined(restriction: RealDomainRestriction, variable: string, point: ExactRational): boolean | null {
  if (restriction.status === "unsupported" && !univariateCoefficients(restriction.source, variable)) return null;
  const coefficients = univariateCoefficients(restriction.source, variable);
  if (!coefficients) return null;
  // Exact-rational polynomial inputs evaluate to a rational argument at rational points.
  // Since pi is irrational, that argument cannot equal a tangent pole.
  const value = evaluatePolynomialAt(coefficients, point);
  void value;
  return true;
}

function restrictionAtPoint(
  restriction: RealDomainRestriction,
  variable: string,
  point: ExactRational,
): boolean | null {
  if (restriction.condition === "avoid-tan-poles") return tangentLocallyDefined(restriction, variable, point);
  const coefficients = univariateCoefficients(restriction.source, variable);
  if (!coefficients) return null;
  return conditionSatisfied(restriction.condition, signRational(evaluatePolynomialAt(coefficients, point)));
}

function restrictionOnSide(
  restriction: RealDomainRestriction,
  variable: string,
  point: ExactRational,
  side: "left" | "right",
): boolean | null {
  if (restriction.condition === "avoid-tan-poles") return tangentLocallyDefined(restriction, variable, point);
  const coefficients = univariateCoefficients(restriction.source, variable);
  if (!coefficients) return null;
  return conditionSatisfied(restriction.condition, signImmediately(coefficients, point, side));
}

function combineRestrictions(
  restrictions: readonly RealDomainRestriction[],
  variable: string,
  point: ExactRational,
  side?: "left" | "right",
): "included" | "excluded" | "unknown" {
  let unknown = false;
  for (const restriction of restrictions) {
    const satisfied = side
      ? restrictionOnSide(restriction, variable, point, side)
      : restrictionAtPoint(restriction, variable, point);
    if (satisfied === false) return "excluded";
    if (satisfied === null) unknown = true;
  }
  return unknown ? "unknown" : "included";
}

function pointDomainStatus(
  restrictions: readonly RealDomainRestriction[],
  variable: string,
  point: ExactRational,
): PointDomainStatus {
  const state = combineRestrictions(restrictions, variable, point);
  return state === "included" ? "defined" : state === "excluded" ? "undefined" : "unknown";
}

function sideDomainStatus(
  restrictions: readonly RealDomainRestriction[],
  variable: string,
  point: ExactRational,
  side: "left" | "right",
): SideDomainStatus {
  const state = combineRestrictions(restrictions, variable, point, side);
  return state === "included" ? "available" : state === "excluded" ? "excluded" : "uncertain";
}

function integerSquareRoot(value: bigint): bigint {
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + value / x) >> 1n;
  }
  return x;
}

function normalizePointValue(expression: Expr): Expr {
  switch (expression.kind) {
    case "Integer":
    case "Rational":
    case "Symbol":
      return expression;
    case "Add":
      return simplify(add(...expression.terms.map(normalizePointValue)));
    case "Mul":
      return simplify(mul(...expression.factors.map(normalizePointValue)));
    case "Pow":
      return simplify({
        kind: "Pow",
        base: normalizePointValue(expression.base),
        exponent: normalizePointValue(expression.exponent),
      });
    case "Function": {
      const args = expression.args.map(normalizePointValue);
      const argument = args[0];
      if (args.length === 1 && argument && isNumeric(argument)) {
        if (argument.kind === "Integer" && argument.value === 0n) {
          if (["sin", "tan", "atan", "abs"].includes(expression.name)) return integer(0);
          if (expression.name === "cos" || expression.name === "exp") return integer(1);
        }
        if ((expression.name === "ln" || expression.name === "log") && argument.kind === "Integer" && argument.value === 1n) return integer(0);
        if (expression.name === "abs") {
          const [n, d] = numericParts(argument);
          return n < 0n ? rational(-n, d) : argument;
        }
        if (expression.name === "sign") {
          const [n] = numericParts(argument);
          return integer(n < 0n ? -1 : n > 0n ? 1 : 0);
        }
        if (expression.name === "sqrt") {
          const [n, d] = numericParts(argument);
          if (n >= 0n) {
            const nr = integerSquareRoot(n);
            const dr = integerSquareRoot(d);
            if (nr * nr === n && dr * dr === d) return rational(nr, dr);
          }
        }
      }
      return simplify({ kind: "Function", name: expression.name, args });
    }
  }
}

function sameExpressionValue(a: Expr, b: Expr): boolean {
  const left = simplify(normalizePointValue(a));
  const right = simplify(normalizePointValue(b));
  if (JSON.stringify(left, bigintReplacer) === JSON.stringify(right, bigintReplacer)) return true;
  return isZero(simplify(add(left, mul(integer(-1), right))));
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function allFiniteAndEqual(results: readonly LimitResult[]): { equal: boolean; value?: Expr } {
  if (results.length === 0 || results.some(result => result.status !== "finite" || !result.value)) return { equal: false };
  const value = results[0]!.value!;
  return {
    equal: results.every(result => sameExpressionValue(result.value!, value)),
    value,
  };
}

/**
 * Analyze continuity at an exact rational point. The function combines the certified
 * domain partition with left and right symbolic limits. Non-rational points or domain
 * cells that cannot be certified return `unsupported`/`partial` rather than guessing.
 */
export function analyzeContinuity(
  expression: Expr,
  variable: string,
  pointInput: Expr,
  options: ContinuityAnalysisOptions = {},
): ContinuityAnalysisResult {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) throw new TypeError(`Invalid variable name: ${variable}`);
  const normalizedPoint = simplify(pointInput);
  const point = pointAsRational(normalizedPoint);
  const radius = options.neighborhoodRadius ?? ONE;
  if (radius.numerator <= 0n) throw new RangeError("neighborhoodRadius must be positive.");
  if (!point) {
    const unsupportedLimit: LimitResult = {
      status: "unsupported",
      method: "direct-substitution",
      lHopitalSteps: 0,
      message: "Continuity analysis currently requires an exact rational point.",
    };
    return {
      status: "unsupported",
      classification: "undetermined",
      variable,
      point: normalizedPoint,
      pointDomain: "unknown",
      leftDomain: "uncertain",
      rightDomain: "uncertain",
      leftLimit: unsupportedLimit,
      rightLimit: unsupportedLimit,
      message: "Continuity analysis currently requires an exact rational point. For symbolic or irrational points, use limit() directly.",
    };
  }

  const lower = subtractRational(point, radius);
  const upper = addRational(point, radius);
  const normalizedExpression = simplify(normalizeNegativeRadicalPowers(simplify(expression)));
  const { neighborhoodRadius: _neighborhoodRadius, ...domainOptions } = options;
  const domainAnalysis = analyzeRealDomain(normalizedExpression, variable, lower, upper, domainOptions);
  // Use exact polynomial sign/Taylor analysis at the rational point itself. The global
  // domain partition intentionally keeps nonzero-width root enclosures uncertain; those
  // enclosures must not hide an exactly evaluable rational point from continuity analysis.
  const pointDomain = pointDomainStatus(domainAnalysis.restrictions, variable, point);
  const leftDomain = sideDomainStatus(domainAnalysis.restrictions, variable, point, "left");
  const rightDomain = sideDomainStatus(domainAnalysis.restrictions, variable, point, "right");
  const leftLimit = limit(normalizedExpression, variable, normalizedPoint, "left");
  const rightLimit = limit(normalizedExpression, variable, normalizedPoint, "right");
  const pointValue = pointDomain === "defined"
    ? normalizePointValue(substitute(normalizedExpression, { [variable]: normalizedPoint }))
    : undefined;

  const admissibleLimits = [
    ...(leftDomain === "available" ? [leftLimit] : []),
    ...(rightDomain === "available" ? [rightLimit] : []),
  ];

  if (pointDomain === "unknown" || leftDomain === "uncertain" || rightDomain === "uncertain") {
    return {
      status: domainAnalysis.status === "unsupported" ? "unsupported" : "partial",
      classification: "undetermined",
      variable,
      point: normalizedPoint,
      pointDomain,
      leftDomain,
      rightDomain,
      leftLimit,
      rightLimit,
      ...(pointValue ? { pointValue } : {}),
      domainAnalysis,
      message: "The domain partition does not certify point membership or one-sided domain availability near the requested point.",
    };
  }

  if (admissibleLimits.some(result => result.status === "unsupported")) {
    return {
      status: "unsupported",
      classification: "undetermined",
      variable,
      point: normalizedPoint,
      pointDomain,
      leftDomain,
      rightDomain,
      leftLimit,
      rightLimit,
      ...(pointValue ? { pointValue } : {}),
      domainAnalysis,
      message: admissibleLimits.find(result => result.status === "unsupported")?.message ?? "A one-sided limit is unsupported.",
    };
  }

  if (admissibleLimits.length === 0) {
    const classification: ContinuityClassification = pointDomain === "defined" ? "continuous" : "undefined-at-point";
    return {
      status: "complete",
      classification,
      variable,
      point: normalizedPoint,
      pointDomain,
      leftDomain,
      rightDomain,
      leftLimit,
      rightLimit,
      ...(pointValue ? { pointValue } : {}),
      domainAnalysis,
      message: pointDomain === "defined"
        ? "The point is isolated in the real domain, so continuity relative to the domain holds vacuously."
        : "The expression is not defined at the point and has no domain-admissible side nearby.",
    };
  }

  if (admissibleLimits.some(result => result.status === "positive-infinity" || result.status === "negative-infinity")) {
    return {
      status: "complete",
      classification: "infinite-discontinuity",
      variable,
      point: normalizedPoint,
      pointDomain,
      leftDomain,
      rightDomain,
      leftLimit,
      rightLimit,
      ...(pointValue ? { pointValue } : {}),
      domainAnalysis,
      message: "At least one domain-admissible one-sided limit is infinite.",
    };
  }

  const finiteComparison = allFiniteAndEqual(admissibleLimits);
  if (finiteComparison.equal && finiteComparison.value) {
    const commonLimit = finiteComparison.value;
    const isContinuous = pointDomain === "defined" && pointValue !== undefined && sameExpressionValue(pointValue, commonLimit);
    const classification: ContinuityClassification = isContinuous ? "continuous" : "removable-discontinuity";
    return {
      status: "complete",
      classification,
      variable,
      point: normalizedPoint,
      pointDomain,
      leftDomain,
      rightDomain,
      leftLimit,
      rightLimit,
      ...(pointValue ? { pointValue } : {}),
      commonLimit,
      domainAnalysis,
      message: isContinuous
        ? "The function is defined at the point and agrees with every domain-admissible one-sided limit."
        : "The domain-admissible one-sided limits agree finitely, but the point value is absent or different.",
    };
  }

  const finiteLimits = admissibleLimits.filter(result => result.status === "finite" && result.value);
  if (admissibleLimits.length >= 2 && finiteLimits.length === admissibleLimits.length) {
    return {
      status: "complete",
      classification: "jump-discontinuity",
      variable,
      point: normalizedPoint,
      pointDomain,
      leftDomain,
      rightDomain,
      leftLimit,
      rightLimit,
      ...(pointValue ? { pointValue } : {}),
      domainAnalysis,
      message: "The domain-admissible one-sided limits are finite but unequal.",
    };
  }

  if (admissibleLimits.some(result => result.status === "does-not-exist")) {
    return {
      status: "complete",
      classification: "oscillatory-discontinuity",
      variable,
      point: normalizedPoint,
      pointDomain,
      leftDomain,
      rightDomain,
      leftLimit,
      rightLimit,
      ...(pointValue ? { pointValue } : {}),
      domainAnalysis,
      message: "At least one domain-admissible one-sided limit does not exist as a finite or infinite limit.",
    };
  }

  return {
    status: "partial",
    classification: "undetermined",
    variable,
    point: normalizedPoint,
    pointDomain,
    leftDomain,
    rightDomain,
    leftLimit,
    rightLimit,
    ...(pointValue ? { pointValue } : {}),
    domainAnalysis,
    message: "The available one-sided limit results do not determine a supported continuity classification.",
  };
}
