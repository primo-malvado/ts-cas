/**
 * Certified real-domain analysis for elementary expressions.
 * Polynomial boundaries use exact rational Sturm isolation. Tangent poles for
 * affine rational arguments use outward-rounded decimal intervals for pi.
 */
import { numericParts, type Expr } from "../core/expr.js";
import {
  polynomialFromExpr,
  polynomialDegree,
  isUnivariatePolynomial,
  type Polynomial,
} from "./polynomial.js";
import {
  decimal,
  decimalAbs,
  decimalCompare,
  decimalNegate,
  decimalToString,
  type BigDecimal,
} from "../numeric/decimal.js";
import {
  decimalInterval,
  decimalIntervalAdd,
  decimalIntervalDivide,
  decimalIntervalMultiply,
  decimalIntervalSubtract,
  decimalIntervalPi,
  type DecimalInterval,
} from "../numeric/interval.js";
import {
  exactRational,
  exactRationalFromDecimalParts,
  isolateRealRootsExactInInterval,
  type ExactRational,
  type ExactRootInterval,
  type ExactUnresolvedRootInterval,
} from "../numeric/sturm.js";

export type RealDomainRestrictionKind = "denominator" | "sqrt" | "log" | "tan" | "power";
export type RealDomainCondition = "nonzero" | "nonnegative" | "positive" | "avoid-tan-poles";
export type RealDomainAnalysisStatus = "complete" | "partial" | "unsupported" | "undefined";
export type RealDomainConditionState = "satisfied" | "violated" | "boundary";

export interface RealDomainAnalysisOptions {
  /** Width bound for isolating polynomial boundaries. Defaults to 10^-12. */
  readonly tolerance?: ExactRational;
  /** Maximum polynomial degree handled by exact Sturm isolation. Defaults to 24. */
  readonly maxDegree?: number;
  /** Maximum Sturm subdivision iterations. Defaults to 512. */
  readonly maxIterations?: number;
  /** Significant digits for certified tangent-pole enclosures. Defaults to 50. */
  readonly precision?: number;
  /** Maximum tangent poles listed per tan restriction. Defaults to 256. */
  readonly maxTanPoles?: number;
}

export interface ExactDomainBoundary {
  readonly kind: "exact-root-interval";
  readonly interval: ExactRootInterval;
  /** `included` means the boundary point itself satisfies the local domain condition. */
  readonly pointStatus: "included" | "excluded" | "enclosure";
}

export interface UnresolvedDomainBoundary {
  readonly kind: "unresolved-root-interval";
  readonly interval: ExactUnresolvedRootInterval;
  readonly pointStatus: "unknown";
}

export interface CertifiedDecimalDomainBoundary {
  readonly kind: "certified-decimal-interval";
  readonly lowerText: string;
  readonly upperText: string;
  readonly precision: number;
  readonly certified: true;
  /** `possible` means the enclosure overlaps an endpoint and interval membership is unresolved. */
  readonly position: "inside" | "possible";
  readonly poleIndex: string;
}

export type RealDomainBoundary = ExactDomainBoundary | UnresolvedDomainBoundary | CertifiedDecimalDomainBoundary;

export interface RealDomainRegion {
  readonly lower: ExactRational;
  readonly upper: ExactRational;
  readonly lowerClosed: boolean;
  readonly upperClosed: boolean;
  /** State of this restriction on the region's interior. */
  readonly conditionState: RealDomainConditionState;
}

export interface RealDomainRestriction {
  readonly kind: RealDomainRestrictionKind;
  readonly condition: RealDomainCondition;
  /** Divisor, function argument, or power base whose domain is constrained. */
  readonly source: Expr;
  readonly status: Exclude<RealDomainAnalysisStatus, "undefined">;
  readonly boundaries: readonly RealDomainBoundary[];
  /** Exact-rational regions are provided for polynomial inequalities and exclusions. */
  readonly regions?: readonly RealDomainRegion[];
  readonly unresolvedIntervals?: readonly ExactUnresolvedRootInterval[];
  readonly message?: string;
}

export type RealDomainGlobalState = "included" | "excluded" | "uncertain" | "unknown";

/** A cell in the intersection of every domain restriction found in the expression. */
export interface RealDomainGlobalRegion {
  readonly lower: ExactRational;
  readonly upper: ExactRational;
  readonly lowerClosed: boolean;
  readonly upperClosed: boolean;
  readonly state: RealDomainGlobalState;
  /** Explanation is populated for unresolved enclosures or unsupported restrictions. */
  readonly message?: string;
}

export interface RealDomainAnalysisResult {
  readonly status: RealDomainAnalysisStatus;
  readonly variable: string;
  readonly interval: { readonly lower: ExactRational; readonly upper: ExactRational };
  readonly restrictions: readonly RealDomainRestriction[];
  /** Certified partition of the requested interval after intersecting all restrictions. */
  readonly domainRegions: readonly RealDomainGlobalRegion[];
  readonly message?: string;
}

const ZERO = exactRational(0n);

function compareRational(a: ExactRational, b: ExactRational): number {
  const left = a.numerator * b.denominator;
  const right = b.numerator * a.denominator;
  return left < right ? -1 : left > right ? 1 : 0;
}

function addRational(a: ExactRational, b: ExactRational): ExactRational {
  return exactRational(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
}

function multiplyRational(a: ExactRational, b: ExactRational): ExactRational {
  return exactRational(a.numerator * b.numerator, a.denominator * b.denominator);
}

function negateRational(a: ExactRational): ExactRational {
  return exactRational(-a.numerator, a.denominator);
}

function midpoint(a: ExactRational, b: ExactRational): ExactRational {
  return exactRational(a.numerator * b.denominator + b.numerator * a.denominator, 2n * a.denominator * b.denominator);
}

function polynomialCoefficients(poly: Polynomial, variable: string): ExactRational[] {
  if (!isUnivariatePolynomial(poly, variable)) {
    throw new TypeError(`The expression is not a polynomial in '${variable}' alone.`);
  }
  const degree = polynomialDegree(poly, variable);
  const coefficients = Array.from({ length: Math.max(1, degree + 1) }, () => ZERO);
  for (const term of poly.terms.values()) {
    for (const name of term.monomial.powers.keys()) {
      if (name !== variable) throw new TypeError(`The expression depends on '${name}', not only on '${variable}'.`);
    }
    const exponent = term.monomial.powers.get(variable) ?? 0;
    const [n, d] = numericParts(term.coefficient);
    coefficients[exponent] = exactRational(n, d);
  }
  return coefficients;
}

function evaluatePolynomial(coefficients: readonly ExactRational[], x: ExactRational): ExactRational {
  let value = ZERO;
  for (let i = coefficients.length - 1; i >= 0; i--) {
    value = addRational(multiplyRational(value, x), coefficients[i]!);
  }
  return value;
}

function signRational(value: ExactRational): -1 | 0 | 1 {
  return value.numerator < 0n ? -1 : value.numerator > 0n ? 1 : 0;
}

function pointCondition(_kind: RealDomainRestrictionKind, condition: RealDomainCondition): "included" | "excluded" {
  return condition === "nonnegative" ? "included" : "excluded";
}

function conditionSatisfied(condition: RealDomainCondition, sign: -1 | 0 | 1): boolean {
  switch (condition) {
    case "nonzero": return sign !== 0;
    case "nonnegative": return sign >= 0;
    case "positive": return sign > 0;
    case "avoid-tan-poles": return true;
  }
}

function rationalInterval(value: ExactRational, precision: number): DecimalInterval {
  const numerator = decimalInterval(value.numerator);
  const denominator = decimalInterval(value.denominator);
  return decimalIntervalDivide(numerator, denominator, precision);
}

function floorDecimal(value: BigDecimal): bigint {
  if (value.scale <= 0) return value.coefficient * (10n ** BigInt(-value.scale));
  const denominator = 10n ** BigInt(value.scale);
  let quotient = value.coefficient / denominator;
  if (value.coefficient < 0n && value.coefficient % denominator !== 0n) quotient--;
  return quotient;
}

function ceilDecimal(value: BigDecimal): bigint {
  return -floorDecimal(decimalNegate(value));
}

function exactConstantValue(poly: Polynomial, variable: string): ExactRational | null {
  if (polynomialDegree(poly, variable) > 0) return null;
  if (poly.terms.size === 0) return ZERO;
  const term = [...poly.terms.values()][0]!;
  if (term.monomial.powers.size > 0) return null;
  const [n, d] = numericParts(term.coefficient);
  return exactRational(n, d);
}

interface PolynomialAnalysis {
  readonly boundaries: readonly RealDomainBoundary[];
  readonly regions: readonly RealDomainRegion[];
  readonly unresolvedIntervals: readonly ExactUnresolvedRootInterval[];
  readonly status: "complete" | "partial";
  readonly alwaysViolated: boolean;
  readonly message?: string;
}

function analyzePolynomialCondition(
  source: Expr,
  variable: string,
  lower: ExactRational,
  upper: ExactRational,
  kind: RealDomainRestrictionKind,
  condition: RealDomainCondition,
  options: Required<Pick<RealDomainAnalysisOptions, "tolerance" | "maxDegree" | "maxIterations">>,
): PolynomialAnalysis {
  const polynomial = polynomialFromExpr(source);
  const coefficients = polynomialCoefficients(polynomial, variable);
  const degree = polynomialDegree(polynomial, variable);
  if (degree > options.maxDegree) {
    throw new RangeError(`Polynomial degree ${degree} exceeds the configured maximum ${options.maxDegree}.`);
  }

  if (degree <= 0) {
    const constant = exactConstantValue(polynomial, variable) ?? ZERO;
    const sign = signRational(constant);
    const satisfied = conditionSatisfied(condition, sign);
    return {
      boundaries: [],
      regions: [{ lower, upper, lowerClosed: true, upperClosed: true, conditionState: satisfied ? "satisfied" : "violated" }],
      unresolvedIntervals: [],
      status: "complete",
      alwaysViolated: !satisfied,
    };
  }

  const isolation = isolateRealRootsExactInInterval(
    coefficients,
    lower,
    upper,
    options.tolerance,
    options.maxDegree,
    options.maxIterations,
  );
  const boundaries: RealDomainBoundary[] = [
    ...isolation.roots.map(interval => ({
      kind: "exact-root-interval" as const,
      interval,
      pointStatus: compareRational(interval.lower, interval.upper) === 0
        ? pointCondition(kind, condition)
        : "enclosure" as const,
    })),
    ...isolation.unresolvedIntervals.map(interval => ({
      kind: "unresolved-root-interval" as const,
      interval,
      pointStatus: "unknown" as const,
    })),
  ];
  type Event =
    | { readonly type: "root"; readonly lower: ExactRational; readonly upper: ExactRational; readonly root: ExactRootInterval }
    | { readonly type: "unresolved"; readonly lower: ExactRational; readonly upper: ExactRational; readonly unresolved: ExactUnresolvedRootInterval };
  const events: Event[] = [
    ...isolation.roots.map(root => ({ type: "root" as const, lower: root.lower, upper: root.upper, root })),
    ...isolation.unresolvedIntervals.map(unresolved => ({ type: "unresolved" as const, lower: unresolved.lower, upper: unresolved.upper, unresolved })),
  ].sort((a, b) => compareRational(a.lower, b.lower) || compareRational(a.upper, b.upper));
  const regions: RealDomainRegion[] = [];
  let cursor = lower;
  let cursorClosed = true;
  for (const event of events) {
    const leftOrder = compareRational(cursor, event.lower);
    if (leftOrder < 0) {
      const sample = midpoint(cursor, event.lower);
      const sign = signRational(evaluatePolynomial(coefficients, sample));
      regions.push({
        lower: cursor,
        upper: event.lower,
        lowerClosed: cursorClosed,
        upperClosed: false,
        conditionState: conditionSatisfied(condition, sign) ? "satisfied" : "violated",
      });
    } else if (leftOrder > 0) {
      throw new Error("Overlapping root enclosures prevented domain partitioning.");
    }

    if (event.type === "root" && compareRational(event.lower, event.upper) === 0) {
      const state = pointCondition(kind, condition) === "included" ? "satisfied" : "violated";
      regions.push({
        lower: event.lower,
        upper: event.upper,
        lowerClosed: true,
        upperClosed: true,
        conditionState: state,
      });
    } else {
      regions.push({
        lower: event.lower,
        upper: event.upper,
        lowerClosed: true,
        upperClosed: true,
        conditionState: "boundary",
      });
    }
    cursor = event.upper;
    // The event region owns its endpoints; adjacent sign-classified regions exclude them.
    cursorClosed = false;
  }
  if (compareRational(cursor, upper) < 0) {
    const sample = midpoint(cursor, upper);
    const sign = signRational(evaluatePolynomial(coefficients, sample));
    regions.push({
      lower: cursor,
      upper,
      lowerClosed: cursorClosed,
      upperClosed: true,
      conditionState: conditionSatisfied(condition, sign) ? "satisfied" : "violated",
    });
  } else if (compareRational(cursor, upper) > 0) {
    throw new Error("Root enclosure extends beyond the requested interval.");
  }

  return {
    boundaries,
    regions,
    unresolvedIntervals: isolation.unresolvedIntervals,
    status: isolation.status === "partial" ? "partial" : "complete",
    alwaysViolated: regions.length > 0 && regions.every(region => region.conditionState === "violated"),
    ...(isolation.status === "partial" ? { message: "Some polynomial boundary roots could not be isolated to the requested tolerance." } : {}),
  };
}

interface LinearForm {
  readonly slope: ExactRational;
  readonly intercept: ExactRational;
}

function linearForm(source: Expr, variable: string): LinearForm {
  const polynomial = polynomialFromExpr(source);
  if (!isUnivariatePolynomial(polynomial, variable)) {
    throw new TypeError(`The tangent argument must be affine in '${variable}' with rational coefficients.`);
  }
  if (polynomialDegree(polynomial, variable) > 1) {
    throw new TypeError(`Certified tangent-pole analysis only supports affine arguments in '${variable}'.`);
  }
  let slope = ZERO;
  let intercept = ZERO;
  for (const term of polynomial.terms.values()) {
    for (const name of term.monomial.powers.keys()) {
      if (name !== variable) throw new TypeError(`The tangent argument also depends on '${name}'.`);
    }
    const exponent = term.monomial.powers.get(variable) ?? 0;
    const [n, d] = numericParts(term.coefficient);
    const coefficient = exactRational(n, d);
    if (exponent === 1) slope = coefficient;
    else intercept = coefficient;
  }
  return { slope, intercept };
}

function analyzeTangentPoles(
  source: Expr,
  variable: string,
  lower: ExactRational,
  upper: ExactRational,
  precision: number,
  maxTanPoles: number,
): { boundaries: CertifiedDecimalDomainBoundary[]; status: "complete" | "partial" | "unsupported"; message?: string } {
  const form = linearForm(source, variable);
  if (form.slope.numerator === 0n) {
    // A rational constant cannot equal (k + 1/2)π because π is irrational.
    return { boundaries: [], status: "complete" };
  }
  const p = Math.min(980, precision + 12);
  const xRange = decimalInterval(rationalInterval(lower, p).lower, rationalInterval(upper, p).upper);
  const slopeRange = rationalInterval(form.slope, p);
  const interceptRange = rationalInterval(form.intercept, p);
  const argumentRange = decimalIntervalAdd(
    decimalIntervalMultiply(slopeRange, xRange, p),
    interceptRange,
    p,
  );
  const magnitudeLimit = decimal("1e30");
  if (
    decimalCompare(decimalAbs(argumentRange.lower), magnitudeLimit) > 0 ||
    decimalCompare(decimalAbs(argumentRange.upper), magnitudeLimit) > 0
  ) {
    return { boundaries: [], status: "unsupported", message: "Certified tangent-pole analysis requires the argument range to remain within |u| <= 1e30." };
  }

  const pi = decimalIntervalPi(p);
  const quotientRange = decimalIntervalDivide(argumentRange, pi, p);
  const half = decimalInterval("0.5");
  const shifted = decimalIntervalSubtract(quotientRange, half, p);
  const firstIndex = ceilDecimal(shifted.lower);
  const lastIndex = floorDecimal(shifted.upper);
  if (lastIndex < firstIndex) return { boundaries: [], status: "complete" };
  const candidateCount = lastIndex - firstIndex + 1n;
  if (candidateCount > BigInt(maxTanPoles)) {
    return {
      boundaries: [], status: "partial",
      message: `The interval may contain ${candidateCount.toString()} tangent poles, above the configured maximum ${maxTanPoles}.`,
    };
  }

  const xDomain = decimalInterval(rationalInterval(lower, p).lower, rationalInterval(upper, p).upper);
  const boundaries: CertifiedDecimalDomainBoundary[] = [];
  let ambiguous = false;
  for (let k = firstIndex; k <= lastIndex; k++) {
    // Each pole is (k + 1/2)π, enclosed using exact integer arithmetic and certified pi.
    const halfOdd = decimalIntervalDivide(decimalInterval(2n * k + 1n), decimalInterval(2n), p);
    const poleArgument = decimalIntervalMultiply(halfOdd, pi, p);
    const xPole = decimalIntervalDivide(
      decimalIntervalSubtract(poleArgument, interceptRange, p),
      slopeRange,
      p,
    );
    if (
      decimalCompare(xPole.upper, xDomain.lower) < 0 ||
      decimalCompare(xPole.lower, xDomain.upper) > 0
    ) continue;

    const definitelyInside = decimalCompare(xPole.lower, xDomain.lower) >= 0 &&
      decimalCompare(xPole.upper, xDomain.upper) <= 0;
    if (!definitelyInside) ambiguous = true;
    boundaries.push({
      kind: "certified-decimal-interval",
      lowerText: decimalToString(xPole.lower),
      upperText: decimalToString(xPole.upper),
      precision,
      certified: true,
      position: definitelyInside ? "inside" : "possible",
      poleIndex: k.toString(),
    });
  }
  return {
    boundaries,
    status: ambiguous ? "partial" : "complete",
    ...(ambiguous ? { message: "A tangent-pole enclosure overlaps a requested interval endpoint; membership remains unresolved." } : {}),
  };
}

interface GlobalBoundaryEvent {
  readonly lower: ExactRational;
  readonly upper: ExactRational;
  readonly uncertain: boolean;
  readonly sourceKinds: readonly string[];
}

function decimalTextToRational(text: string): ExactRational {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) throw new TypeError(`Invalid non-scientific decimal boundary: ${text}`);
  const sign = match[1] === "-" ? -1n : 1n;
  const integerDigits = match[2]!;
  const fractionalDigits = match[3] ?? "";
  const coefficient = sign * BigInt(`${integerDigits}${fractionalDigits}` || "0");
  return exactRationalFromDecimalParts(coefficient, fractionalDigits.length);
}

function restrictionSatisfiedAt(
  restriction: RealDomainRestriction,
  variable: string,
  x: ExactRational,
): boolean | null {
  if (restriction.status === "unsupported") return null;
  if (restriction.kind === "tan") {
    // Every tangent pole supported by this analyzer is an irrational affine image
    // of pi, so it cannot coincide with a rational sample point. Pole enclosures
    // themselves are represented by global uncertain cells and never sampled here.
    if (restriction.status === "partial" && restriction.boundaries.length === 0) return null;
    return true;
  }
  try {
    const polynomial = polynomialFromExpr(restriction.source);
    const coefficients = polynomialCoefficients(polynomial, variable);
    const value = evaluatePolynomial(coefficients, x);
    return conditionSatisfied(restriction.condition, signRational(value));
  } catch {
    return null;
  }
}

function classifyGlobalSample(
  restrictions: readonly RealDomainRestriction[],
  variable: string,
  x: ExactRational,
): RealDomainGlobalState {
  let anyUnknown = false;
  for (const restriction of restrictions) {
    const satisfied = restrictionSatisfiedAt(restriction, variable, x);
    if (satisfied === false) return "excluded";
    if (satisfied === null) anyUnknown = true;
  }
  return anyUnknown ? "unknown" : "included";
}

function globalBoundaryEvents(
  restrictions: readonly RealDomainRestriction[],
  lower: ExactRational,
  upper: ExactRational,
): GlobalBoundaryEvent[] {
  const events: GlobalBoundaryEvent[] = [];
  const push = (eventLower: ExactRational, eventUpper: ExactRational, uncertain: boolean, sourceKind: string) => {
    const clippedLower = compareRational(eventLower, lower) < 0 ? lower : eventLower;
    const clippedUpper = compareRational(eventUpper, upper) > 0 ? upper : eventUpper;
    if (compareRational(clippedLower, clippedUpper) > 0) return;
    events.push({ lower: clippedLower, upper: clippedUpper, uncertain, sourceKinds: [sourceKind] });
  };

  for (const restriction of restrictions) {
    // A partial tangent result with no returned pole enclosure means the configured
    // pole budget was exhausted; a global partition cannot safely assume pole-free gaps.
    for (const boundary of restriction.boundaries) {
      if (boundary.kind === "exact-root-interval") {
        const exactPoint = compareRational(boundary.interval.lower, boundary.interval.upper) === 0;
        push(boundary.interval.lower, boundary.interval.upper, !exactPoint, boundary.kind);
      } else if (boundary.kind === "unresolved-root-interval") {
        push(boundary.interval.lower, boundary.interval.upper, true, boundary.kind);
      } else {
        push(
          decimalTextToRational(boundary.lowerText),
          decimalTextToRational(boundary.upperText),
          true,
          boundary.kind,
        );
      }
    }
  }
  events.sort((a, b) => compareRational(a.lower, b.lower) || compareRational(a.upper, b.upper));

  const merged: GlobalBoundaryEvent[] = [];
  for (const event of events) {
    const last = merged[merged.length - 1];
    if (!last || compareRational(event.lower, last.upper) > 0) {
      merged.push(event);
      continue;
    }
    const mergedUpper = compareRational(event.upper, last.upper) > 0 ? event.upper : last.upper;
    merged[merged.length - 1] = {
      lower: last.lower,
      upper: mergedUpper,
      uncertain: last.uncertain || event.uncertain || compareRational(last.lower, mergedUpper) !== 0,
      sourceKinds: [...new Set([...last.sourceKinds, ...event.sourceKinds])],
    };
  }
  return merged;
}

function eventProvablyExcludedByOtherRestriction(
  restrictions: readonly RealDomainRestriction[],
  event: GlobalBoundaryEvent,
): RealDomainRestriction | null {
  for (const restriction of restrictions) {
    if (restriction.kind === "tan" || restriction.status === "unsupported") continue;
    const coveredByViolation = restriction.regions?.some(region => {
      if (region.conditionState !== "violated") return false;
      const lowerCmp = compareRational(region.lower, event.lower);
      const upperCmp = compareRational(region.upper, event.upper);
      const coversLower = lowerCmp < 0 || lowerCmp === 0 && region.lowerClosed;
      const coversUpper = upperCmp > 0 || upperCmp === 0 && region.upperClosed;
      return coversLower && coversUpper;
    }) ?? false;
    if (coveredByViolation) return restriction;
  }
  return null;
}

function buildGlobalDomainRegions(
  restrictions: readonly RealDomainRestriction[],
  variable: string,
  lower: ExactRational,
  upper: ExactRational,
): RealDomainGlobalRegion[] {
  // Unsupported restrictions or tangent-pole overflow with no enclosures mean we
  // cannot certify any portion of the total intersection. Do not silently omit them.
  const globalUnknown = restrictions.some(restriction =>
    restriction.status === "unsupported" ||
    restriction.kind === "tan" && restriction.status === "partial" && restriction.boundaries.length === 0,
  );
  if (globalUnknown) {
    return [{
      lower, upper, lowerClosed: true, upperClosed: true, state: "unknown",
      message: "At least one restriction lacks enough certified boundaries to determine the global domain.",
    }];
  }

  const events = globalBoundaryEvents(restrictions, lower, upper);
  const regions: RealDomainGlobalRegion[] = [];
  let cursor = lower;
  let cursorClosed = true;
  const addGap = (gapLower: ExactRational, gapUpper: ExactRational, lowerClosed: boolean, upperClosed: boolean) => {
    if (compareRational(gapLower, gapUpper) >= 0) return;
    const sample = midpoint(gapLower, gapUpper);
    const state = classifyGlobalSample(restrictions, variable, sample);
    regions.push({ lower: gapLower, upper: gapUpper, lowerClosed, upperClosed, state });
  };

  for (const event of events) {
    if (compareRational(cursor, event.lower) < 0) addGap(cursor, event.lower, cursorClosed, false);

    if (event.uncertain) {
      const excludingRestriction = eventProvablyExcludedByOtherRestriction(restrictions, event);
      regions.push({
        lower: event.lower,
        upper: event.upper,
        lowerClosed: true,
        upperClosed: true,
        state: excludingRestriction ? "excluded" : "uncertain",
        ...(excludingRestriction
          ? { message: `The whole boundary enclosure is excluded because the '${excludingRestriction.kind}' restriction is violated throughout it.` }
          : { message: `Certified enclosure of a domain boundary (${event.sourceKinds.join(", ")}); membership inside this enclosure is not classified pointwise.` }),
      });
    } else {
      const state = classifyGlobalSample(restrictions, variable, event.lower);
      regions.push({ lower: event.lower, upper: event.upper, lowerClosed: true, upperClosed: true, state });
    }
    cursor = event.upper;
    cursorClosed = false;
  }
  if (compareRational(cursor, upper) < 0) addGap(cursor, upper, cursorClosed, true);
  else if (events.length === 0) {
    // Positive-width request guaranteed by validation, so this branch is only defensive.
    regions.push({ lower, upper, lowerClosed: true, upperClosed: true, state: classifyGlobalSample(restrictions, variable, midpoint(lower, upper)) });
  }

  if (regions.length === 0) {
    const state = classifyGlobalSample(restrictions, variable, midpoint(lower, upper));
    regions.push({ lower, upper, lowerClosed: true, upperClosed: true, state });
  }
  return regions;
}

function makeUnsupported(
  kind: RealDomainRestrictionKind,
  condition: RealDomainCondition,
  source: Expr,
  message: string,
): RealDomainRestriction {
  return { kind, condition, source, status: "unsupported", boundaries: [], message };
}

/**
 * Analyze real-domain restrictions over a closed exact-rational interval.
 * Supports denominators, sqrt/log argument signs, and tangent poles for affine
 * arguments with exact rational coefficients. Polynomial boundaries are isolated
 * exactly; tangent-pole positions are given as outward-rounded certified enclosures.
 */
export function analyzeRealDomain(
  expression: Expr,
  variable: string,
  lowerInput: ExactRational,
  upperInput: ExactRational,
  options: RealDomainAnalysisOptions = {},
): RealDomainAnalysisResult {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) throw new TypeError(`Invalid variable name: ${variable}`);
  const lower = exactRational(lowerInput.numerator, lowerInput.denominator);
  const upper = exactRational(upperInput.numerator, upperInput.denominator);
  if (compareRational(lower, upper) >= 0) throw new RangeError("The analysis interval must have positive width.");
  const tolerance = options.tolerance ?? exactRational(1n, 1_000_000_000_000n);
  const maxDegree = options.maxDegree ?? 24;
  const maxIterations = options.maxIterations ?? 512;
  const precision = options.precision ?? 50;
  const maxTanPoles = options.maxTanPoles ?? 256;
  if (tolerance.numerator <= 0n) throw new RangeError("tolerance must be positive.");
  if (!Number.isSafeInteger(maxDegree) || maxDegree < 1 || maxDegree > 128) throw new RangeError("maxDegree must be in [1, 128].");
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > 20_000) throw new RangeError("maxIterations must be in [1, 20000].");
  if (!Number.isSafeInteger(precision) || precision < 6 || precision > 900) throw new RangeError("precision must be in [6, 900].");
  if (!Number.isSafeInteger(maxTanPoles) || maxTanPoles < 1 || maxTanPoles > 100_000) throw new RangeError("maxTanPoles must be in [1, 100000].");

  const restrictions: RealDomainRestriction[] = [];
  let globallyUndefined = false;
  const polynomialOptions = { tolerance, maxDegree, maxIterations };

  const addPolynomialRestriction = (
    kind: RealDomainRestrictionKind,
    condition: RealDomainCondition,
    source: Expr,
  ): void => {
    try {
      const analysis = analyzePolynomialCondition(source, variable, lower, upper, kind, condition, polynomialOptions);
      restrictions.push({
        kind, condition, source, status: analysis.status, boundaries: analysis.boundaries,
        regions: analysis.regions,
        ...(analysis.unresolvedIntervals.length ? { unresolvedIntervals: analysis.unresolvedIntervals } : {}),
        ...(analysis.message ? { message: analysis.message } : {}),
      });
      if (analysis.alwaysViolated && analysis.status === "complete") globallyUndefined = true;
    } catch (error) {
      restrictions.push(makeUnsupported(
        kind, condition, source,
        error instanceof Error ? error.message : "Could not analyze this domain restriction.",
      ));
    }
  };

  const visit = (node: Expr): void => {
    switch (node.kind) {
      case "Integer":
      case "Rational":
      case "Symbol":
        return;
      case "Add":
        node.terms.forEach(visit);
        return;
      case "Mul":
        node.factors.forEach(visit);
        return;
      case "Pow": {
        visit(node.base);
        visit(node.exponent);
        if (node.exponent.kind === "Integer") {
          if (node.exponent.value < 0n) addPolynomialRestriction("denominator", "nonzero", node.base);
          return;
        }
        if (node.exponent.kind === "Rational") {
          const numerator = node.exponent.numerator;
          const denominator = node.exponent.denominator;
          if (denominator % 2n === 0n) {
            addPolynomialRestriction("power", numerator < 0n ? "positive" : "nonnegative", node.base);
          } else if (numerator < 0n) {
            addPolynomialRestriction("power", "nonzero", node.base);
          }
          return;
        }
        // For a general real exponent, the conventional real-valued branch requires base > 0.
        addPolynomialRestriction("power", "positive", node.base);
        return;
      }
      case "Function": {
        if (node.args.length !== 1) {
          restrictions.push(makeUnsupported("power", "positive", node, `Function '${node.name}' does not have one argument.`));
          node.args.forEach(visit);
          return;
        }
        const argument = node.args[0]!;
        switch (node.name) {
          case "sqrt": addPolynomialRestriction("sqrt", "nonnegative", argument); break;
          case "log":
          case "ln": addPolynomialRestriction("log", "positive", argument); break;
          case "tan": {
            try {
              const result = analyzeTangentPoles(argument, variable, lower, upper, precision, maxTanPoles);
              restrictions.push({
                kind: "tan", condition: "avoid-tan-poles", source: argument,
                status: result.status,
                boundaries: result.boundaries,
                ...(result.message ? { message: result.message } : {}),
              });
            } catch (error) {
              restrictions.push(makeUnsupported(
                "tan", "avoid-tan-poles", argument,
                error instanceof Error ? error.message : "Could not isolate tangent poles.",
              ));
            }
            break;
          }
          case "sin":
          case "cos":
          case "cbrt":
          case "atan":
          case "exp":
          case "abs":
          case "sign":
            break;
          default:
            restrictions.push(makeUnsupported("power", "positive", node, `Unknown real-domain semantics for function '${node.name}'.`));
        }
        visit(argument);
        return;
      }
    }
  };

  visit(expression);
  const domainRegions = buildGlobalDomainRegions(restrictions, variable, lower, upper);
  const hasUnsupported = restrictions.some(item => item.status === "unsupported");
  const hasPartial = restrictions.some(item => item.status === "partial");
  const noPossibleDomainPoint = domainRegions.every(region => region.state === "excluded");
  const status: RealDomainAnalysisStatus = globallyUndefined || (!hasUnsupported && !hasPartial && noPossibleDomainPoint)
    ? "undefined"
    : hasUnsupported
      ? "unsupported"
      : hasPartial
        ? "partial"
        : "complete";
  return {
    status,
    variable,
    interval: { lower, upper },
    restrictions,
    domainRegions,
    ...(status === "undefined" ? { message: "The expression has no real-domain points in the requested interval." } : {}),
    ...(status === "unsupported" ? { message: "Some domain restrictions are outside the certified subset; see the affected restriction messages and global region states." } : {}),
    ...(status === "partial" ? { message: "Some boundary membership or isolation detail remains unresolved; see restriction messages and uncertain global regions." } : {}),
  };
}
