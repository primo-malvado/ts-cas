import {
  add, integer, isNumeric, mul, numericParts, rational, symbol, type Expr, type NumericExpr,
} from "../core/expr.js";
import { polynomialDegree, polynomialFromExpr, type Polynomial } from "./polynomial.js";
import { expand } from "./expand.js";
import { solve } from "./solve.js";
import { simplifyRadicals } from "./radicals.js";
import { substitute } from "./substitute.js";

export interface PolynomialEquation {
  readonly left: Expr;
  readonly right: Expr;
}

/** Alias used by the linear solver for backward compatibility and clarity. */
export interface LinearEquation extends PolynomialEquation {}

export interface LinearSystemResult {
  readonly status: "unique" | "infinite" | "none" | "unsupported";
  readonly variables: readonly string[];
  /** Exact values or expressions in the free parameters, when representable. */
  readonly solutions?: Readonly<Record<string, Expr>>;
  /** Parameter symbols used by an underdetermined system, e.g. ["t1"]. */
  readonly parameters?: readonly string[];
  readonly rank?: number;
  readonly message?: string;
}

type Q = NumericExpr;
type Matrix = Q[][];

function qParts(value: Q): [bigint, bigint] {
  return numericParts(value);
}
function qAdd(a: Q, b: Q): Q {
  const [an, ad] = qParts(a), [bn, bd] = qParts(b);
  return rational(an * bd + bn * ad, ad * bd) as Q;
}
function qSub(a: Q, b: Q): Q {
  const [n, d] = qParts(b);
  return qAdd(a, rational(-n, d) as Q);
}
function qMul(a: Q, b: Q): Q {
  const [an, ad] = qParts(a), [bn, bd] = qParts(b);
  return rational(an * bn, ad * bd) as Q;
}
function qDiv(a: Q, b: Q): Q {
  const [an, ad] = qParts(a), [bn, bd] = qParts(b);
  if (bn === 0n) throw new RangeError("Division by zero in Gaussian elimination.");
  return rational(an * bd, ad * bn) as Q;
}
function qZero(a: Q): boolean {
  return a.kind === "Integer" ? a.value === 0n : a.numerator === 0n;
}
function qOne(a: Q): boolean {
  return a.kind === "Integer" ? a.value === 1n : a.numerator === a.denominator;
}
function exprNumber(expr: Expr): Q | null {
  return isNumeric(expr) ? expr : null;
}

function subtractExpressions(left: Expr, right: Expr): Expr {
  return add(left, mul(integer(-1), right));
}

function rowToCoefficients(expr: Expr, variables: readonly string[]): Q[] | null {
  let polynomial: Polynomial;
  try {
    polynomial = polynomialFromExpr(expr);
  } catch {
    return null;
  }
  const coefficients = variables.map(() => integer(0) as Q);
  let constant: Q = integer(0);
  for (const term of polynomial.terms.values()) {
    let totalDegree = 0;
    let selected = -1;
    for (const [name, exponent] of term.monomial.powers) {
      const index = variables.indexOf(name);
      if (index < 0 || exponent !== 1 || totalDegree > 0) return null;
      totalDegree += exponent;
      selected = index;
    }
    if (totalDegree === 0) constant = qAdd(constant, term.coefficient);
    else coefficients[selected] = qAdd(coefficients[selected]!, term.coefficient);
  }
  return [...coefficients, qSub(integer(0) as Q, constant)];
}

/** Solve a linear system with exact rational Gaussian elimination.
 * Each equation is represented as left = right. Only affine expressions are supported.
 */
export function solveLinearSystem(
  equations: readonly LinearEquation[],
  variables: readonly string[],
): LinearSystemResult {
  const uniqueVariables = [...new Set(variables)];
  if (uniqueVariables.length !== variables.length || uniqueVariables.length === 0) {
    return { status: "unsupported", variables, message: "Provide a non-empty list of distinct variable names." };
  }
  if (equations.length === 0) {
    const parameters = freshParameterNames(uniqueVariables, uniqueVariables.length);
    const solutions = Object.fromEntries(uniqueVariables.map((name, index) => [name, symbol(parameters[index]!)]));
    return {
      status: "infinite", variables: uniqueVariables, parameters, solutions, rank: 0,
      message: "No equations constrain the variables; each variable is an independent parameter."
    };
  }

  const matrix: Matrix = [];
  for (const equation of equations) {
    const difference = subtractExpressions(equation.left, equation.right);
    const row = rowToCoefficients(difference, uniqueVariables);
    if (!row) {
      return { status: "unsupported", variables: uniqueVariables, message: "Only linear equations with exact rational coefficients are supported." };
    }
    matrix.push(row);
  }

  const variableCount = uniqueVariables.length;
  let pivotRow = 0;
  const pivotColumns: number[] = [];

  for (let col = 0; col < variableCount && pivotRow < matrix.length; col++) {
    let pivot = pivotRow;
    while (pivot < matrix.length && qZero(matrix[pivot]![col]!)) pivot++;
    if (pivot === matrix.length) continue;

    [matrix[pivotRow], matrix[pivot]] = [matrix[pivot]!, matrix[pivotRow]!];
    const pivotValue = matrix[pivotRow]![col]!;
    for (let j = col; j <= variableCount; j++) {
      matrix[pivotRow]![j] = qDiv(matrix[pivotRow]![j]!, pivotValue);
    }

    for (let row = 0; row < matrix.length; row++) {
      if (row === pivotRow) continue;
      const factor = matrix[row]![col]!;
      if (qZero(factor)) continue;
      for (let j = col; j <= variableCount; j++) {
        matrix[row]![j] = qSub(
          matrix[row]![j]!,
          qMul(factor, matrix[pivotRow]![j]!)
        );
      }
    }

    pivotColumns.push(col);
    pivotRow++;
  }

  for (const row of matrix) {
    const allZero = row.slice(0, variableCount).every(qZero);
    if (allZero && !qZero(row[variableCount]!)) {
      return { status: "none", variables: uniqueVariables, rank: pivotColumns.length };
    }
  }

  const freeColumns = Array.from({ length: variableCount }, (_, col) => col)
    .filter((col) => !pivotColumns.includes(col));

  if (freeColumns.length > 0) {
    const parameters = freshParameterNames(uniqueVariables, freeColumns.length);
    const parameterByColumn = new Map<number, Expr>();
    freeColumns.forEach((col, index) => parameterByColumn.set(col, symbol(parameters[index]!)));

    const solutions: Record<string, Expr> = {};
    freeColumns.forEach((col) => {
      solutions[uniqueVariables[col]!] = parameterByColumn.get(col)!;
    });

    pivotColumns.forEach((col, row) => {
      let expression: Expr = matrix[row]![variableCount]!;
      for (const freeCol of freeColumns) {
        const coefficient = matrix[row]![freeCol]!;
        if (qZero(coefficient)) continue;
        expression = add(expression, mul(integer(-1), coefficient, parameterByColumn.get(freeCol)!));
      }
      solutions[uniqueVariables[col]!] = expression;
    });

    return {
      status: "infinite",
      variables: uniqueVariables,
      solutions,
      parameters,
      rank: pivotColumns.length,
      message: "The system has infinitely many solutions, represented using free parameters."
    };
  }

  const solutions: Record<string, Expr> = {};
  pivotColumns.forEach((col, row) => {
    solutions[uniqueVariables[col]!] = matrix[row]![variableCount]!;
  });
  return { status: "unique", variables: uniqueVariables, solutions, rank: pivotColumns.length };
}

/** Generate distinct parameter names that cannot collide with system variables. */
function freshParameterNames(variables: readonly string[], count: number): string[] {
  const reserved = new Set(variables);
  const names: string[] = [];
  let candidateIndex = 1;
  while (names.length < count) {
    const candidate = `t${candidateIndex++}`;
    if (reserved.has(candidate)) continue;
    reserved.add(candidate);
    names.push(candidate);
  }
  return names;
}


export interface PolynomialSystemResult {
  readonly status: "finite" | "none" | "infinite" | "unsupported";
  readonly variables: readonly string[];
  /** A list of solution points for finite systems, or one parametric family for infinite systems. */
  readonly solutions: readonly Readonly<Record<string, Expr>>[];
  /** Present when the solution is a family expressed using free parameters. */
  readonly parameters?: readonly string[];
  readonly message?: string;
}

function systemDifference(equation: PolynomialEquation): Expr {
  return subtractExpressions(equation.left, equation.right);
}

function freshSystemParameter(variables: readonly string[]): string {
  let index = 1;
  while (variables.includes(`t${index}`)) index++;
  return `t${index}`;
}

/**
 * Solve a two-equation, two-variable polynomial system exactly when one equation is
 * linear and substitution reduces the other to degree at most two. Two fully linear
 * equations are delegated to the Gaussian-elimination solver.
 *
 * Example: x + y = 3 and x^2 + y^2 = 5 returns (x,y) = (2,1) and (1,2).
 */
export function solvePolynomialSystem(
  equations: readonly PolynomialEquation[],
  variables: readonly string[],
): PolynomialSystemResult {
  const names = [...variables];
  if (names.length !== 2 || new Set(names).size !== 2 || equations.length !== 2) {
    return {
      status: "unsupported", variables: names, solutions: [],
      message: "Provide exactly two equations and two distinct variables.",
    };
  }

  const differences = equations.map(systemDifference);
  const rows = differences.map(difference => rowToCoefficients(difference, names));

  // A contradictory constant equation makes the whole system impossible, even if
  // the other equation is nonlinear and cannot otherwise be reduced.
  if (rows.some(row => row !== null && qZero(row[0]!) && qZero(row[1]!) && !qZero(row[2]!))) {
    return { status: "none", variables: names, solutions: [], message: "One equation is a non-zero constant equal to zero." };
  }

  // Systems where both equations are affine use the existing exact Gaussian solver.
  if (rows.every((row): row is Q[] => row !== null)) {
    const linearResult = solveLinearSystem(equations, names);
    if (linearResult.status === "none") {
      return { status: "none", variables: names, solutions: [], message: "The equations are inconsistent." };
    }
    if (linearResult.status === "unsupported" || !linearResult.solutions) {
      return {
        status: "unsupported", variables: names, solutions: [],
        message: linearResult.message ?? "The linear system could not be solved.",
      };
    }
    if (linearResult.status === "infinite") {
      return {
        status: "infinite", variables: names, solutions: [linearResult.solutions],
        ...(linearResult.parameters !== undefined ? { parameters: linearResult.parameters } : {}),
        ...(linearResult.message !== undefined ? { message: linearResult.message } : {}),
      };
    }
    return { status: "finite", variables: names, solutions: [linearResult.solutions] };
  }

  const linearIndices = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row !== null && (!qZero(row[0]!) || !qZero(row[1]!)));

  if (linearIndices.length !== 1) {
    return {
      status: "unsupported", variables: names, solutions: [],
      message: "For a nonlinear system, exactly one equation must be linear in the two variables.",
    };
  }

  const { row, index: linearIndex } = linearIndices[0]!;
  const linearRow = row!;
  const nonlinearIndex = 1 - linearIndex;
  const dependentIndex = qZero(linearRow[1]!) ? 0 : 1;
  const independentIndex = 1 - dependentIndex;
  const dependent = names[dependentIndex]!;
  const independent = names[independentIndex]!;
  const dependentCoefficient = linearRow[dependentIndex]!;
  const independentCoefficient = linearRow[independentIndex]!;
  const rightHandSide = linearRow[2]!;

  // From a*x + b*y = c, isolate one variable as m*x + k.
  const slope = qDiv(qSub(integer(0), independentCoefficient), dependentCoefficient);
  const intercept = qDiv(rightHandSide, dependentCoefficient);
  const dependentExpression = add(intercept, mul(slope, symbol(independent)));

  let reducedExpression: Expr;
  let reducedPolynomial;
  try {
    reducedExpression = expand(substitute(
      differences[nonlinearIndex]!, { [dependent]: dependentExpression },
    ));
    reducedPolynomial = polynomialFromExpr(reducedExpression);
  } catch (error) {
    return {
      status: "unsupported", variables: names, solutions: [],
      message: error instanceof Error ? error.message : "Substitution did not produce a polynomial.",
    };
  }

  if ([...reducedPolynomial.terms.values()].some(term =>
    [...term.monomial.powers.keys()].some(name => name !== independent))) {
    return {
      status: "unsupported", variables: names, solutions: [],
      message: "Substitution did not reduce the equation to one variable.",
    };
  }
  const degree = polynomialDegree(reducedPolynomial, independent);
  if (degree > 2) {
    return {
      status: "unsupported", variables: names, solutions: [],
      message: `After substitution, the equation has degree ${degree}; this solver supports degree at most two.`,
    };
  }

  const univariateResult = solve(reducedExpression, independent);
  if (univariateResult.status === "none") {
    return { status: "none", variables: names, solutions: [], message: "The equations have no common solution." };
  }
  if (univariateResult.status === "unsupported") {
    return {
      status: "unsupported", variables: names, solutions: [],
      message: univariateResult.message ?? "The reduced equation could not be solved exactly.",
    };
  }
  if (univariateResult.status === "all") {
    const parameter = freshSystemParameter(names);
    const parameterExpr = symbol(parameter);
    const family: Record<string, Expr> = {
      [independent]: parameterExpr,
      [dependent]: simplifyRadicals(substitute(dependentExpression, { [independent]: parameterExpr })),
    };
    return {
      status: "infinite", variables: names, solutions: [family], parameters: [parameter],
      message: "The nonlinear equation is redundant after substitution; the system describes a family of solutions.",
    };
  }

  const solutions = univariateResult.solutions.map(root => {
    const independentValue = simplifyRadicals(root);
    const dependentValue = simplifyRadicals(substitute(
      dependentExpression, { [independent]: independentValue },
    ));
    return {
      [independent]: independentValue,
      [dependent]: dependentValue,
    } satisfies Record<string, Expr>;
  });

  return { status: "finite", variables: names, solutions };
}
