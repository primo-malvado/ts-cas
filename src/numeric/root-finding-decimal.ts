/**
 * Arbitrary-precision real root finding for general expressions.
 *
 * A bracketed bisection solver that evaluates every iterate with the BigInt-backed
 * decimal engine. Unlike the polynomial solver, it also accepts transcendental
 * expressions. It is numerically reliable when the function is continuous on the
 * supplied interval and the endpoint values have opposite signs; it is not a
 * formal proof that the interval contains exactly one root.
 */
import type { Expr } from "../core/expr.js";
import {
  decimal,
  decimalAbs,
  decimalAdd,
  decimalCompare,
  decimalDivide,
  decimalNegate,
  decimalRound,
  decimalSubtract,
  decimalToString,
  evaluateDecimal,
  type BigDecimal,
  type DecimalBindings,
  type DecimalContext,
  type DecimalInput,
  type DecimalRoundingMode,
} from "./decimal.js";

export type DecimalRootFindingStatus =
  | "converged"
  | "max-iterations"
  | "no-bracket"
  | "precision-limit";

export interface DecimalRootFindingOptions {
  /** Significant decimal digits. Default 50; supported range 2..1000. */
  readonly precision?: number;
  readonly rounding?: DecimalRoundingMode;
  /** Absolute width target for the root interval. Defaults to 10^-(precision+2). */
  readonly tolerance?: DecimalInput;
  /** Bisection iteration budget. Default max(200, 4*precision). */
  readonly maxIterations?: number;
}

export interface DecimalRootFindingResult {
  readonly status: DecimalRootFindingStatus;
  readonly converged: boolean;
  readonly precision: number;
  readonly method: "decimal-bisection";
  readonly iterations: number;
  readonly evaluations: number;
  readonly lower: BigDecimal;
  readonly lowerText: string;
  readonly upper: BigDecimal;
  readonly upperText: string;
  /** Present when a bracket exists. The reported value is rounded to requested precision. */
  readonly root?: BigDecimal;
  readonly rootText?: string;
  /** Half-width of the final isolating bracket, a simple absolute location-error bound. */
  readonly estimatedError: BigDecimal;
  readonly estimatedErrorText: string;
  /** Absolute function value at root estimate, not a formal error bound. */
  readonly residual?: BigDecimal;
  readonly residualText?: string;
  readonly message: string;
}

const ZERO = decimal(0n);
const ONE = decimal(1n);
const TWO = decimal(2n);
const MAX_PRECISION = 1000;

function validateVariable(variable: string): void {
  if (!variable.trim()) throw new TypeError("Variable must not be empty.");
}

function validatePrecision(precision: number): void {
  if (!Number.isSafeInteger(precision) || precision < 2 || precision > MAX_PRECISION) {
    throw new RangeError(`Precision must be an integer between 2 and ${MAX_PRECISION}.`);
  }
}

function midpoint(a: BigDecimal, b: BigDecimal, context: DecimalContext): BigDecimal {
  return decimalDivide(decimalAdd(a, b, context), TWO, context);
}

function width(a: BigDecimal, b: BigDecimal, context: DecimalContext): BigDecimal {
  return decimalAbs(decimalSubtract(b, a, context));
}

function makeResult(args: {
  readonly status: DecimalRootFindingStatus;
  readonly precision: number;
  readonly iterations: number;
  readonly evaluations: number;
  readonly lower: BigDecimal;
  readonly upper: BigDecimal;
  readonly root?: BigDecimal;
  readonly residual?: BigDecimal;
  readonly rounding?: DecimalRoundingMode;
  readonly message: string;
}): DecimalRootFindingResult {
  const { precision } = args;
  const rounding = args.rounding ?? "half-even";
  // Keep the bracket endpoints at their working precision. Rounding endpoints
  // could move them inward and destroy the interval's bracketing property.
  const lower = args.lower;
  const upper = args.upper;
  const reportContext = { precision: Math.min(MAX_PRECISION, precision + 8), rounding };
  const estimatedError = decimalRound(
    decimalDivide(width(args.lower, args.upper, reportContext), TWO, reportContext),
    precision,
    rounding,
  );
  const base = {
    status: args.status,
    converged: args.status === "converged",
    precision,
    method: "decimal-bisection" as const,
    iterations: args.iterations,
    evaluations: args.evaluations,
    lower,
    lowerText: decimalToString(lower),
    upper,
    upperText: decimalToString(upper),
    estimatedError,
    estimatedErrorText: decimalToString(estimatedError),
    message: args.message,
  };
  const rootFields = args.root === undefined ? {} : (() => {
    const root = decimalRound(args.root!, precision, rounding);
    return { root, rootText: decimalToString(root) };
  })();
  const residualFields = args.residual === undefined ? {} : (() => {
    const residual = decimalRound(decimalAbs(args.residual!), precision, rounding);
    return { residual, residualText: decimalToString(residual) };
  })();
  return { ...base, ...rootFields, ...residualFields };
}

/**
 * Finds a real root within a sign-changing interval using arbitrary-precision
 * bisection. The interval must contain a continuous part of the function.
 */
export function solveRootDecimal(
  expression: Expr,
  variable: string,
  lowerInput: DecimalInput,
  upperInput: DecimalInput,
  bindings: DecimalBindings = {},
  options: DecimalRootFindingOptions = {},
): DecimalRootFindingResult {
  validateVariable(variable);
  const precision = options.precision ?? 50;
  validatePrecision(precision);
  const rounding = options.rounding ?? "half-even";
  const context: DecimalContext = { precision: Math.min(MAX_PRECISION, precision + 16), rounding };
  const tolerance = options.tolerance === undefined
    ? decimal(`1e-${precision + 2}`)
    : decimal(options.tolerance);
  if (tolerance.coefficient <= 0n) throw new RangeError("Root-finding tolerance must be positive.");
  const maxIterations = options.maxIterations ?? Math.max(200, precision * 4);
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > 20_000) {
    throw new RangeError("maxIterations must be an integer in [1, 20000].");
  }

  let lower = decimal(lowerInput);
  let upper = decimal(upperInput);
  if (decimalCompare(lower, upper) === 0) {
    throw new RangeError("Root-finding interval must have distinct endpoints.");
  }
  if (decimalCompare(lower, upper) > 0) [lower, upper] = [upper, lower];

  let evaluations = 0;
  const f = (x: BigDecimal): BigDecimal => {
    evaluations++;
    return evaluateDecimal(expression, { ...bindings, [variable]: x }, context);
  };

  let fLower = f(lower);
  let fUpper = f(upper);
  const signLower = decimalCompare(fLower, ZERO);
  const signUpper = decimalCompare(fUpper, ZERO);

  if (signLower === 0) {
    return makeResult({
      status: "converged", precision, rounding, iterations: 0, evaluations,
      lower, upper: lower, root: lower, residual: fLower,
      message: "The lower endpoint is a root at the configured decimal precision.",
    });
  }
  if (signUpper === 0) {
    return makeResult({
      status: "converged", precision, rounding, iterations: 0, evaluations,
      lower: upper, upper, root: upper, residual: fUpper,
      message: "The upper endpoint is a root at the configured decimal precision.",
    });
  }
  if ((signLower < 0) === (signUpper < 0)) {
    return makeResult({
      status: "no-bracket", precision, rounding, iterations: 0, evaluations,
      lower, upper,
      message: "The endpoint values do not have opposite signs; bisection cannot guarantee a root in this interval.",
    });
  }

  let latest = midpoint(lower, upper, context);
  let latestValue: BigDecimal;
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    latest = midpoint(lower, upper, context);
    if (decimalCompare(latest, lower) === 0 || decimalCompare(latest, upper) === 0) {
      const residual = f(latest);
      return makeResult({
        status: "precision-limit", precision, rounding, iterations: iteration - 1, evaluations,
        lower, upper, root: latest, residual,
        message: "The decimal precision is insufficient to represent a midpoint distinct from the bracket endpoints.",
      });
    }
    latestValue = f(latest);
    const signLatest = decimalCompare(latestValue, ZERO);
    if (signLatest === 0) {
      return makeResult({
        status: "converged", precision, rounding, iterations: iteration, evaluations,
        lower: latest, upper: latest, root: latest, residual: latestValue,
        message: "A root was evaluated as exactly zero at the configured working precision.",
      });
    }

    if (signLatest === signLower) {
      lower = latest;
      fLower = latestValue;
    } else {
      upper = latest;
      fUpper = latestValue;
    }
    if (decimalCompare(width(lower, upper, context), tolerance) <= 0) {
      const root = midpoint(lower, upper, context);
      const residual = f(root);
      return makeResult({
        status: "converged", precision, rounding, iterations: iteration, evaluations,
        lower, upper, root, residual,
        message: "The root interval reached the requested absolute width tolerance.",
      });
    }
  }

  const root = midpoint(lower, upper, context);
  const residual = f(root);
  return makeResult({
    status: "max-iterations", precision, rounding, iterations: maxIterations, evaluations,
    lower, upper, root, residual,
    message: "The iteration budget was exhausted before the requested root interval width was reached.",
  });
}
