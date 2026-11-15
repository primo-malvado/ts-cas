import type { Expr } from "../core/expr.js";
import { solvePolynomialNumericallyDecimal } from "./polynomial-roots-decimal.js";

export type PolynomialRootMethod = "sturm-isolation" | "linear" | "critical-point" | "bisection";

export interface NumericPolynomialRoot {
  /** IEEE-754 approximation. Very close roots may map to the same number. */
  readonly value: number;
  /** Exact multiplicity determined by square-free factorization over Q. */
  readonly multiplicity: number;
  /** Approximation serialized with more digits than JavaScript number can preserve. */
  readonly valueText?: string;
  /** True when the exact rational interval certifies one distinct real root. */
  readonly certified?: boolean;
  readonly isolationInterval?: { readonly lowerExact: string; readonly upperExact: string };
  /** Approximate absolute polynomial residual, for diagnostics only. */
  readonly residual: number;
  readonly relativeResidual?: number;
  readonly method: PolynomialRootMethod;
  /** True only when the exact isolating interval meets the requested tolerance. */
  readonly converged: boolean;
  readonly iterations: number;
}

export type NumericPolynomialRootStatus = "finite" | "partial" | "none" | "all" | "unsupported";

export interface NumericPolynomialRootsResult {
  readonly variable: string;
  readonly degree: number;
  readonly roots: readonly NumericPolynomialRoot[];
  readonly status: NumericPolynomialRootStatus;
  readonly message?: string;
  readonly totalDistinctRealRoots?: number | "infinite";
  readonly unresolvedIntervals?: readonly {
    readonly lowerExact: string;
    readonly upperExact: string;
    readonly distinctRootCount: number;
  }[];
}

export interface NumericPolynomialRootsOptions {
  /** Relative root-location tolerance. Defaults to 1e-10. */
  readonly tolerance?: number;
  /** Maximum exact interval subdivisions. Defaults to 200. */
  readonly maxIterations?: number;
  /** Maximum polynomial degree accepted. Defaults to 32; maximum 64. */
  readonly maxDegree?: number;
}

/**
 * Backwards-compatible IEEE-754 view of the certified root solver.
 * Root counts and multiplicities are determined using exact rational Sturm
 * sequences; `value` remains a JavaScript number for callers that need speed or
 * compatibility. Use `valueText` and `isolationInterval` to retain the distinction
 * between roots closer than the resolution of IEEE-754 numbers.
 */
export function solvePolynomialNumerically(
  expression: Expr,
  variable: string,
  options: NumericPolynomialRootsOptions = {},
): NumericPolynomialRootsResult {
  const tolerance = options.tolerance ?? 1e-10;
  const maxIterations = options.maxIterations ?? 200;
  const maxDegree = options.maxDegree ?? 32;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    throw new RangeError("tolerance must be a positive finite number.");
  }
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > 20_000) {
    throw new RangeError("maxIterations must be an integer in [1, 20000].");
  }
  if (!Number.isSafeInteger(maxDegree) || maxDegree < 1 || maxDegree > 64) {
    throw new RangeError("maxDegree must be an integer in [1, 64].");
  }

  const result = solvePolynomialNumericallyDecimal(expression, variable, {
    precision: 30,
    tolerance: tolerance.toString(),
    maxIterations,
    maxDegree,
  });
  if (result.status === "unsupported") {
    return {
      variable,
      degree: result.degree,
      roots: [],
      status: "unsupported",
      ...(result.message === undefined ? {} : { message: result.message }),
    };
  }

  const roots: NumericPolynomialRoot[] = [];
  for (const root of result.roots) {
    const value = Number(root.valueText);
    if (!Number.isFinite(value) || (value === 0 && root.value.coefficient !== 0n)) {
      return {
        variable,
        degree: result.degree,
        roots: [],
        status: "unsupported",
        ...(result.totalDistinctRealRoots === undefined ? {} : { totalDistinctRealRoots: result.totalDistinctRealRoots }),
        ...(result.unresolvedIntervals === undefined ? {} : { unresolvedIntervals: result.unresolvedIntervals }),
        message: "At least one root is outside the representable IEEE-754 range. Use solvePolynomialNumericallyDecimal() to retain its arbitrary-precision value and certificate.",
      };
    }
    roots.push({
      value,
      valueText: root.valueText,
      multiplicity: root.multiplicity,
      certified: root.certified,
      isolationInterval: root.isolationInterval,
      residual: Number(root.residualText),
      relativeResidual: Number(root.relativeResidualText),
      method: "sturm-isolation",
      converged: root.converged,
      iterations: root.iterations,
    });
  }

  const distinctNumericValues = new Set(roots.map(root => root.value));
  const numericCollision = distinctNumericValues.size < roots.length;
  const message = numericCollision
    ? `${result.message ?? "Certified roots computed."} Warning: at least two distinct roots round to the same IEEE-754 number; use valueText and isolationInterval to distinguish them.`
    : result.message;

  return {
    variable,
    degree: result.degree,
    roots,
    status: result.status,
    ...(message === undefined ? {} : { message }),
    ...(result.totalDistinctRealRoots === undefined ? {} : { totalDistinctRealRoots: result.totalDistinctRealRoots }),
    ...(result.unresolvedIntervals === undefined ? {} : { unresolvedIntervals: result.unresolvedIntervals }),
  };
}
