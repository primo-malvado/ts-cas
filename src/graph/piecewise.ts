import { add, integer, negate, structuralKey, type Expr } from "../core/expr.js";
import { solve } from "../algebra/solve.js";
import { evaluate } from "../numeric/evaluate.js";
import type { NumericBindings } from "../numeric/evaluate.js";

export interface PiecewiseBranch {
  readonly expression: Expr;
  readonly lower: number | null;
  readonly upper: number | null;
  readonly lowerClosed?: boolean;
  readonly upperClosed?: boolean;
}
export interface PiecewiseRoot {
  readonly value: Expr;
  readonly approximation: number;
  readonly branchIndex: number;
}
export interface PiecewiseEquationResult {
  readonly status: "complete" | "partial" | "unsupported";
  readonly roots: readonly PiecewiseRoot[];
  readonly message?: string;
}
export interface PiecewiseSample {
  readonly x: number;
  readonly y: number | null;
}

function validateBranches(branches: readonly PiecewiseBranch[]): void {
  if (branches.length === 0) throw new RangeError("At least one branch is required.");
  for (const branch of branches) {
    if (branch.lower !== null && !Number.isFinite(branch.lower)) throw new RangeError("Branch lower bound must be finite or null.");
    if (branch.upper !== null && !Number.isFinite(branch.upper)) throw new RangeError("Branch upper bound must be finite or null.");
    if (branch.lower !== null && branch.upper !== null && branch.lower > branch.upper) throw new RangeError("Branch lower bound cannot exceed upper bound.");
  }
}
function contains(branch: PiecewiseBranch, x: number): boolean {
  const lowerOk = branch.lower === null || x > branch.lower || (x === branch.lower && (branch.lowerClosed ?? true));
  const upperOk = branch.upper === null || x < branch.upper || (x === branch.upper && (branch.upperClosed ?? true));
  return lowerOk && upperOk;
}

/** Evaluate a piecewise-defined function. Returns null when x is outside its domain. */
export function evaluatePiecewiseFunction(
  branches: readonly PiecewiseBranch[],
  variable: string,
  x: number,
  bindings: NumericBindings = {},
): number | null {
  validateBranches(branches);
  if (!Number.isFinite(x)) throw new RangeError("x must be finite.");
  const matching = branches.filter(branch => contains(branch, x));
  if (matching.length > 1) throw new RangeError("Piecewise branches overlap at this input; branch selection is ambiguous.");
  if (matching.length === 0) return null;
  return evaluate(matching[0]!.expression, { ...bindings, [variable]: x });
}

/** Sample a piecewise function for plotting; null samples mark domain gaps or undefined values. */
export function samplePiecewiseFunction(
  branches: readonly PiecewiseBranch[],
  variable: string,
  start: number,
  end: number,
  count: number,
  bindings: NumericBindings = {},
): PiecewiseSample[] {
  validateBranches(branches);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new RangeError("Sampling requires finite start < end.");
  if (!Number.isSafeInteger(count) || count < 2) throw new RangeError("Sample count must be an integer of at least 2.");
  return Array.from({ length: count }, (_, index) => {
    const x = start + (end - start) * index / (count - 1);
    try { return { x, y: evaluatePiecewiseFunction(branches, variable, x, bindings) }; }
    catch { return { x, y: null }; }
  });
}

/**
 * Solve f(x)=target branch by branch, for branches whose difference from target is a polynomial
 * supported by the exact equation solver. Roots are retained only when they lie in that branch.
 */
export function solvePiecewiseEquation(
  branches: readonly PiecewiseBranch[],
  variable: string,
  target: Expr = integer(0),
): PiecewiseEquationResult {
  validateBranches(branches);
  const roots: PiecewiseRoot[] = [];
  let partial = false;
  let quarticUnfiltered = false;
  let constantUnfiltered = false;
  let powerUnfiltered = false;
  for (let branchIndex = 0; branchIndex < branches.length; branchIndex++) {
    const branch = branches[branchIndex]!;
    const equation = solve(add(branch.expression, negate(target)), variable);
    if (equation.status === "all") {
      return {
        status: "partial",
        roots,
        message: `Branch ${branchIndex} equals the target identically; it contributes infinitely many solutions.`
      };
    }
    if (equation.method === "quartic-formula") {
      partial = true;
      quarticUnfiltered = true;
      continue;
    }
    if (equation.method === "constant-coefficients") {
      partial = true;
      constantUnfiltered = true;
      continue;
    }
    if (equation.method === "principal-power") {
      partial = true;
      powerUnfiltered = true;
      continue;
    }
    if (equation.status === "unsupported" || equation.status === "partial") {
      partial = true;
      continue;
    }
    for (const value of equation.solutions) {
      let approximation: number;
      try { approximation = evaluate(value); } catch { continue; }
      if (!contains(branch, approximation)) continue;
      if (roots.some(root => structuralKey(root.value) === structuralKey(value))) continue;
      roots.push({ value, approximation, branchIndex });
    }
  }
  roots.sort((a, b) => a.approximation - b.approximation);
  return {
    status: partial ? "partial" : "complete",
    roots,
    ...(partial ? { message: quarticUnfiltered
      ? "Quartic radical solutions cannot yet be reliably filtered for real piecewise branches."
      : constantUnfiltered
        ? "Solutions involving symbolic constants or parameters cannot yet be reliably filtered for real piecewise branches."
        : powerUnfiltered
          ? "Principal-power solutions cannot yet be reliably filtered for real piecewise branches."
      : "At least one branch could not be solved by the exact polynomial equation solver." } : {}),
  };
}
