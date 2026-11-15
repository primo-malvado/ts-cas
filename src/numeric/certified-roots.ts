/**
 * Certification for real roots of supported expressions. Exact univariate rational
 * polynomials use Sturm isolation (including multiple roots); other supported expressions
 * use conservative interval subdivision and interval Newton for simple roots.
 *
 * The function is deliberately conservative:
 * - every accepted root has a sign-changing bracket;
 * - the derivative interval excludes zero, proving strict monotonicity there;
 * - interval evaluation excludes roots from discarded regions;
 * - unresolved/domain-singular regions force status "partial".
 *
 * This module certifies the documented real interval subset, including exp/ln and
 * sin/cos/tan with certified pi-based reduction for finite arguments up to |x| <= 1e30.
 * Polynomial roots, including multiple roots, are
 * handled by the exact Sturm-based polynomial root solver instead.
 */
import { numericParts, type Expr } from "../core/expr.js";
import { differentiate } from "../calculus/differentiate.js";
import { polynomialFromExpr, polynomialDegree } from "../algebra/polynomial.js";
import {
  exactRational,
  isolateRealRootsExactInInterval,
  type ExactRational,
} from "./sturm.js";
import {
  decimal,
  decimalAdd,
  decimalCompare,
  decimalDivide,
  decimalMultiply,
  decimalSubtract,
  decimalToString,
  type BigDecimal,
  type DecimalInput,
} from "./decimal.js";
import {
  decimalInterval,
  decimalIntervalContainsZero,
  decimalIntervalDivide,
  decimalIntervalSubtract,
  decimalIntervalWidth,
  evaluateDecimalInterval,
  type DecimalInterval,
  type DecimalIntervalBindings,
} from "./interval.js";

export type CertifiedRootIsolationStatus = "certified" | "none" | "partial" | "unsupported";

export interface CertifiedRootBracket {
  readonly lower: BigDecimal;
  readonly lowerText: string;
  readonly upper: BigDecimal;
  readonly upperText: string;
  readonly midpoint: BigDecimal;
  readonly midpointText: string;
  readonly width: BigDecimal;
  readonly widthText: string;
  /** True: exactly one distinct real root is contained in this bracket. */
  readonly unique: true;
  /** True: exactly one distinct real root is certified in this bracket. */
  readonly certified: true;
  /** Algebraic multiplicity, when available from exact polynomial analysis. */
  readonly multiplicity?: number;
  /** Certification path used for this bracket. */
  readonly method?: "interval-newton" | "exact-sturm";
  readonly evaluations: number;
}

export interface UnresolvedRootRegion {
  readonly lower: BigDecimal;
  readonly lowerText: string;
  readonly upper: BigDecimal;
  readonly upperText: string;
  readonly reason: string;
}

export interface CertifiedRootIsolationOptions {
  /** Significant decimal digits used by outward-rounded interval evaluation. Default: 50. */
  readonly precision?: number;
  /** Maximum absolute width of each certified root bracket. Default: 10^-(precision-5). */
  readonly tolerance?: DecimalInput;
  /** Maximum number of subdivisions. Default: max(10000, precision*500). */
  readonly maxSubdivisions?: number;
  /** Symbols other than the root variable may be fixed to exact values or input intervals. */
  readonly bindings?: DecimalIntervalBindings;
}

export interface CertifiedRootIsolationResult {
  readonly status: CertifiedRootIsolationStatus;
  readonly certified: boolean;
  readonly variable: string;
  readonly precision: number;
  readonly searchInterval: {
    readonly lowerText: string;
    readonly upperText: string;
  };
  readonly roots: readonly CertifiedRootBracket[];
  readonly unresolved: readonly UnresolvedRootRegion[];
  readonly subdivisions: number;
  readonly evaluations: number;
  readonly message: string;
}

interface Cell {
  readonly lower: BigDecimal;
  readonly upper: BigDecimal;
  readonly depth: number;
}

type Sign = -1 | 0 | 1 | null;

const ZERO = decimal(0n);
const TWO = decimal(2n);

function signOf(interval: DecimalInterval): Sign {
  if (decimalCompare(interval.lower, ZERO) > 0) return 1;
  if (decimalCompare(interval.upper, ZERO) < 0) return -1;
  if (decimalCompare(interval.lower, ZERO) === 0 && decimalCompare(interval.upper, ZERO) === 0) return 0;
  return null;
}

function intervalExcludesZero(interval: DecimalInterval): boolean {
  return decimalCompare(interval.lower, ZERO) > 0 || decimalCompare(interval.upper, ZERO) < 0;
}

function derivativeExcludesZero(interval: DecimalInterval): boolean {
  return intervalExcludesZero(interval);
}

/**
 * Checks whether the expression is smooth on the full interval. This is required
 * before using derivative-based monotonicity and interval Newton. In particular,
 * abs(u) is only treated as smooth when the interval image of u excludes zero;
 * sign(u) is never accepted as a smooth expression.
 */
function smoothOnInterval(
  expression: Expr,
  variable: string,
  lower: BigDecimal,
  upper: BigDecimal,
  bindings: DecimalIntervalBindings,
  precision: number,
): boolean {
  const visit = (node: Expr): boolean => {
    switch (node.kind) {
      case "Integer":
      case "Rational":
      case "Symbol":
        return true;
      case "Add":
        return node.terms.every(visit);
      case "Mul":
        return node.factors.every(visit);
      case "Pow":
        return visit(node.base) && visit(node.exponent);
      case "Function": {
        if (node.args.length !== 1) return false;
        const arg = node.args[0]!;
        if (node.name === "sign") return false;
        if (node.name === "abs") {
          try {
            const range = evaluateDecimalInterval(arg, {
              ...bindings,
              [variable]: decimalInterval(lower, upper),
            }, { precision }).interval;
            if (decimalIntervalContainsZero(range)) return false;
          } catch {
            return false;
          }
        }
        return visit(arg);
      }
    }
  };
  return visit(expression);
}

type NewtonStep =
  | { readonly kind: "excluded" }
  | { readonly kind: "contracted"; readonly cell: Cell }
  | { readonly kind: "unchanged" }
  | { readonly kind: "inapplicable" };

/**
 * Applies one sound interval-Newton step. When the Newton image misses the cell,
 * the cell contains no root. Otherwise, every root in the original cell must lie
 * in its intersection with the Newton image. This can contract even before an
 * endpoint sign change has become numerically visible.
 */
function intervalNewtonStep(
  expression: Expr,
  variable: string,
  cell: Cell,
  derivativeRange: DecimalInterval,
  baseBindings: DecimalIntervalBindings,
  precision: number,
  evaluations: { count: number },
): NewtonStep {
  const center = midpoint(cell.lower, cell.upper, precision);
  if (decimalCompare(center, cell.lower) === 0 || decimalCompare(center, cell.upper) === 0) {
    return { kind: "inapplicable" };
  }

  let fAtCenter: DecimalInterval;
  try {
    fAtCenter = evaluateDecimalInterval(expression, {
      ...baseBindings,
      [variable]: decimalInterval(center),
    }, { precision }).interval;
    evaluations.count++;
  } catch {
    return { kind: "inapplicable" };
  }

  let newtonImage: DecimalInterval;
  try {
    newtonImage = decimalIntervalSubtract(
      decimalInterval(center),
      decimalIntervalDivide(fAtCenter, derivativeRange, precision),
      precision,
    );
  } catch {
    return { kind: "inapplicable" };
  }

  const newLower = decimalCompare(cell.lower, newtonImage.lower) >= 0
    ? cell.lower
    : newtonImage.lower;
  const newUpper = decimalCompare(cell.upper, newtonImage.upper) <= 0
    ? cell.upper
    : newtonImage.upper;
  if (decimalCompare(newLower, newUpper) > 0) return { kind: "excluded" };
  if (decimalCompare(newLower, newUpper) === 0) {
    // A single-point intersection is not enough by itself to certify existence.
    // It is nevertheless a valid contraction; subsequent endpoint checks decide.
    return { kind: "contracted", cell: { lower: newLower, upper: newUpper, depth: cell.depth } };
  }

  const oldWidth = width(cell.lower, cell.upper, precision);
  const newWidth = width(newLower, newUpper, precision);
  const contractionThreshold = decimalMultiply(oldWidth, decimal("0.8"), {
    precision: Math.min(1000, precision + 16),
    rounding: "ceil",
  });
  if (decimalCompare(newWidth, contractionThreshold) >= 0) return { kind: "unchanged" };
  return { kind: "contracted", cell: { lower: newLower, upper: newUpper, depth: cell.depth } };
}

function midpoint(a: BigDecimal, b: BigDecimal, precision: number): BigDecimal {
  const context = { precision: Math.min(1000, precision + 24), rounding: "half-even" as const };
  return decimalDivide(decimalAdd(a, b, context), TWO, context);
}

function width(a: BigDecimal, b: BigDecimal, precision: number): BigDecimal {
  return decimalIntervalWidth(decimalInterval(a, b), Math.min(1000, precision + 16));
}

function point(value: BigDecimal): DecimalInterval {
  return decimalInterval(value);
}

function createRootBracket(
  lower: BigDecimal,
  upper: BigDecimal,
  precision: number,
  evaluations: number,
): CertifiedRootBracket {
  const center = midpoint(lower, upper, precision);
  const rootWidth = width(lower, upper, precision);
  return {
    lower,
    lowerText: decimalToString(lower),
    upper,
    upperText: decimalToString(upper),
    midpoint: center,
    midpointText: decimalToString(center),
    width: rootWidth,
    widthText: decimalToString(rootWidth),
    unique: true,
    certified: true,
    method: "interval-newton",
    multiplicity: 1,
    evaluations,
  };
}

function unsupportedFunction(expression: Expr): string | null {
  switch (expression.kind) {
    case "Integer":
    case "Rational":
    case "Symbol":
      return null;
    case "Add":
      for (const term of expression.terms) {
        const issue = unsupportedFunction(term);
        if (issue) return issue;
      }
      return null;
    case "Mul":
      for (const factor of expression.factors) {
        const issue = unsupportedFunction(factor);
        if (issue) return issue;
      }
      return null;
    case "Pow":
      if (expression.exponent.kind === "Integer") {
        // All integer powers are supported, subject to the interval power bounds.
      } else if (
        expression.exponent.kind === "Rational" &&
        expression.exponent.numerator % expression.exponent.denominator === 0n
      ) {
        // Rational nodes are reduced and may still represent an integer.
      } else {
        return "Certified root isolation currently requires integer exponents.";
      }
      return unsupportedFunction(expression.base);
    case "Function":
      if (expression.args.length !== 1) return `Function '${expression.name}' has unsupported arity.`;
      if (!["sqrt", "abs", "sign", "exp", "ln", "log", "sin", "cos", "tan"].includes(expression.name)) {
        return `Function '${expression.name}' has no certified interval extension in this version.`;
      }
      return unsupportedFunction(expression.args[0]!);
  }
}

function unresolvedRegion(lower: BigDecimal, upper: BigDecimal, reason: string): UnresolvedRootRegion {
  return {
    lower,
    lowerText: decimalToString(lower),
    upper,
    upperText: decimalToString(upper),
    reason,
  };
}

function decimalAsExactRational(value: BigDecimal): ExactRational | null {
  if (Math.abs(value.scale) > 5000) return null;
  return value.scale >= 0
    ? exactRational(value.coefficient, 10n ** BigInt(value.scale))
    : exactRational(value.coefficient * (10n ** BigInt(-value.scale)), 1n);
}

function exactRationalAsDecimal(
  value: ExactRational,
  precision: number,
  rounding: "floor" | "ceil",
): BigDecimal {
  return decimalDivide(decimal(value.numerator), decimal(value.denominator), {
    precision: Math.min(1000, precision + 12),
    rounding,
  });
}

function absRational(value: ExactRational): ExactRational {
  return exactRational(value.numerator < 0n ? -value.numerator : value.numerator, value.denominator);
}

function compareRational(a: ExactRational, b: ExactRational): number {
  const left = a.numerator * b.denominator;
  const right = b.numerator * a.denominator;
  return left < right ? -1 : left > right ? 1 : 0;
}

function divideRational(a: ExactRational, b: ExactRational): ExactRational {
  if (b.numerator === 0n) throw new RangeError("Exact rational division by zero.");
  return exactRational(a.numerator * b.denominator, a.denominator * b.numerator);
}

/**
 * Attempts exact single-variable polynomial isolation. Returns null when the expression
 * is not a polynomial in the requested variable, has symbolic coefficients, or exceeds
 * the conservative degree/representation limits. In those cases the interval solver runs.
 */
function certifyPolynomialRootsExact(
  expression: Expr,
  variable: string,
  lower: BigDecimal,
  upper: BigDecimal,
  precision: number,
  tolerance: BigDecimal,
  maxSubdivisions: number,
): CertifiedRootIsolationResult | null {
  let polynomial;
  try {
    polynomial = polynomialFromExpr(expression);
  } catch {
    return null;
  }
  for (const term of polynomial.terms.values()) {
    if ([...term.monomial.powers.keys()].some(name => name !== variable)) return null;
  }

  const degree = polynomialDegree(polynomial, variable);
  if (degree < 0) {
    // The zero polynomial has a continuum of roots, not a finite set of isolating brackets.
    return {
      status: "partial",
      certified: false,
      variable,
      precision,
      searchInterval: { lowerText: decimalToString(lower), upperText: decimalToString(upper) },
      roots: [],
      unresolved: [unresolvedRegion(lower, upper, "The zero polynomial vanishes throughout the interval; its root set is not discrete and cannot be represented by finitely many isolated brackets.")],
      subdivisions: 0,
      evaluations: 0,
      message: "The polynomial is identically zero, so every point in the search interval is a root.",
    };
  }
  // Match the conservative exact Sturm degree limit before constructing a dense array of
  // coefficients. Very large exponents must not trigger an accidental huge allocation.
  if (degree > 24) return null;

  const exactLower = decimalAsExactRational(lower);
  const exactUpper = decimalAsExactRational(upper);
  const exactTolerance = decimalAsExactRational(tolerance);
  if (!exactLower || !exactUpper || !exactTolerance) return null;

  const coefficients: ExactRational[] = Array.from({ length: degree + 1 }, () => exactRational(0n));
  for (const term of polynomial.terms.values()) {
    const exponent = term.monomial.powers.get(variable) ?? 0;
    const [numerator, denominator] = numericParts(term.coefficient);
    coefficients[exponent] = exactRational(
      coefficients[exponent]!.numerator * denominator + numerator * coefficients[exponent]!.denominator,
      coefficients[exponent]!.denominator * denominator,
    );
  }

  // The Sturm implementation uses a relative width criterion. Scale the requested absolute
  // tolerance down by the largest magnitude in the search interval to preserve its guarantee.
  const one = exactRational(1n);
  const maxMagnitude = [one, absRational(exactLower), absRational(exactUpper)]
    .reduce((largest, value) => compareRational(value, largest) > 0 ? value : largest, one);
  const sturmTolerance = divideRational(exactTolerance, maxMagnitude);

  let isolated;
  try {
    isolated = isolateRealRootsExactInInterval(
      coefficients,
      exactLower,
      exactUpper,
      sturmTolerance,
      24,
      Math.min(20_000, Math.max(1, maxSubdivisions)),
    );
  } catch (error) {
    // Exact polynomial solving is an optimization/certification path, not a reason to
    // reject an expression the general interval method might still handle.
    if (error instanceof RangeError || error instanceof TypeError) return null;
    throw error;
  }

  const roots: CertifiedRootBracket[] = isolated.roots.map(root => {
    const rootLower = exactRationalAsDecimal(root.lower, precision, "floor");
    const rootUpper = exactRationalAsDecimal(root.upper, precision, "ceil");
    const rootMidpoint = midpoint(rootLower, rootUpper, precision);
    const rootWidth = width(rootLower, rootUpper, precision);
    return {
      lower: rootLower,
      lowerText: decimalToString(rootLower),
      upper: rootUpper,
      upperText: decimalToString(rootUpper),
      midpoint: rootMidpoint,
      midpointText: decimalToString(rootMidpoint),
      width: rootWidth,
      widthText: decimalToString(rootWidth),
      unique: true,
      certified: true,
      multiplicity: root.multiplicity,
      method: "exact-sturm",
      evaluations: 0,
    };
  });
  const unresolved = isolated.unresolvedIntervals.map(region => unresolvedRegion(
    exactRationalAsDecimal(region.lower, precision, "floor"),
    exactRationalAsDecimal(region.upper, precision, "ceil"),
    `Exact Sturm isolation stopped with ${region.distinctRootCount} distinct root(s) still in this region.`,
  ));
  for (const root of roots) {
    if (decimalCompare(root.width, tolerance) > 0) {
      unresolved.push(unresolvedRegion(
        root.lower,
        root.upper,
        "The root is isolated uniquely, but outward decimal conversion leaves its bracket wider than the requested tolerance.",
      ));
    }
  }
  const subdivisions = isolated.roots.reduce((total, root) => total + root.iterations, 0) + unresolved.length;
  const complete = unresolved.length === 0 && roots.length === isolated.totalDistinctRealRoots;
  const status: CertifiedRootIsolationStatus = complete
    ? roots.length === 0 ? "none" : "certified"
    : "partial";
  return {
    status,
    certified: status === "certified" || status === "none",
    variable,
    precision,
    searchInterval: { lowerText: decimalToString(lower), upperText: decimalToString(upper) },
    roots,
    unresolved,
    subdivisions,
    evaluations: 0,
    message: status === "certified"
      ? `Exact Sturm analysis certified ${roots.length} distinct real root(s) in the requested interval, including their multiplicities.`
      : status === "none"
        ? "Exact Sturm analysis proves that the polynomial has no real roots in the requested interval."
        : `Exact Sturm analysis isolated ${roots.length} root bracket(s), but ${unresolved.length} region(s) or requested-width target(s) remain unresolved.`,
  };
}

/**
 * Certifies real roots inside a finite interval.
 *
 * Single-variable polynomials with exact rational coefficients use Sturm sequences,
 * including square-free factorization and multiplicity. Other expressions use a
 * conservative interval method: a simple-root bracket needs a sign/exact-endpoint proof,
 * smoothness on the bracket, and a derivative interval that excludes zero.
 *
 * Regions the selected method cannot fully resolve cause "partial" rather than a
 * false claim of completeness.
 */
export function certifyRealRoots(
  expression: Expr,
  variable: string,
  lowerInput: DecimalInput,
  upperInput: DecimalInput,
  options: CertifiedRootIsolationOptions = {},
): CertifiedRootIsolationResult {
  if (!variable.trim()) throw new TypeError("Variable must not be empty.");
  const precision = options.precision ?? 50;
  if (!Number.isSafeInteger(precision) || precision < 2 || precision > 1000) {
    throw new RangeError("Certified root precision must be an integer between 2 and 1000.");
  }
  const tolerance = options.tolerance === undefined
    ? decimal(`1e-${Math.max(2, precision - 5)}`)
    : decimal(options.tolerance);
  if (tolerance.coefficient <= 0n) throw new RangeError("Certified root tolerance must be positive.");
  const maxSubdivisions = options.maxSubdivisions ?? Math.max(10_000, precision * 500);
  if (!Number.isSafeInteger(maxSubdivisions) || maxSubdivisions < 1 || maxSubdivisions > 2_000_000) {
    throw new RangeError("maxSubdivisions must be an integer between 1 and 2000000.");
  }
  let lower = decimal(lowerInput);
  let upper = decimal(upperInput);
  if (decimalCompare(lower, upper) === 0) throw new RangeError("Certified root search interval must have distinct endpoints.");
  if (decimalCompare(lower, upper) > 0) [lower, upper] = [upper, lower];

  const effectiveBindings = options.bindings ?? {};
  if (Object.keys(effectiveBindings).length === 0) {
    const exactPolynomialResult = certifyPolynomialRootsExact(
      expression,
      variable,
      lower,
      upper,
      precision,
      tolerance,
      maxSubdivisions,
    );
    if (exactPolynomialResult !== null) return exactPolynomialResult;
  }

  const issue = unsupportedFunction(expression);
  if (issue) {
    return {
      status: "unsupported", certified: false, variable, precision,
      searchInterval: { lowerText: decimalToString(lower), upperText: decimalToString(upper) },
      roots: [], unresolved: [], subdivisions: 0, evaluations: 0,
      message: issue,
    };
  }

  let derivative: Expr;
  try {
    derivative = differentiate(expression, variable);
    // Preflight the derivative's interval-language support.
    const derivativeIssue = unsupportedFunction(derivative);
    if (derivativeIssue) {
      return {
        status: "unsupported", certified: false, variable, precision,
        searchInterval: { lowerText: decimalToString(lower), upperText: decimalToString(upper) },
        roots: [], unresolved: [], subdivisions: 0, evaluations: 0,
        message: `The derivative needed for certification is unsupported: ${derivativeIssue}`,
      };
    }
  } catch (error) {
    return {
      status: "unsupported", certified: false, variable, precision,
      searchInterval: { lowerText: decimalToString(lower), upperText: decimalToString(upper) },
      roots: [], unresolved: [], subdivisions: 0, evaluations: 0,
      message: error instanceof Error ? error.message : "Could not differentiate the expression for certification.",
    };
  }

  const baseBindings = options.bindings ?? {};
  const intervalOptions = { precision };
  let evaluations = 0;
  const contractorEvaluations = { get count() { return evaluations; }, set count(value: number) { evaluations = value; } };
  const cache = new Map<string, DecimalInterval>();
  const evalInterval = (expr: Expr, a: BigDecimal, b: BigDecimal): DecimalInterval => {
    evaluations++;
    const key = `${expr === expression ? "f" : "d"}:${decimalToString(a)}:${decimalToString(b)}`;
    const cached = expr === expression ? cache.get(key) : undefined;
    if (cached) return cached;
    const result = evaluateDecimalInterval(expr, {
      ...baseBindings,
      [variable]: decimalInterval(a, b),
    }, intervalOptions).interval;
    if (expr === expression) cache.set(key, result);
    return result;
  };
  const evalPoint = (expr: Expr, x: BigDecimal): Sign => signOf(evalInterval(expr, x, x));

  const roots: CertifiedRootBracket[] = [];
  const unresolved: UnresolvedRootRegion[] = [];
  const stack: Cell[] = [{ lower, upper, depth: 0 }];
  let subdivisions = 0;

  while (stack.length > 0) {
    let cell = stack.pop()!;
    let fRange: DecimalInterval;
    let dRange: DecimalInterval;
    try {
      fRange = evalInterval(expression, cell.lower, cell.upper);
      if (intervalExcludesZero(fRange)) continue;
      dRange = evalInterval(derivative, cell.lower, cell.upper);
    } catch (error) {
      const cellWidth = width(cell.lower, cell.upper, precision);
      if (decimalCompare(cellWidth, tolerance) <= 0 || subdivisions >= maxSubdivisions) {
        unresolved.push(unresolvedRegion(
          cell.lower, cell.upper,
          error instanceof Error ? error.message : "Interval evaluation failed.",
        ));
        continue;
      }
      const mid = midpoint(cell.lower, cell.upper, precision);
      if (decimalCompare(mid, cell.lower) === 0 || decimalCompare(mid, cell.upper) === 0) {
        unresolved.push(unresolvedRegion(cell.lower, cell.upper, "Decimal precision cannot represent a narrower subdivision."));
        continue;
      }
      subdivisions++;
      stack.push({ lower: mid, upper: cell.upper, depth: cell.depth + 1 });
      stack.push({ lower: cell.lower, upper: mid, depth: cell.depth + 1 });
      continue;
    }

    let smooth = smoothOnInterval(expression, variable, cell.lower, cell.upper, baseBindings, precision);
    let derivativeSignKnown = derivativeExcludesZero(dRange) && smooth;
    let leftSign: Sign;
    let rightSign: Sign;
    try {
      leftSign = evalPoint(expression, cell.lower);
      rightSign = evalPoint(expression, cell.upper);
    } catch (error) {
      unresolved.push(unresolvedRegion(
        cell.lower, cell.upper,
        error instanceof Error ? error.message : "Endpoint evaluation failed.",
      ));
      continue;
    }

    const signsBracketRoot = (left: Sign, right: Sign): boolean =>
      left === 0 || right === 0 ||
      (left !== null && right !== null && left !== right);

    // Interval Newton can either exclude a cell or contract it before sign-change
    // isolation. A contraction is accepted only when it preserves an existing
    // sign-changing proof, or while there is still room to subdivide later. This
    // prevents over-contracting below the precision at which endpoint signs are
    // distinguishable. Never apply it across a detected non-smooth point.
    let newtonExcluded = false;
    if (derivativeSignKnown) {
      for (let attempt = 0; attempt < 12; attempt++) {
        if (decimalCompare(width(cell.lower, cell.upper, precision), tolerance) <= 0) break;
        const step = intervalNewtonStep(
          expression,
          variable,
          cell,
          dRange,
          baseBindings,
          precision,
          contractorEvaluations,
        );
        if (step.kind === "excluded") {
          newtonExcluded = true;
          break;
        }
        if (step.kind !== "contracted") break;
        const candidate = step.cell;
        const candidateWidth = width(candidate.lower, candidate.upper, precision);
        const currentHasBracket = signsBracketRoot(leftSign, rightSign);
        if (
          decimalCompare(candidateWidth, tolerance) <= 0 &&
          !currentHasBracket
        ) {
          // Keep the broader cell. Subdivision can recover a visible sign change.
          break;
        }
        let candidateLeft: Sign;
        let candidateRight: Sign;
        try {
          candidateLeft = evalPoint(expression, candidate.lower);
          candidateRight = evalPoint(expression, candidate.upper);
        } catch {
          break;
        }
        const candidateHasBracket = signsBracketRoot(candidateLeft, candidateRight);
        if (currentHasBracket && !candidateHasBracket) break;

        cell = candidate;
        leftSign = candidateLeft;
        rightSign = candidateRight;
        try {
          fRange = evalInterval(expression, cell.lower, cell.upper);
          if (intervalExcludesZero(fRange)) break;
          dRange = evalInterval(derivative, cell.lower, cell.upper);
        } catch {
          break;
        }
        smooth = smoothOnInterval(expression, variable, cell.lower, cell.upper, baseBindings, precision);
        derivativeSignKnown = derivativeExcludesZero(dRange) && smooth;
        if (!derivativeSignKnown) break;
        if (decimalCompare(width(cell.lower, cell.upper, precision), tolerance) <= 0) break;
      }
    }

    if (newtonExcluded || intervalExcludesZero(fRange)) continue;

    if (derivativeSignKnown) {
      // Strict monotonicity plus a certified zero endpoint means that endpoint
      // is the only root in this cell. Adjacent cells are deduplicated below.
      if (leftSign === 0) {
        roots.push(createRootBracket(cell.lower, cell.lower, precision, evaluations));
        continue;
      }
      if (rightSign === 0) {
        roots.push(createRootBracket(cell.upper, cell.upper, precision, evaluations));
        continue;
      }
      if (leftSign !== null && rightSign !== null && leftSign === rightSign) {
        continue;
      }
      if (leftSign !== null && rightSign !== null && leftSign !== rightSign) {
        const cellWidth = width(cell.lower, cell.upper, precision);
        if (decimalCompare(cellWidth, tolerance) <= 0) {
          roots.push(createRootBracket(cell.lower, cell.upper, precision, evaluations));
          continue;
        }
      }
    }

    const cellWidth = width(cell.lower, cell.upper, precision);
    if (decimalCompare(cellWidth, tolerance) <= 0 || subdivisions >= maxSubdivisions) {
      unresolved.push(unresolvedRegion(
        cell.lower, cell.upper,
        derivativeSignKnown
          ? "Endpoint signs could not be determined sharply enough."
          : "The derivative interval contains zero; uniqueness of a simple root could not be certified.",
      ));
      continue;
    }

    const mid = midpoint(cell.lower, cell.upper, precision);
    if (decimalCompare(mid, cell.lower) === 0 || decimalCompare(mid, cell.upper) === 0) {
      unresolved.push(unresolvedRegion(cell.lower, cell.upper, "Decimal precision cannot represent a narrower subdivision."));
      continue;
    }

    // If the function is known to be strictly monotone, interval range overestimation
    // cannot conceal a second root; subdivision will reduce to one sign-changing side.
    subdivisions++;
    stack.push({ lower: mid, upper: cell.upper, depth: cell.depth + 1 });
    stack.push({ lower: cell.lower, upper: mid, depth: cell.depth + 1 });
  }

  roots.sort((a, b) => decimalCompare(a.lower, b.lower));
  const deduplicated: CertifiedRootBracket[] = [];
  for (const root of roots) {
    const previous = deduplicated[deduplicated.length - 1];
    if (
      previous &&
      decimalCompare(root.lower, previous.upper) <= 0 &&
      decimalCompare(root.upper, previous.lower) >= 0
    ) {
      const lowerRoot = decimalCompare(root.width, previous.width) < 0 ? root : previous;
      deduplicated[deduplicated.length - 1] = {
        ...lowerRoot,
        lower: decimalCompare(previous.lower, root.lower) <= 0 ? previous.lower : root.lower,
        lowerText: decimalToString(decimalCompare(previous.lower, root.lower) <= 0 ? previous.lower : root.lower),
        upper: decimalCompare(previous.upper, root.upper) >= 0 ? previous.upper : root.upper,
        upperText: decimalToString(decimalCompare(previous.upper, root.upper) >= 0 ? previous.upper : root.upper),
        width: width(
          decimalCompare(previous.lower, root.lower) <= 0 ? previous.lower : root.lower,
          decimalCompare(previous.upper, root.upper) >= 0 ? previous.upper : root.upper,
          precision,
        ),
        widthText: decimalToString(width(
          decimalCompare(previous.lower, root.lower) <= 0 ? previous.lower : root.lower,
          decimalCompare(previous.upper, root.upper) >= 0 ? previous.upper : root.upper,
          precision,
        )),
      };
    } else {
      deduplicated.push(root);
    }
  }

  const status: CertifiedRootIsolationStatus = unresolved.length > 0
    ? "partial"
    : deduplicated.length > 0
      ? "certified"
      : "none";
  const completeText = status === "certified"
    ? `Certified ${deduplicated.length} distinct simple root bracket(s); all other subintervals were excluded.`
    : status === "none"
      ? "No roots exist in the search interval for the supported expression, as certified by interval exclusion."
      : `Certified ${deduplicated.length} root bracket(s), but ${unresolved.length} region(s) remain unresolved.`;
  return {
    status,
    certified: status === "certified" || status === "none",
    variable,
    precision,
    searchInterval: { lowerText: decimalToString(lower), upperText: decimalToString(upper) },
    roots: deduplicated,
    unresolved,
    subdivisions,
    evaluations,
    message: completeText,
  };
}
