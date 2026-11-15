import type { Expr } from "../core/expr.js";
import { evaluate, type NumericBindings } from "./evaluate.js";
import { differentiate } from "../calculus/differentiate.js";

export interface RootResult {
  readonly root: number;
  readonly residual: number;
  readonly iterations: number;
  readonly converged: boolean;
  readonly method: "bisection" | "newton" | "hybrid";
}

export interface NumericIntegralResult {
  readonly value: number;
  readonly estimatedError: number;
  readonly evaluations: number;
  readonly converged: boolean;
}

/**
 * Compute a numerical derivative. The symbolic derivative is preferred; a five-point
 * finite-difference stencil is used when symbolic evaluation is unavailable at the point.
 * Near a real-domain boundary, one-sided five-point stencils are attempted instead.
 */
export function numericalDerivative(
  expr: Expr,
  variable: string,
  x: number,
  bindings: NumericBindings = {},
): number {
  if (!Number.isFinite(x)) throw new RangeError("Derivative point must be finite.");
  if (!variable.trim()) throw new TypeError("Derivative variable must not be empty.");

  try {
    const symbolic = differentiate(expr, variable);
    const result = evaluate(symbolic, { ...bindings, [variable]: x });
    if (Number.isFinite(result)) return result;
  } catch {
    // Use numerical differentiation when no usable symbolic value is available.
  }

  const scale = Math.max(1, Math.abs(x));
  const h = Math.max(Math.cbrt(Number.EPSILON) * scale, 8 * Number.EPSILON * scale);
  if (!Number.isFinite(h) || h <= 0) {
    throw new RangeError("Could not choose a finite-difference step at this point.");
  }
  const f = (at: number): number => {
    if (!Number.isFinite(at)) throw new RangeError("Finite-difference point overflowed.");
    const value = evaluate(expr, { ...bindings, [variable]: at });
    if (!Number.isFinite(value)) throw new RangeError("Finite-difference evaluation was non-finite.");
    return value;
  };

  // Fourth-order central difference: O(h^4) truncation error for smooth functions.
  try {
    const fm2 = f(x - 2 * h), fm1 = f(x - h), fp1 = f(x + h), fp2 = f(x + 2 * h);
    const result = (fm2 - 8 * fm1 + 8 * fp1 - fp2) / (12 * h);
    if (Number.isFinite(result)) return result;
  } catch {
    // A central stencil may cross a domain boundary, so try one-sided formulas.
  }

  let f0: number;
  try {
    f0 = f(x);
  } catch (error) {
    throw new RangeError("The expression is not numerically defined at the derivative point.", { cause: error });
  }
  try {
    const f1 = f(x + h), f2 = f(x + 2 * h), f3 = f(x + 3 * h), f4 = f(x + 4 * h);
    const result = (-25 * f0 + 48 * f1 - 36 * f2 + 16 * f3 - 3 * f4) / (12 * h);
    if (Number.isFinite(result)) return result;
  } catch {
    // Try the opposite direction; this is useful near upper domain boundaries.
  }
  try {
    const f1 = f(x - h), f2 = f(x - 2 * h), f3 = f(x - 3 * h), f4 = f(x - 4 * h);
    const result = (25 * f0 - 48 * f1 + 36 * f2 - 16 * f3 + 3 * f4) / (12 * h);
    if (Number.isFinite(result)) return result;
  } catch {
    // Report a single, actionable failure below.
  }
  throw new RangeError("Could not evaluate a stable finite-difference stencil near this point.");
}

/** Bisection method for a continuous function with a sign change on [left, right]. */
export function solveRootBisection(
  expr: Expr,
  variable: string,
  left: number,
  right: number,
  bindings: NumericBindings = {},
  tolerance = 1e-10,
  maxIterations = 200,
): RootResult {
  validateRootOptions(tolerance, maxIterations);
  validateInterval(left, right);
  let a = left, b = right;
  let fa = evaluate(expr, { ...bindings, [variable]: a });
  let fb = evaluate(expr, { ...bindings, [variable]: b });
  if (fa === 0) return { root: a, residual: 0, iterations: 0, converged: true, method: "bisection" };
  if (fb === 0) return { root: b, residual: 0, iterations: 0, converged: true, method: "bisection" };
  if (Math.sign(fa) === Math.sign(fb)) {
    throw new RangeError("Bisection requires endpoint values with opposite signs.");
  }

  let midpoint = stableMidpoint(a, b);
  let fm = evaluate(expr, { ...bindings, [variable]: midpoint });
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    midpoint = stableMidpoint(a, b);
    // At machine precision, the interval cannot be reduced any further.
    if (midpoint === a || midpoint === b) {
      const useLeft = Math.abs(fa) <= Math.abs(fb);
      const root = useLeft ? a : b;
      const residual = Math.abs(useLeft ? fa : fb);
      return { root, residual, iterations: iteration - 1, converged: residual <= tolerance, method: "bisection" };
    }
    fm = evaluate(expr, { ...bindings, [variable]: midpoint });
    if (Math.abs(fm) <= tolerance || halfWidth(a, b) <= tolerance * Math.max(1, Math.abs(midpoint))) {
      return { root: midpoint, residual: Math.abs(fm), iterations: iteration, converged: true, method: "bisection" };
    }
    if (Math.sign(fm) === Math.sign(fa)) {
      a = midpoint;
      fa = fm;
    } else {
      b = midpoint;
      fb = fm;
    }
  }
  return { root: midpoint, residual: Math.abs(fm), iterations: maxIterations, converged: false, method: "bisection" };
}

/**
 * Newton's method. A small step alone is not treated as convergence: the residual
 * must also meet the requested tolerance, otherwise the result is marked unconverged.
 */
export function solveRootNewton(
  expr: Expr,
  variable: string,
  initialGuess: number,
  bindings: NumericBindings = {},
  tolerance = 1e-10,
  maxIterations = 100,
): RootResult {
  if (!Number.isFinite(initialGuess)) throw new RangeError("Initial guess must be finite.");
  validateRootOptions(tolerance, maxIterations);
  let x = initialGuess;
  for (let iteration = 0; iteration <= maxIterations; iteration++) {
    const fx = evaluate(expr, { ...bindings, [variable]: x });
    if (Math.abs(fx) <= tolerance) {
      return { root: x, residual: Math.abs(fx), iterations: iteration, converged: true, method: "newton" };
    }
    if (iteration === maxIterations) {
      return { root: x, residual: Math.abs(fx), iterations: iteration, converged: false, method: "newton" };
    }
    const derivative = numericalDerivative(expr, variable, x, bindings);
    if (!Number.isFinite(derivative) || derivative === 0) {
      throw new RangeError("Newton's method encountered a zero or non-finite derivative.");
    }
    const next = x - fx / derivative;
    if (!Number.isFinite(next)) throw new RangeError("Newton's method diverged to a non-finite value.");
    if (next === x) {
      return { root: x, residual: Math.abs(fx), iterations: iteration + 1, converged: false, method: "newton" };
    }
    x = next;
  }
  const residual = Math.abs(evaluate(expr, { ...bindings, [variable]: x }));
  return { root: x, residual, iterations: maxIterations, converged: residual <= tolerance, method: "newton" };
}

/**
 * Safeguarded Newton-bisection solver. It requires a sign-changing interval and uses
 * Newton steps only when they stay safely inside the bracket; otherwise it bisects.
 */
export function solveRootHybrid(
  expr: Expr,
  variable: string,
  left: number,
  right: number,
  bindings: NumericBindings = {},
  tolerance = 1e-10,
  maxIterations = 200,
): RootResult {
  validateRootOptions(tolerance, maxIterations);
  validateInterval(left, right);
  let a = left, b = right;
  let fa = evaluate(expr, { ...bindings, [variable]: a });
  let fb = evaluate(expr, { ...bindings, [variable]: b });
  if (fa === 0) return { root: a, residual: 0, iterations: 0, converged: true, method: "hybrid" };
  if (fb === 0) return { root: b, residual: 0, iterations: 0, converged: true, method: "hybrid" };
  if (Math.sign(fa) === Math.sign(fb)) {
    throw new RangeError("Hybrid root solving requires endpoint values with opposite signs.");
  }

  let x = stableMidpoint(a, b);
  let fx = evaluate(expr, { ...bindings, [variable]: x });
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (Math.abs(fx) <= tolerance) {
      return { root: x, residual: Math.abs(fx), iterations: iteration - 1, converged: true, method: "hybrid" };
    }
    if (halfWidth(a, b) <= tolerance * Math.max(1, Math.abs(x))) {
      return { root: x, residual: Math.abs(fx), iterations: iteration - 1, converged: true, method: "hybrid" };
    }

    if (Math.sign(fx) === Math.sign(fa)) {
      a = x;
      fa = fx;
    } else {
      b = x;
      fb = fx;
    }

    let candidate = Number.NaN;
    try {
      const derivative = numericalDerivative(expr, variable, x, bindings);
      if (Number.isFinite(derivative) && derivative !== 0) candidate = x - fx / derivative;
    } catch {
      // A derivative may be unavailable at a point; bisection remains safe.
    }
    const widthHalf = halfWidth(a, b);
    const distanceHalf = Number.isFinite(candidate) ? candidate / 2 - a / 2 : Number.NaN;
    const margin = widthHalf * 0.05;
    const safelyInside = Number.isFinite(candidate) && candidate > a && candidate < b &&
      distanceHalf > margin && widthHalf - distanceHalf > margin;
    if (!safelyInside) candidate = stableMidpoint(a, b);
    if (candidate === a || candidate === b || candidate === x) candidate = stableMidpoint(a, b);
    x = candidate;
    fx = evaluate(expr, { ...bindings, [variable]: x });
  }
  return { root: x, residual: Math.abs(fx), iterations: maxIterations, converged: false, method: "hybrid" };
}

/** Adaptive Simpson quadrature for continuous functions on a finite interval. */
export function integrateNumerically(
  expr: Expr,
  variable: string,
  a: number,
  b: number,
  bindings: NumericBindings = {},
  tolerance = 1e-9,
  maxDepth = 20,
): NumericIntegralResult {
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new RangeError("Numerical integration currently requires finite endpoints.");
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new RangeError("Tolerance must be positive and finite.");
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 50) throw new RangeError("maxDepth must be an integer in [1, 50].");
  if (a === b) return { value: 0, estimatedError: 0, evaluations: 0, converged: true };
  if (b < a) {
    const reversed = integrateNumerically(expr, variable, b, a, bindings, tolerance, maxDepth);
    return { ...reversed, value: -reversed.value };
  }
  if (!Number.isFinite(b - a)) throw new RangeError("Integration interval is too wide for finite-precision arithmetic.");

  let evaluations = 0;
  const f = (x: number) => {
    evaluations++;
    const y = evaluate(expr, { ...bindings, [variable]: x });
    if (!Number.isFinite(y)) throw new RangeError("Integrand became non-finite inside the integration interval.");
    return y;
  };
  const fa = f(a), fb = f(b), midpoint = stableMidpoint(a, b), fm = f(midpoint);
  const whole = simpson(a, b, fa, fm, fb);
  const recurse = (
    left: number, right: number, fLeft: number, fMid: number, fRight: number,
    estimate: number, tol: number, depth: number,
  ): { value: number; error: number; converged: boolean } => {
    const mid = stableMidpoint(left, right);
    const leftMid = stableMidpoint(left, mid), rightMid = stableMidpoint(mid, right);
    if (mid === left || mid === right || leftMid === left || leftMid === mid || rightMid === mid || rightMid === right) {
      return { value: estimate, error: 0, converged: false };
    }
    const fLeftMid = f(leftMid), fRightMid = f(rightMid);
    const leftEstimate = simpson(left, mid, fLeft, fLeftMid, fMid);
    const rightEstimate = simpson(mid, right, fMid, fRightMid, fRight);
    const delta = leftEstimate + rightEstimate - estimate;
    if (!Number.isFinite(delta)) throw new RangeError("Numerical integration overflowed while refining the estimate.");
    if (Math.abs(delta) <= 15 * tol) {
      return { value: leftEstimate + rightEstimate + delta / 15, error: Math.abs(delta) / 15, converged: true };
    }
    if (depth <= 0) return { value: leftEstimate + rightEstimate + delta / 15, error: Math.abs(delta) / 15, converged: false };
    const l = recurse(left, mid, fLeft, fLeftMid, fMid, leftEstimate, tol / 2, depth - 1);
    const r = recurse(mid, right, fMid, fRightMid, fRight, rightEstimate, tol / 2, depth - 1);
    return { value: l.value + r.value, error: l.error + r.error, converged: l.converged && r.converged };
  };
  const result = recurse(a, b, fa, fm, fb, whole, tolerance, maxDepth);
  if (!Number.isFinite(result.value) || !Number.isFinite(result.error)) {
    throw new RangeError("Numerical integration produced a non-finite result.");
  }
  return { value: result.value, evaluations, estimatedError: result.error, converged: result.converged };
}

function simpson(a: number, b: number, fa: number, fm: number, fb: number): number {
  return (b - a) * (fa + 4 * fm + fb) / 6;
}

function stableMidpoint(a: number, b: number): number {
  // a + (b-a)/2 can overflow for large endpoints of opposite signs.
  return Math.sign(a) !== Math.sign(b) ? a / 2 + b / 2 : a + (b - a) / 2;
}

function halfWidth(a: number, b: number): number {
  // Half-width does not overflow for finite endpoints, even when b-a would.
  return b / 2 - a / 2;
}

function validateInterval(left: number, right: number): void {
  if (!Number.isFinite(left) || !Number.isFinite(right)) throw new RangeError("Root search endpoints must be finite.");
  if (!(left < right)) throw new RangeError("Root search requires left < right.");
}

function validateRootOptions(tolerance: number, maxIterations: number): void {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new RangeError("Tolerance must be positive and finite.");
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > 10000) {
    throw new RangeError("Maximum iterations must be an integer in [1, 10000].");
  }
}
