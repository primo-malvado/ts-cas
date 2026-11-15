import { add, isNumeric, negate, numericParts, structuralKey, type Expr } from "../core/expr.js";
import { solve } from "../algebra/solve.js";
import { isUnivariatePolynomial, polynomialCoefficient, polynomialDegree, polynomialFromExpr, polynomialToExpr } from "../algebra/polynomial.js";
import { evaluate } from "../numeric/evaluate.js";

export type InequalityRelation = "<" | "<=" | ">" | ">=" | "=" | "!=";
export type InequalityStatus = "complete" | "partial" | "unsupported";

export interface InequalityInterval {
  /** Exact symbolic endpoints where available; null denotes -/+ infinity. */
  readonly lower: Expr | null;
  readonly upper: Expr | null;
  readonly lowerApproximation: number | null;
  readonly upperApproximation: number | null;
  readonly lowerClosed: boolean;
  readonly upperClosed: boolean;
}

export interface PolynomialInequalityResult {
  readonly status: InequalityStatus;
  readonly variable: string;
  readonly relation: InequalityRelation;
  readonly intervals: readonly InequalityInterval[];
  readonly realRoots: readonly Expr[];
  readonly message?: string;
}

interface Root { readonly expr: Expr; readonly value: number; }
interface Cell {
  readonly lowerRoot: Root | null;
  readonly upperRoot: Root | null;
  readonly lowerClosed: boolean;
  readonly upperClosed: boolean;
  readonly segmentIndex: number;
  readonly isRootPoint: boolean;
}

/**
 * Solve a univariate polynomial inequality with exact rational coefficients and degree <= 2.
 * The endpoints are kept as exact Expr values (for example, (1+sqrt(5))/2); floating-point
 * values are used only to order the at-most-two roots and select a test point in each interval.
 * Non-polynomial, multivariate, and higher-degree cases are reported unsupported, not guessed.
 */
export function solvePolynomialInequality(
  expression: Expr,
  variable: string,
  relation: InequalityRelation,
): PolynomialInequalityResult {
  let polynomial;
  try {
    polynomial = polynomialFromExpr(expression);
  } catch (error) {
    return result("unsupported", [], [], error instanceof Error ? error.message : "Expression is not polynomial.");
  }

  if (!isUnivariatePolynomial(polynomial, variable)) {
    return result("unsupported", [], [], "Only univariate polynomial inequalities are supported.");
  }
  const degree = polynomialDegree(polynomial, variable);
  if (degree > 2) {
    return result("unsupported", [], [], "Exact inequality solving currently supports polynomial degree at most 2.");
  }

  if (degree < 0) {
    return result(relationAcceptsZero(relation) ? "complete" : "complete", relationAcceptsZero(relation) ? [{
      lower: null, upper: null, lowerApproximation: null, upperApproximation: null,
      lowerClosed: false, upperClosed: false,
    }] : [], [], undefined);
  }

  if (degree === 0) {
    const constantExpr = polynomialToExpr(polynomialCoefficient(polynomial, variable, 0));
    if (!isNumeric(constantExpr)) return result("unsupported", [], [], "Could not extract an exact constant coefficient.");
    const [numerator] = numericParts(constantExpr);
    const sign: -1 | 0 | 1 = numerator < 0n ? -1 : numerator > 0n ? 1 : 0;
    const accepted = testRelationSign(sign, relation);
    return result("complete", accepted ? [{
      lower: null, upper: null, lowerApproximation: null, upperApproximation: null,
      lowerClosed: false, upperClosed: false,
    }] : [], [], undefined);
  }

  const equation = solve(expression, variable);
  if (equation.status === "unsupported" || equation.status === "partial" || equation.status === "all") {
    return result("unsupported", [], [], equation.message ?? "Could not find all polynomial roots exactly.");
  }

  const leadingCoefficient = polynomialToExpr(polynomialCoefficient(polynomial, variable, degree));
  if (!isNumeric(leadingCoefficient)) return result("unsupported", [], [], "Could not extract an exact leading coefficient.");
  const [leadingNumerator] = numericParts(leadingCoefficient);
  const leadingSign: -1 | 1 = leadingNumerator < 0n ? -1 : 1;
  const roots: Root[] = [];
  for (const rootExpr of equation.solutions) {
    try {
      const value = evaluate(rootExpr);
      if (Number.isFinite(value)) roots.push({ expr: rootExpr, value });
    } catch {
      // The quadratic solver represents non-real roots symbolically with sqrt(negative).
      // They are not boundaries of a real inequality.
    }
  }
  roots.sort((a, b) => a.value - b.value);
  const uniqueRoots: Root[] = [];
  const seenRootKeys = new Set<string>();
  for (const root of roots) {
    const key = structuralKey(root.expr);
    if (seenRootKeys.has(key)) continue;
    const previous = uniqueRoots[uniqueRoots.length - 1];
    if (previous && Math.abs(previous.value - root.value) <= Number.EPSILON * 16 * Math.max(1, Math.abs(root.value), Math.abs(previous.value))) {
      return result("partial", [], roots.map(item => item.expr), "Distinct roots cannot be ordered safely at IEEE-754 double precision; use arbitrary-precision root isolation.");
    }
    seenRootKeys.add(key);
    uniqueRoots.push(root);
  }

  const cells: Cell[] = [];
  if (uniqueRoots.length === 0) {
    cells.push({ lowerRoot: null, upperRoot: null, lowerClosed: false, upperClosed: false, segmentIndex: 0, isRootPoint: false });
  } else {
    for (let i = 0; i <= uniqueRoots.length; i++) {
      const lowerRoot = i === 0 ? null : uniqueRoots[i - 1]!;
      const upperRoot = i === uniqueRoots.length ? null : uniqueRoots[i]!;
      cells.push({ lowerRoot, upperRoot, lowerClosed: false, upperClosed: false, segmentIndex: i, isRootPoint: false });
      if (upperRoot !== null) {
        cells.push({ lowerRoot: upperRoot, upperRoot, lowerClosed: true, upperClosed: true, segmentIndex: i, isRootPoint: true });
      }
    }
  }

  const accepted: InequalityInterval[] = [];
  for (const cell of cells) {
    let sign: -1 | 0 | 1;
    if (cell.isRootPoint) sign = 0;
    else if (degree === 1) sign = cell.segmentIndex === 0 ? (leadingSign === 1 ? -1 : 1) : leadingSign;
    else if (uniqueRoots.length === 2 && cell.segmentIndex === 1) sign = leadingSign === 1 ? -1 : 1;
    else sign = leadingSign;

    const keep = testRelationSign(sign, relation);
    if (!keep) continue;

    const interval: InequalityInterval = {
      lower: cell.lowerRoot?.expr ?? null,
      upper: cell.upperRoot?.expr ?? null,
      lowerApproximation: cell.lowerRoot?.value ?? null,
      upperApproximation: cell.upperRoot?.value ?? null,
      lowerClosed: cell.lowerClosed,
      upperClosed: cell.upperClosed,
    };

    const previous = accepted[accepted.length - 1];
    const touchesAtIncludedPoint = previous !== undefined
      && previous.upperApproximation !== null
      && interval.lowerApproximation !== null
      && Math.abs(previous.upperApproximation - interval.lowerApproximation) <= 1e-12 * Math.max(1, Math.abs(interval.lowerApproximation))
      && (previous.upperClosed || interval.lowerClosed);
    if (touchesAtIncludedPoint) {
      accepted[accepted.length - 1] = {
        ...previous,
        upper: interval.upper,
        upperApproximation: interval.upperApproximation,
        upperClosed: interval.upperClosed,
      };
    } else {
      accepted.push(interval);
    }
  }

  return result("complete", accepted, uniqueRoots.map(root => root.expr), undefined);

  function result(
    status: InequalityStatus,
    intervals: readonly InequalityInterval[],
    realRoots: readonly Expr[],
    message: string | undefined,
  ): PolynomialInequalityResult {
    return {
      status, variable, relation, intervals, realRoots,
      ...(message === undefined ? {} : { message }),
    };
  }
}

function relationAcceptsZero(relation: InequalityRelation): boolean {
  return relation === "<=" || relation === ">=" || relation === "=";
}

function testRelationSign(value: -1 | 0 | 1, relation: InequalityRelation): boolean {
  switch (relation) {
    case "<": return value < 0;
    case "<=": return value <= 0;
    case ">": return value > 0;
    case ">=": return value >= 0;
    case "=": return value === 0;
    case "!=": return value !== 0;
  }
}

/**
 * Solve |g(x)| relation c for exact polynomial g of degree <= 2 and numeric rational c.
 * Rewrites the absolute-value relation into two polynomial inequalities, then intersects/unites
 * their interval sets. This covers supported polynomial absolute-value equation/inequality forms.
 */
export function solveAbsoluteValueRelation(
  inner: Expr,
  bound: Expr,
  variable: string,
  relation: InequalityRelation,
): PolynomialInequalityResult {
  let c: number;
  try { c = evaluate(bound); }
  catch (error) {
    return { status: "unsupported", variable, relation, intervals: [], realRoots: [], message: error instanceof Error ? error.message : "Absolute-value bound must be numeric." };
  }
  if (!Number.isFinite(c)) return { status: "unsupported", variable, relation, intervals: [], realRoots: [], message: "Absolute-value bound must be finite." };
  if (bound.kind === "Symbol" || (bound.kind !== "Integer" && bound.kind !== "Rational")) {
    return { status: "unsupported", variable, relation, intervals: [], realRoots: [], message: "Absolute-value bound must be an exact integer or rational constant." };
  }

  const all: InequalityInterval[] = [{ lower: null, upper: null, lowerApproximation: null, upperApproximation: null, lowerClosed: false, upperClosed: false }];
  const none: InequalityInterval[] = [];
  if (c < 0) {
    const isAlways = relation === ">" || relation === ">=" || relation === "!=";
    return { status: "complete", variable, relation, intervals: isAlways ? all : none, realRoots: [] };
  }

  const lowerExpression = add(inner, negate(bound)); // g - c
  const upperExpression = add(inner, bound); // g + c

  let first: PolynomialInequalityResult;
  let second: PolynomialInequalityResult;
  let combine: "intersection" | "union";
  switch (relation) {
    case "<": first = solvePolynomialInequality(lowerExpression, variable, "<"); second = solvePolynomialInequality(upperExpression, variable, ">"); combine = "intersection"; break;
    case "<=": first = solvePolynomialInequality(lowerExpression, variable, "<="); second = solvePolynomialInequality(upperExpression, variable, ">="); combine = "intersection"; break;
    case ">": first = solvePolynomialInequality(lowerExpression, variable, ">"); second = solvePolynomialInequality(upperExpression, variable, "<"); combine = "union"; break;
    case ">=": first = solvePolynomialInequality(lowerExpression, variable, ">="); second = solvePolynomialInequality(upperExpression, variable, "<="); combine = "union"; break;
    case "=": first = solvePolynomialInequality(lowerExpression, variable, "="); second = solvePolynomialInequality(upperExpression, variable, "="); combine = "union"; break;
    case "!=": first = solvePolynomialInequality(lowerExpression, variable, "!="); second = solvePolynomialInequality(upperExpression, variable, "!="); combine = "intersection"; break;
  }
  if (first.status !== "complete" || second.status !== "complete") {
    return {
      status: first.status === "unsupported" || second.status === "unsupported" ? "unsupported" : "partial",
      variable, relation, intervals: [],
      realRoots: [...first.realRoots, ...second.realRoots],
      message: first.message ?? second.message ?? "Could not solve both polynomial conditions for the absolute-value relation.",
    };
  }
  const intervals = combine === "intersection"
    ? intersectIntervalSets(first.intervals, second.intervals)
    : unionIntervalSets([...first.intervals, ...second.intervals]);
  const rootMap = new Map<string, Expr>();
  for (const root of [...first.realRoots, ...second.realRoots]) rootMap.set(structuralKey(root), root);
  return { status: "complete", variable, relation, intervals, realRoots: [...rootMap.values()] };
}

function intersectIntervalSets(a: readonly InequalityInterval[], b: readonly InequalityInterval[]): InequalityInterval[] {
  const result: InequalityInterval[] = [];
  for (const left of a) for (const right of b) {
    const lowerFromLeft = compareLower(left, right) >= 0;
    const upperFromLeft = compareUpper(left, right) <= 0;
    const lowerInterval = lowerFromLeft ? left : right;
    const upperInterval = upperFromLeft ? left : right;
    const lowerValue = lowerInterval.lowerApproximation;
    const upperValue = upperInterval.upperApproximation;
    if (lowerValue !== null && upperValue !== null && lowerValue > upperValue) continue;
    const lowerClosed = left.lowerApproximation === right.lowerApproximation
      ? left.lowerClosed && right.lowerClosed
      : lowerInterval.lowerClosed;
    const upperClosed = left.upperApproximation === right.upperApproximation
      ? left.upperClosed && right.upperClosed
      : upperInterval.upperClosed;
    if (lowerValue !== null && upperValue !== null && lowerValue === upperValue && !(lowerClosed && upperClosed)) continue;
    result.push({
      lower: lowerInterval.lower, upper: upperInterval.upper,
      lowerApproximation: lowerValue, upperApproximation: upperValue,
      lowerClosed, upperClosed,
    });
  }
  return unionIntervalSets(result);
}

function compareLower(a: InequalityInterval, b: InequalityInterval): number {
  if (a.lowerApproximation === null) return b.lowerApproximation === null ? 0 : -1;
  if (b.lowerApproximation === null) return 1;
  return a.lowerApproximation - b.lowerApproximation;
}
function compareUpper(a: InequalityInterval, b: InequalityInterval): number {
  if (a.upperApproximation === null) return b.upperApproximation === null ? 0 : 1;
  if (b.upperApproximation === null) return -1;
  return a.upperApproximation - b.upperApproximation;
}

function unionIntervalSets(input: readonly InequalityInterval[]): InequalityInterval[] {
  const intervals = [...input].sort((a, b) => compareLower(a, b));
  const result: InequalityInterval[] = [];
  for (const interval of intervals) {
    const previous = result[result.length - 1];
    if (!previous) { result.push(interval); continue; }
    const prevUpper = previous.upperApproximation;
    const nextLower = interval.lowerApproximation;
    const overlaps = prevUpper === null || nextLower === null || prevUpper > nextLower;
    const touchesIncluded = prevUpper !== null && nextLower !== null && prevUpper === nextLower
      && (previous.upperClosed || interval.lowerClosed);
    if (overlaps || touchesIncluded) {
      const sameLower = previous.lowerApproximation === interval.lowerApproximation;
      const lowerClosed = sameLower ? previous.lowerClosed || interval.lowerClosed : previous.lowerClosed;
      const upperComparison = compareUpper(interval, previous);
      const sameUpper = previous.upperApproximation === interval.upperApproximation;
      const chooseNewUpper = upperComparison > 0;
      const upper = sameUpper ? previous.upper : chooseNewUpper ? interval.upper : previous.upper;
      const upperApproximation = sameUpper ? previous.upperApproximation : chooseNewUpper ? interval.upperApproximation : previous.upperApproximation;
      const upperClosed = sameUpper ? previous.upperClosed || interval.upperClosed : chooseNewUpper ? interval.upperClosed : previous.upperClosed;
      result[result.length - 1] = { ...previous, lowerClosed, upper, upperApproximation, upperClosed };
    } else result.push(interval);
  }
  return result;
}
