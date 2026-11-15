/**
 * Arbitrary-precision numerical differentiation and integration.
 *
 * Uses the BigInt-backed decimal evaluator. Derivatives prefer an exact symbolic
 * derivative, with high-precision finite differences as a fallback. Integrals use
 * adaptive Gauss-Legendre quadrature (16/32 point comparison) on finite intervals.
 *
 * These routines are numerical, not formal proof procedures. Their reported error
 * is an estimate; convergence status must be checked by callers.
 */
import type { Expr } from "../core/expr.js";
import { differentiate } from "../calculus/differentiate.js";
import {
  decimal,
  decimalAbs,
  decimalAdd,
  decimalCompare,
  decimalDivide,
  decimalMultiply,
  decimalNegate,
  decimalPowerOfTen,
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

export type DecimalDerivativeMethod =
  | "symbolic"
  | "five-point-central"
  | "five-point-forward"
  | "five-point-backward";

export interface DecimalNumericalOptions {
  /** Significant decimal digits. Default 50; supported range 2..1000. */
  readonly precision?: number;
  /** Rounding used for reported/intermediate values. Defaults to half-even. */
  readonly rounding?: DecimalRoundingMode;
}

export interface DecimalDerivativeOptions extends DecimalNumericalOptions {
  /** Explicit positive finite-difference step. Otherwise chosen from precision and point scale. */
  readonly step?: DecimalInput;
  /** Absolute target for the estimated finite-difference error. */
  readonly tolerance?: DecimalInput;
  /** Try the symbolic derivative first (default true). */
  readonly preferSymbolic?: boolean;
}

export interface DecimalDerivativeResult {
  readonly value: BigDecimal;
  readonly valueText: string;
  /** Zero for a successfully evaluated symbolic derivative; estimated for finite differences. */
  readonly estimatedError: BigDecimal;
  readonly estimatedErrorText: string;
  readonly evaluations: number;
  readonly converged: boolean;
  readonly precision: number;
  readonly method: DecimalDerivativeMethod;
}

export interface DecimalIntegralOptions extends DecimalNumericalOptions {
  /** Absolute error target. Defaults to 10^-(precision-8), with a minimum of 1e-4. */
  readonly tolerance?: DecimalInput;
  /** Adaptive subdivision limit. Default 10; supported range 1..16. */
  readonly maxDepth?: number;
}

export interface DecimalNumericalIntegralResult {
  readonly value: BigDecimal;
  readonly valueText: string;
  readonly estimatedError: BigDecimal;
  readonly estimatedErrorText: string;
  readonly evaluations: number;
  readonly converged: boolean;
  readonly precision: number;
  readonly method: "adaptive-gauss-legendre-16/32";
}

interface GaussNode {
  readonly x: BigDecimal;
  readonly weight: BigDecimal;
}

interface QuadratureResult {
  readonly value: BigDecimal;
  readonly error: BigDecimal;
  readonly converged: boolean;
}

const ZERO = decimal(0n);
const ONE = decimal(1n);
const TWO = decimal(2n);
const THREE = decimal(3n);
const FOUR = decimal(4n);
const EIGHT = decimal(8n);
const TWELVE = decimal(12n);
const SIXTEEN = decimal(16n);
const TWENTY_FIVE = decimal(25n);
const THIRTY_SIX = decimal(36n);
const FORTY_EIGHT = decimal(48n);
const MAX_PRECISION = 1000;
const gaussCache = new Map<string, readonly GaussNode[]>();

function validatePrecision(precision: number): void {
  if (!Number.isSafeInteger(precision) || precision < 2 || precision > MAX_PRECISION) {
    throw new RangeError(`Precision must be an integer between 2 and ${MAX_PRECISION}.`);
  }
}

function validateVariable(variable: string): void {
  if (!variable.trim()) throw new TypeError("Variable must not be empty.");
}

function roundForResult(
  value: BigDecimal,
  precision: number,
  rounding: DecimalRoundingMode = "half-even",
): BigDecimal {
  return decimalRound(value, precision, rounding);
}

function absDifference(a: BigDecimal, b: BigDecimal, context: DecimalContext): BigDecimal {
  return decimalAbs(decimalSubtract(a, b, context));
}

function maxAbs(a: BigDecimal, b: BigDecimal): BigDecimal {
  return decimalCompare(decimalAbs(a), decimalAbs(b)) >= 0 ? decimalAbs(a) : decimalAbs(b);
}

function positiveScale(value: BigDecimal, context: DecimalContext): BigDecimal {
  return decimalCompare(decimalAbs(value), ONE) > 0 ? decimalAbs(value) : ONE;
}

function evaluateAt(
  expression: Expr,
  variable: string,
  x: BigDecimal,
  bindings: DecimalBindings,
  context: DecimalContext,
): BigDecimal {
  return evaluateDecimal(expression, { ...bindings, [variable]: x }, context);
}

function deriveAt(
  expression: Expr,
  variable: string,
  x: BigDecimal,
  bindings: DecimalBindings,
  context: DecimalContext,
): BigDecimal {
  const derivative = differentiate(expression, variable);
  return evaluateAt(derivative, variable, x, bindings, context);
}

function finiteDifferenceStep(x: BigDecimal, precision: number): BigDecimal {
  const scale = positiveScale(x, { precision: Math.min(MAX_PRECISION, precision + 8) });
  // A five-point stencil has O(h^4) truncation error. h ~= 10^(-p/4)
  // balances truncation and decimal-rounding error, with guard digits added below.
  return decimalMultiply(scale, decimalPowerOfTen(-Math.max(1, Math.ceil(precision / 4))));
}

function fivePointCentral(
  f: (x: BigDecimal) => BigDecimal,
  x: BigDecimal,
  h: BigDecimal,
  context: DecimalContext,
): BigDecimal {
  const twoH = decimalMultiply(TWO, h, context);
  const fm2 = f(decimalSubtract(x, twoH, context));
  const fm1 = f(decimalSubtract(x, h, context));
  const fp1 = f(decimalAdd(x, h, context));
  const fp2 = f(decimalAdd(x, twoH, context));
  const numerator = decimalAdd(
    decimalSubtract(fm2, decimalMultiply(EIGHT, fm1, context), context),
    decimalSubtract(decimalMultiply(EIGHT, fp1, context), fp2, context),
    context,
  );
  return decimalDivide(numerator, decimalMultiply(TWELVE, h, context), context);
}

function fivePointForward(
  f: (x: BigDecimal) => BigDecimal,
  x: BigDecimal,
  h: BigDecimal,
  f0: BigDecimal,
  context: DecimalContext,
): BigDecimal {
  const f1 = f(decimalAdd(x, h, context));
  const f2 = f(decimalAdd(x, decimalMultiply(TWO, h, context), context));
  const f3 = f(decimalAdd(x, decimalMultiply(THREE, h, context), context));
  const f4 = f(decimalAdd(x, decimalMultiply(FOUR, h, context), context));
  let numerator = decimalNegate(decimalMultiply(TWENTY_FIVE, f0, context));
  numerator = decimalAdd(numerator, decimalMultiply(FORTY_EIGHT, f1, context), context);
  numerator = decimalSubtract(numerator, decimalMultiply(THIRTY_SIX, f2, context), context);
  numerator = decimalAdd(numerator, decimalMultiply(SIXTEEN, f3, context), context);
  numerator = decimalSubtract(numerator, decimalMultiply(THREE, f4, context), context);
  return decimalDivide(numerator, decimalMultiply(TWELVE, h, context), context);
}

function fivePointBackward(
  f: (x: BigDecimal) => BigDecimal,
  x: BigDecimal,
  h: BigDecimal,
  f0: BigDecimal,
  context: DecimalContext,
): BigDecimal {
  const f1 = f(decimalSubtract(x, h, context));
  const f2 = f(decimalSubtract(x, decimalMultiply(TWO, h, context), context));
  const f3 = f(decimalSubtract(x, decimalMultiply(THREE, h, context), context));
  const f4 = f(decimalSubtract(x, decimalMultiply(FOUR, h, context), context));
  let numerator = decimalMultiply(TWENTY_FIVE, f0, context);
  numerator = decimalSubtract(numerator, decimalMultiply(FORTY_EIGHT, f1, context), context);
  numerator = decimalAdd(numerator, decimalMultiply(THIRTY_SIX, f2, context), context);
  numerator = decimalSubtract(numerator, decimalMultiply(SIXTEEN, f3, context), context);
  numerator = decimalAdd(numerator, decimalMultiply(THREE, f4, context), context);
  return decimalDivide(numerator, decimalMultiply(TWELVE, h, context), context);
}

/**
 * Computes a real derivative using arbitrary-precision decimal arithmetic.
 * It uses a symbolic derivative when available. If symbolic evaluation fails at
 * the point, it falls back to a central five-point stencil, then one-sided stencils.
 */
export function numericalDerivativeDecimal(
  expression: Expr,
  variable: string,
  xInput: DecimalInput,
  bindings: DecimalBindings = {},
  options: DecimalDerivativeOptions = {},
): DecimalDerivativeResult {
  validateVariable(variable);
  const precision = options.precision ?? 50;
  validatePrecision(precision);
  const rounding = options.rounding ?? "half-even";
  const context: DecimalContext = { precision: Math.min(MAX_PRECISION, precision + 24), rounding };
  const x = decimal(xInput);
  let evaluations = 0;
  const f = (at: BigDecimal): BigDecimal => {
    evaluations++;
    return evaluateAt(expression, variable, at, bindings, context);
  };

  if (options.preferSymbolic !== false) {
    try {
      const value = deriveAt(expression, variable, x, bindings, context);
      return makeDerivativeResult(value, ZERO, 1, true, precision, "symbolic", rounding);
    } catch {
      // High-precision finite differences can still work when the symbolic result
      // is singular or unavailable at the point (for example, sqrt(x) at x = 0).
    }
  }

  const h = options.step === undefined ? finiteDifferenceStep(x, precision) : decimal(options.step);
  if (h.coefficient <= 0n) throw new RangeError("Finite-difference step must be positive.");
  const halfH = decimalDivide(h, TWO, context);
  if (halfH.coefficient === 0n) throw new RangeError("Finite-difference step underflowed at the selected precision.");

  const errorTolerance = options.tolerance === undefined
    ? decimalPowerOfTen(-Math.max(4, precision - 8))
    : decimal(options.tolerance);
  if (errorTolerance.coefficient <= 0n) throw new RangeError("Derivative tolerance must be positive.");
  const formulas: Array<{
    method: DecimalDerivativeMethod;
    coarse: () => BigDecimal;
    fine: () => BigDecimal;
  }> = [];
  formulas.push({
    method: "five-point-central",
    coarse: () => fivePointCentral(f, x, h, context),
    fine: () => fivePointCentral(f, x, halfH, context),
  });

  let f0: BigDecimal | undefined;
  try {
    f0 = f(x);
  } catch {
    // If the function is undefined at the point, no ordinary finite derivative exists.
  }
  if (f0 !== undefined) {
    formulas.push({
      method: "five-point-forward",
      coarse: () => fivePointForward(f, x, h, f0!, context),
      fine: () => fivePointForward(f, x, halfH, f0!, context),
    });
    formulas.push({
      method: "five-point-backward",
      coarse: () => fivePointBackward(f, x, h, f0!, context),
      fine: () => fivePointBackward(f, x, halfH, f0!, context),
    });
  }

  let lastError: unknown;
  for (const formula of formulas) {
    try {
      const coarse = formula.coarse();
      const fine = formula.fine();
      const difference = decimalSubtract(fine, coarse, context);
      const correction = decimalDivide(difference, decimal(15n), context);
      const value = decimalAdd(fine, correction, context);
      const error = decimalAbs(correction);
      const converged = decimalCompare(error, errorTolerance) <= 0;
      return makeDerivativeResult(value, error, evaluations, converged, precision, formula.method, rounding);
    } catch (error) {
      lastError = error;
    }
  }
  throw new RangeError("Could not evaluate a valid high-precision derivative stencil at this point.", { cause: lastError });
}

function makeDerivativeResult(
  rawValue: BigDecimal,
  rawError: BigDecimal,
  evaluations: number,
  converged: boolean,
  precision: number,
  method: DecimalDerivativeMethod,
  rounding: DecimalRoundingMode = "half-even",
): DecimalDerivativeResult {
  const value = roundForResult(rawValue, precision, rounding);
  const estimatedError = roundForResult(rawError, precision, rounding);
  return {
    value,
    valueText: decimalToString(value),
    estimatedError,
    estimatedErrorText: decimalToString(estimatedError),
    evaluations,
    converged,
    precision,
    method,
  };
}

function legendreValueAndDerivative(
  degree: number,
  x: BigDecimal,
  context: DecimalContext,
): { value: BigDecimal; derivative: BigDecimal } {
  if (degree === 0) return { value: ONE, derivative: ZERO };
  let previous = ONE;
  let current = x;
  for (let k = 2; k <= degree; k++) {
    const first = decimalMultiply(decimal(BigInt(2 * k - 1)), decimalMultiply(x, current, context), context);
    const second = decimalMultiply(decimal(BigInt(k - 1)), previous, context);
    const next = decimalDivide(decimalSubtract(first, second, context), decimal(BigInt(k)), context);
    previous = current;
    current = next;
  }
  const xSquaredMinusOne = decimalSubtract(decimalMultiply(x, x, context), ONE, context);
  const derivativeNumerator = decimalMultiply(
    decimal(BigInt(degree)),
    decimalSubtract(decimalMultiply(x, current, context), previous, context),
    context,
  );
  return {
    value: current,
    derivative: decimalDivide(derivativeNumerator, xSquaredMinusOne, context),
  };
}

function gaussLegendreNodes(order: 16 | 32, precision: number): readonly GaussNode[] {
  const key = `${order}:${precision}`;
  const cached = gaussCache.get(key);
  if (cached) return cached;
  const context: DecimalContext = { precision: Math.min(MAX_PRECISION, precision + 18), rounding: "half-even" };
  const threshold = decimalPowerOfTen(-(Math.min(MAX_PRECISION - 1, precision + 10)));
  const nodes: GaussNode[] = [];
  const half = order / 2;
  for (let index = 1; index <= half; index++) {
    // A double-precision seed is sufficient: Newton's iteration refines the node
    // in arbitrary precision, and symmetric pairs avoid drift around zero.
    let root = decimal(Math.cos(Math.PI * (index - 0.25) / (order + 0.5)));
    let converged = false;
    for (let iteration = 0; iteration < 40; iteration++) {
      const current = legendreValueAndDerivative(order, root, context);
      const step = decimalDivide(current.value, current.derivative, context);
      const next = decimalSubtract(root, step, context);
      if (decimalCompare(decimalAbs(decimalSubtract(next, root, context)), threshold) <= 0) {
        root = next;
        converged = true;
        break;
      }
      root = next;
    }
    if (!converged) throw new RangeError(`Could not calculate a ${order}-point Gauss-Legendre node at the requested precision.`);
    const state = legendreValueAndDerivative(order, root, context);
    const oneMinusSquared = decimalSubtract(ONE, decimalMultiply(root, root, context), context);
    const weightDenominator = decimalMultiply(oneMinusSquared, decimalMultiply(state.derivative, state.derivative, context), context);
    const weight = decimalDivide(TWO, weightDenominator, context);
    nodes.push({ x: decimalNegate(root), weight }, { x: root, weight });
  }
  nodes.sort((a, b) => decimalCompare(a.x, b.x));
  const result = Object.freeze(nodes);
  gaussCache.set(key, result);
  return result;
}

function gaussLegendreIntegral(
  f: (x: BigDecimal) => BigDecimal,
  a: BigDecimal,
  b: BigDecimal,
  order: 16 | 32,
  precision: number,
  context: DecimalContext,
): BigDecimal {
  const nodes = gaussLegendreNodes(order, precision);
  const width = decimalSubtract(b, a, context);
  const halfWidth = decimalDivide(width, TWO, context);
  const midpoint = decimalDivide(decimalAdd(a, b, context), TWO, context);
  let weightedSum = ZERO;
  for (const item of nodes) {
    const x = decimalAdd(midpoint, decimalMultiply(halfWidth, item.x, context), context);
    weightedSum = decimalAdd(weightedSum, decimalMultiply(item.weight, f(x), context), context);
  }
  return decimalMultiply(halfWidth, weightedSum, context);
}

/**
 * Computes a definite real integral with arbitrary-precision adaptive Gauss-Legendre
 * quadrature. The 16- and 32-point rules are compared to estimate local error. The
 * integration interval must be finite and the integrand must be defined throughout it.
 */
export function integrateNumericallyDecimal(
  expression: Expr,
  variable: string,
  aInput: DecimalInput,
  bInput: DecimalInput,
  bindings: DecimalBindings = {},
  options: DecimalIntegralOptions = {},
): DecimalNumericalIntegralResult {
  validateVariable(variable);
  const precision = options.precision ?? 50;
  validatePrecision(precision);
  const rounding = options.rounding ?? "half-even";
  const maxDepth = options.maxDepth ?? 10;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 16) {
    throw new RangeError("maxDepth must be an integer in [1, 16].");
  }
  const tolerance = options.tolerance === undefined
    ? decimalPowerOfTen(-Math.max(4, precision - 8))
    : decimal(options.tolerance);
  if (tolerance.coefficient <= 0n) throw new RangeError("Integration tolerance must be positive.");
  const context: DecimalContext = { precision: Math.min(MAX_PRECISION, precision + 20), rounding };
  let a = decimal(aInput);
  let b = decimal(bInput);
  if (decimalCompare(a, b) === 0) {
    return makeIntegralResult(ZERO, ZERO, 0, true, precision, rounding);
  }
  let direction = ONE;
  if (decimalCompare(b, a) < 0) {
    [a, b] = [b, a];
    direction = decimal(-1n);
  }

  let evaluations = 0;
  const f = (x: BigDecimal): BigDecimal => {
    evaluations++;
    return evaluateAt(expression, variable, x, bindings, context);
  };

  const recurse = (
    left: BigDecimal,
    right: BigDecimal,
    tol: BigDecimal,
    depth: number,
  ): QuadratureResult => {
    const coarse = gaussLegendreIntegral(f, left, right, 16, precision, context);
    const fine = gaussLegendreIntegral(f, left, right, 32, precision, context);
    const error = absDifference(fine, coarse, context);
    if (decimalCompare(error, tol) <= 0) return { value: fine, error, converged: true };
    if (depth <= 0) return { value: fine, error, converged: false };

    const midpoint = decimalDivide(decimalAdd(left, right, context), TWO, context);
    if (decimalCompare(midpoint, left) === 0 || decimalCompare(midpoint, right) === 0) {
      return { value: fine, error, converged: false };
    }
    const halfTolerance = decimalDivide(tol, TWO, context);
    const leftResult = recurse(left, midpoint, halfTolerance, depth - 1);
    const rightResult = recurse(midpoint, right, halfTolerance, depth - 1);
    return {
      value: decimalAdd(leftResult.value, rightResult.value, context),
      error: decimalAdd(leftResult.error, rightResult.error, context),
      converged: leftResult.converged && rightResult.converged,
    };
  };

  const result = recurse(a, b, tolerance, maxDepth);
  return makeIntegralResult(
    decimalMultiply(direction, result.value, context),
    result.error,
    evaluations,
    result.converged,
    precision,
    rounding,
  );
}

function makeIntegralResult(
  rawValue: BigDecimal,
  rawError: BigDecimal,
  evaluations: number,
  converged: boolean,
  precision: number,
  rounding: DecimalRoundingMode = "half-even",
): DecimalNumericalIntegralResult {
  const value = roundForResult(rawValue, precision, rounding);
  const estimatedError = roundForResult(rawError, precision, rounding);
  return {
    value,
    valueText: decimalToString(value),
    estimatedError,
    estimatedErrorText: decimalToString(estimatedError),
    evaluations,
    converged,
    precision,
    method: "adaptive-gauss-legendre-16/32",
  };
}
