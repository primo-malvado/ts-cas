import {
  add, fn, integer, isNumeric, isZero, mul, negate, numericAdd, numericDiv,
  numericMul, numericParts, pow, rational, structuralKey, symbol, type Expr, type NumericExpr,
} from "../core/expr.js";
import { polynomialCoefficient, polynomialDegree, polynomialFromExpr, polynomialToExpr } from "./polynomial.js";
import { factorPolynomial } from "./factor.js";
import { simplify } from "./simplify.js";
import { exactRationalSquareRoot, simplifyRadicals } from "./radicals.js";
import { expand } from "./expand.js";
import { substitute } from "./substitute.js";
import {
  createPolynomialRootCertificate,
  type PolynomialRootCertificateCreationResult,
  type PolynomialRootCertificateOptions,
} from "../numeric/root-certificates.js";

export type EquationSolveStatus = "finite" | "infinite" | "partial" | "none" | "all" | "unsupported";

export interface EquationSolution {
  readonly variable: string;
  /** Degree of the normalized polynomial, or -1 for zero or non-polynomial expressions. */
  readonly degree: number;
  /** Exact roots, or solution-family expressions when status is infinite. */
  readonly solutions: readonly Expr[];
  readonly status: EquationSolveStatus;
  /** Integer parameter used by each solution family, when status is infinite. */
  readonly parameter?: { readonly name: string; readonly domain: "integer" };
  /** Method used for solutions that require special handling by consumers. */
  readonly method?: "quartic-formula" | "constant-coefficients" | "principal-power";
  readonly message?: string;
}

export interface CertifiedEquationSolution {
  /** Existing exact symbolic solver output, unchanged. */
  readonly exact: EquationSolution;
  /** Certified representation of every distinct real root in the supported range. */
  readonly realRoots: PolynomialRootCertificateCreationResult;
}

export type EquationSolveRule =
  | "normalize-to-zero"
  | "classify-polynomial-degree"
  | "constant-equation"
  | "linear-formula"
  | "quadratic-discriminant"
  | "quadratic-formula"
  | "factor-over-rationals"
  | "report-solver-status"
  | "principal-power-inversion"
  | "trigonometric-periodicity"
  | "unsupported-input";

export interface EquationSolveStep {
  readonly rule: EquationSolveRule;
  readonly expression?: Expr;
  readonly degree?: number;
  readonly coefficients?: readonly Expr[];
  readonly factors?: readonly { readonly expression: Expr; readonly multiplicity: number }[];
  readonly solutions?: readonly Expr[];
  readonly status?: EquationSolveStatus;
  readonly message?: string;
}

export interface EquationSolveExplanation {
  readonly result: EquationSolution;
  readonly steps: readonly EquationSolveStep[];
}

export interface EquationSolveVerificationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

function asNumeric(expr: Expr): NumericExpr {
  if (!isNumeric(expr)) throw new TypeError("Expected an exact rational coefficient.");
  return expr;
}

function coefficient(expr: Expr, variable: string, exponent: number): NumericExpr {
  const polynomial = polynomialFromExpr(expr);
  const coeffPoly = polynomialToExpr({
    kind: "Polynomial",
    terms: new Map([...polynomial.terms.entries()].filter(([, term]) => {
      if ((term.monomial.powers.get(variable) ?? 0) !== exponent) return false;
      return [...term.monomial.powers.keys()].every(name => name === variable);
    }).map(([key, term]) => {
      const powers = new Map(term.monomial.powers);
      powers.delete(variable);
      return [key, { monomial: { powers }, coefficient: term.coefficient }] as const;
    }))
  });
  // The expression is guaranteed numeric only for a univariate polynomial.
  return asNumeric(coeffPoly);
}

function isNumericZero(value: NumericExpr): boolean {
  return value.kind === "Integer" ? value.value === 0n : value.numerator === 0n;
}

function sqrtExpr(value: NumericExpr): Expr {
  const exact = exactRationalSquareRoot(value);
  return exact ?? fn("sqrt", value);
}

function divideExpr(numerator: Expr, denominator: NumericExpr): Expr {
  return mul(numerator, numericDiv(integer(1), denominator));
}

function square(value: NumericExpr): NumericExpr {
  return numericMul(value, value) as NumericExpr;
}

function discriminant(a: NumericExpr, b: NumericExpr, c: NumericExpr): NumericExpr {
  const fourAC = numericMul(integer(4), numericMul(a, c) as NumericExpr) as NumericExpr;
  return numericAdd(square(b), numericMul(integer(-1), fourAC) as NumericExpr) as NumericExpr;
}

function symbolicDiscriminant(a: NumericExpr, b: NumericExpr, c: Expr): Expr {
  return isNumeric(c)
    ? discriminant(a, b, c)
    : simplify(add(square(b), mul(integer(-4), a, c)));
}

function solveWithConstantCoefficients(
  polynomial: ReturnType<typeof polynomialFromExpr>,
  variable: string,
  degree: number,
): EquationSolution | null {
  if (degree !== 1 && degree !== 2) return null;
  const c = polynomialToExpr(polynomialCoefficient(polynomial, variable, 0));
  const b = polynomialToExpr(polynomialCoefficient(polynomial, variable, 1));
  const a = polynomialToExpr(polynomialCoefficient(polynomial, variable, 2));
  if (!isNumeric(a) || !isNumeric(b)) return null;

  if (degree === 1) {
    return {
      variable, degree, status: "finite", method: "constant-coefficients",
      solutions: [divideExpr(negate(c), b)],
    };
  }

  let roots: Expr[];
  if (isNumericZero(b)) {
    const radicand = simplify(divideExpr(negate(c), a));
    const root = isNumeric(radicand) ? sqrtExpr(radicand) : fn("sqrt", radicand);
    roots = isZero(root) ? [root] : [root, negate(root)];
  } else {
    const d = symbolicDiscriminant(a, b, c);
    const radical = isNumeric(d) ? sqrtExpr(d) : fn("sqrt", d);
    const denominator = asNumeric(numericMul(integer(2), a));
    roots = [
      divideExpr(add(negate(b), radical), denominator),
      divideExpr(add(negate(b), negate(radical)), denominator),
    ];
    if (isZero(radical)) roots.pop();
  }
  return { variable, degree, solutions: roots, status: "finite", method: "constant-coefficients" };
}

function solveQuarticFactor(expression: Expr, variable: string): Expr[] {
  const a = coefficient(expression, variable, 4);
  const b = asNumeric(numericDiv(coefficient(expression, variable, 3), a));
  const c = asNumeric(numericDiv(coefficient(expression, variable, 2), a));
  const d = asNumeric(numericDiv(coefficient(expression, variable, 1), a));
  const e = asNumeric(numericDiv(coefficient(expression, variable, 0), a));
  const plus = (x: NumericExpr, y: NumericExpr) => asNumeric(numericAdd(x, y));
  const times = (x: NumericExpr, y: NumericExpr) => asNumeric(numericMul(x, y));
  const scale = (x: NumericExpr, n: bigint, den = 1n) =>
    times(x, asNumeric(rational(n, den)));
  const b2 = times(b, b);
  const p = plus(c, scale(b2, -3n, 8n));
  const q = plus(plus(d, scale(times(b, c), -1n, 2n)), scale(times(b2, b), 1n, 8n));
  const r = plus(
    plus(e, scale(times(b, d), -1n, 4n)),
    plus(scale(times(b2, c), 1n, 16n), scale(times(b2, b2), -3n, 256n)),
  );
  const shift = scale(b, -1n, 4n);
  if (isNumericZero(q)) {
    const discriminant = plus(times(p, p), scale(r, -4n));
    const radical = sqrtExpr(discriminant);
    const values = isNumericZero(discriminant)
      ? [scale(p, -1n, 2n)]
      : [
          mul(rational(1n, 2n), add(negate(p), radical)),
          mul(rational(1n, 2n), add(negate(p), negate(radical))),
        ];
    return values.flatMap(value => {
      const root = isNumeric(value) ? sqrtExpr(value) : fn("sqrt", value);
      return isZero(root) ? [shift] : [add(shift, root), add(shift, negate(root))];
    });
  }

  // Ferrari's resolvent for z = u^2: z^3 + 2p*z^2 + (p^2 - 4r)*z - q^2 = 0.
  const A = scale(p, 2n);
  const B = plus(times(p, p), scale(r, -4n));
  const C = scale(times(q, q), -1n);
  const P = plus(B, scale(times(A, A), -1n, 3n));
  const Q = plus(plus(scale(times(times(A, A), A), 2n, 27n), scale(times(A, B), -1n, 3n)), C);
  const delta = plus(scale(times(Q, Q), 1n, 4n), scale(times(times(P, P), P), 1n, 27n));

  let z: Expr;
  if (isNumericZero(P) && isNumericZero(Q)) {
    z = scale(A, -1n, 3n);
  } else {
    const sqrtDelta = sqrtExpr(delta);
    const sqrtSign = isNumericZero(P) && numericParts(Q)[0] > 0n ? -1 : 1;
    const cubeBase = add(scale(Q, -1n, 2n), mul(integer(sqrtSign), sqrtDelta));
    const u = pow(cubeBase, rational(1n, 3n));
    z = add(u, mul(scale(P, -1n, 3n), pow(u, integer(-1))), scale(A, -1n, 3n));
  }
  const u = fn("sqrt", z);
  const twoQOverU = mul(scale(q, 2n), pow(u, integer(-1)));
  const common = add(scale(p, -2n), negate(z));
  const firstRadical = fn("sqrt", add(common, negate(twoQOverU)));
  const secondRadical = fn("sqrt", add(common, twoQOverU));
  return [
    add(shift, mul(rational(1n, 2n), add(u, firstRadical))),
    add(shift, mul(rational(1n, 2n), add(u, negate(firstRadical)))),
    add(shift, mul(rational(1n, 2n), add(negate(u), secondRadical))),
    add(shift, mul(rational(1n, 2n), add(negate(u), negate(secondRadical)))),
  ];
}

function solveElementaryTrig(expression: Expr, variable: string): EquationSolution | null {
  if (variable === "pi" || variable === "E") return null;
  const terms = expression.kind === "Add" ? expression.terms : [expression];
  const nonconstant = terms.filter(term => !isNumeric(term));
  if (nonconstant.length !== 1) return null;
  const factors = nonconstant[0]!.kind === "Mul" ? nonconstant[0]!.factors : [nonconstant[0]!];
  const functions = factors.filter(factor => !isNumeric(factor));
  const trig = functions[0];
  if (functions.length !== 1 || !trig || trig.kind !== "Function" ||
      (trig.name !== "sin" && trig.name !== "cos") || trig.args.length !== 1) return null;

  const multiplier = factors.filter(isNumeric).reduce<NumericExpr>(
    (product, factor) => asNumeric(numericMul(product, factor)), integer(1),
  );
  if (isNumericZero(multiplier)) return null;
  const constant = terms.filter(isNumeric).reduce<NumericExpr>(
    (sum, term) => asNumeric(numericAdd(sum, term)), integer(0),
  );
  const target = asNumeric(numericDiv(negate(constant) as NumericExpr, multiplier));
  const [targetNumerator, targetDenominator] = numericParts(target);
  if (targetNumerator !== 0n && targetNumerator !== targetDenominator &&
      targetNumerator !== -targetDenominator) return null;

  let argumentPolynomial: ReturnType<typeof polynomialFromExpr>;
  try {
    argumentPolynomial = polynomialFromExpr(trig.args[0]!);
  } catch {
    return null;
  }
  if (!isUnivariateEquation(argumentPolynomial, variable) ||
      polynomialDegree(argumentPolynomial, variable) !== 1) return null;
  const slope = asNumeric(polynomialToExpr(polynomialCoefficient(argumentPolynomial, variable, 1)));
  const intercept = asNumeric(polynomialToExpr(polynomialCoefficient(argumentPolynomial, variable, 0)));
  if (isNumericZero(slope)) return null;

  const parameterName = variable === "k" ? "n" : "k";
  const period = targetNumerator === 0n ? integer(1) : integer(2);
  const offset = targetNumerator === 0n
    ? trig.name === "sin" ? integer(0) : rational(1n, 2n)
    : trig.name === "sin" ? rational(targetNumerator > 0n ? 1n : -1n, 2n)
    : targetNumerator > 0n ? integer(0) : integer(1);
  const angle = mul(symbol("pi"), add(offset, mul(period, symbol(parameterName))));
  const solution = mul(add(angle, negate(intercept)), numericDiv(integer(1), slope));
  return {
    variable, degree: -1, status: "infinite", solutions: [solution],
    parameter: { name: parameterName, domain: "integer" },
    message: `${parameterName} is any integer; the solution family covers real roots.`,
  };
}

function solvePrincipalPower(expression: Expr, variable: string): EquationSolution | null {
  if (variable === "pi" || variable === "E" || variable === "i") return null;
  const terms = expression.kind === "Add" ? expression.terms : [expression];
  const nonconstant = terms.filter(term => !isNumeric(term));
  if (nonconstant.length !== 1) return null;
  const factors = nonconstant[0]!.kind === "Mul" ? nonconstant[0]!.factors : [nonconstant[0]!];
  const symbolicFactors = factors.filter(factor => !isNumeric(factor));
  const power = symbolicFactors[0];
  if (symbolicFactors.length !== 1 || !power || power.kind !== "Pow" ||
      power.base.kind !== "Symbol" || power.base.name !== variable ||
      power.exponent.kind !== "Function" || power.exponent.name !== "sqrt" ||
      power.exponent.args.length !== 1 || !isNumeric(power.exponent.args[0]!)) return null;
  const [numerator, denominator] = numericParts(power.exponent.args[0]!);
  if (numerator <= 0n || numerator >= 4n * denominator) return null;

  const multiplier = factors.filter(isNumeric).reduce<NumericExpr>(
    (product, factor) => asNumeric(numericMul(product, factor)), integer(1),
  );
  if (isNumericZero(multiplier)) return null;
  const constant = terms.filter(isNumeric).reduce<NumericExpr>(
    (sum, term) => asNumeric(numericAdd(sum, term)), integer(0),
  );
  const target = asNumeric(numericDiv(negate(constant) as NumericExpr, multiplier));
  if (numericParts(target)[0] <= 0n) return null;

  const reciprocal = mul(power.exponent, numericDiv(integer(1), power.exponent.args[0]!));
  const root = pow(target, reciprocal);
  return {
    variable, degree: -1, status: "finite", method: "principal-power", solutions: [root],
    message: "The solution is unique on the principal complex power branch and is positive real.",
  };
}

/**
 * Solve `expression = 0` for a variable. Supports univariate polynomials of degree 0, 1 or 2
 * with exact rational coefficients, selected polynomial terms in parameters,
 * selected real trigonometric equations, and selected principal-branch powers.
 * Irrational quadratic roots are returned symbolically.
 */
export function solve(expression: Expr, variable: string): EquationSolution {
  let polynomial;
  try {
    polynomial = polynomialFromExpr(expression);
  } catch (error) {
    const trigResult = solveElementaryTrig(expression, variable);
    if (trigResult) return trigResult;
    const powerResult = solvePrincipalPower(expression, variable);
    if (powerResult) return powerResult;
    return {
      variable, degree: -1, solutions: [], status: "unsupported",
      message: error instanceof Error ? error.message : "Expression is not polynomial."
    };
  }

  const degree = polynomialDegree(polynomial, variable);
  for (const term of polynomial.terms.values()) {
    if ([...term.monomial.powers.keys()].some(name => name !== variable)) {
      const constantResult = solveWithConstantCoefficients(polynomial, variable, degree);
      if (constantResult) return constantResult;
      return {
        variable, degree, solutions: [], status: "unsupported",
        message: "Symbolic parameters are supported only in the constant term of linear and quadratic equations with rational variable coefficients.",
      };
    }
  }

  if (polynomial.terms.size === 0) return { variable, degree: -1, solutions: [], status: "all" };
  if (degree === 0) return { variable, degree, solutions: [], status: "none" };
  if (degree > 2) {
    // Solve the linear, quadratic, and quartic factors found over the rationals.
    try {
      const factorization = factorPolynomial(polynomial, variable);
      const roots: Expr[] = [];
      let unresolvedFactors = 0;
      let usedQuarticFormula = false;
      for (const item of factorization.factors) {
        const factorDegree = polynomialDegree(item.factor, variable);
        if (factorDegree < 1) continue;
        if (factorDegree > 2) {
          if (factorDegree === 4) {
            roots.push(...solveQuarticFactor(polynomialToExpr(item.factor), variable));
            usedQuarticFormula = true;
            continue;
          }
          unresolvedFactors++;
          continue;
        }
        const partial = solve(polynomialToExpr(item.factor), variable);
        if (partial.status === "finite") roots.push(...partial.solutions);
        else if (partial.status === "unsupported") unresolvedFactors++;
      }
      const uniqueRoots = roots.filter((root, index) => roots.findIndex(other =>
        JSON.stringify(root, (_key, value) => typeof value === "bigint" ? value.toString() : value)
          === JSON.stringify(other, (_key, value) => typeof value === "bigint" ? value.toString() : value)
      ) === index);
      if (uniqueRoots.length > 0) {
        return unresolvedFactors > 0
          ? {
              variable, degree, solutions: uniqueRoots, status: "partial",
              ...(usedQuarticFormula ? { method: "quartic-formula" as const } : {}),
              message: `${unresolvedFactors} factor(s) remain unsolved; listed roots are exact but the solution list may be incomplete.`
            }
          : {
              variable, degree, solutions: uniqueRoots, status: "finite",
              ...(usedQuarticFormula ? { method: "quartic-formula" as const } : {}),
              message: usedQuarticFormula
                ? "Quartic solutions use principal complex square and cube roots."
                : "All polynomial factors were resolved by the supported exact rules."
            };
      }
      return {
        variable, degree, solutions: [], status: "unsupported",
        message: "No solvable linear, quadratic, or quartic factors were found by the current exact solver."
      };
    } catch (error) {
      return {
        variable, degree, solutions: [], status: "unsupported",
        message: error instanceof Error ? error.message : "Higher-degree factorization failed."
      };
    }
  }

  let a: NumericExpr, b: NumericExpr, c: NumericExpr;
  try {
    c = coefficient(expression, variable, 0);
    b = coefficient(expression, variable, 1);
    a = coefficient(expression, variable, 2);
  } catch (error) {
    return { variable, degree, solutions: [], status: "unsupported", message: error instanceof Error ? error.message : "Unsupported coefficients." };
  }

  if (degree === 1 || isNumericZero(a)) {
    if (isNumericZero(b)) return { variable, degree, solutions: [], status: isNumericZero(c) ? "all" : "none" };
    return { variable, degree: 1, solutions: [numericDiv(negate(c) as NumericExpr, b)], status: "finite" };
  }

  const d = discriminant(a, b, c);
  const [dn] = numericParts(d);
  if (dn < 0n) {
    // Keep complex roots symbolic rather than incorrectly claiming no solutions over C.
    const sqrtD = fn("sqrt", d);
    const denominator = numericMul(integer(2), a) as NumericExpr;
    return {
      variable, degree: 2,
      solutions: [
        divideExpr(add(negate(b), sqrtD), denominator),
        divideExpr(add(negate(b), negate(sqrtD)), denominator),
      ], status: "finite",
      message: "The roots are represented symbolically; they are not real-valued."
    };
  }

  const sqrtD = sqrtExpr(d);
  const denominator = numericMul(integer(2), a) as NumericExpr;
  const roots = [
    divideExpr(add(negate(b), sqrtD), denominator),
    divideExpr(add(negate(b), negate(sqrtD)), denominator),
  ];
  const uniqueRoots = roots.filter((root, index) => roots.findIndex(other => {
    // Structural equality is enough for the exact repeated-root case.
    return JSON.stringify(root, (_key, value) => typeof value === "bigint" ? value.toString() : value)
      === JSON.stringify(other, (_key, value) => typeof value === "bigint" ? value.toString() : value);
  }) === index);
  return { variable, degree: 2, solutions: uniqueRoots, status: "finite" };
}

/** Convenience helper for a two-sided equation: solve `left - right = 0`. */
export function solveEquation(left: Expr, right: Expr, variable: string): EquationSolution {
  return solve(add(left, negate(right)), variable);
}

/**
 * Combine the existing symbolic solver with a Sturm certificate for the full
 * real root set. This provides certified real solutions when closed forms are
 * not available from the symbolic solver.
 */
export function solveWithCertificates(
  expression: Expr,
  variable: string,
  options?: PolynomialRootCertificateOptions,
): CertifiedEquationSolution {
  return {
    exact: solve(expression, variable),
    realRoots: createPolynomialRootCertificate(expression, variable, options),
  };
}

/**
 * Solve an equation and return language-neutral steps describing the exact
 * polynomial rules used by the current solver.
 */
export function solveWithSteps(expression: Expr, variable: string): EquationSolveExplanation {
  const result = solve(expression, variable);
  const steps: EquationSolveStep[] = [
    { rule: "normalize-to-zero", expression: simplify(expression) },
  ];

  if (result.method === "principal-power") {
    steps.push({
      rule: "principal-power-inversion",
      status: result.status,
      solutions: result.solutions,
      ...(result.message === undefined ? {} : { message: result.message }),
    });
    return { result, steps };
  }

  if (result.status === "infinite") {
    steps.push({
      rule: "trigonometric-periodicity",
      status: result.status,
      solutions: result.solutions,
      ...(result.message === undefined ? {} : { message: result.message }),
    });
    return { result, steps };
  }

  let polynomial;
  try {
    polynomial = polynomialFromExpr(expression);
  } catch (error) {
    steps.push({
      rule: "unsupported-input",
      status: result.status,
      ...(result.message === undefined ? {} : { message: result.message }),
    });
    return { result, steps };
  }
  if (!isUnivariateEquation(polynomial, variable) && result.method !== "constant-coefficients") {
    steps.push({
      rule: "unsupported-input",
      status: result.status,
      message: result.message ?? "Only supported polynomial equations can be explained.",
    });
    return { result, steps };
  }

  const degree = polynomialDegree(polynomial, variable);
  steps.push({ rule: "classify-polynomial-degree", degree });
  if (degree <= 0) {
    const constant = degree < 0 ? integer(0) : polynomialToExpr(polynomialCoefficient(polynomial, variable, 0));
    steps.push({
      rule: "constant-equation",
      expression: constant,
      status: result.status,
      solutions: result.solutions,
    });
    return { result, steps };
  }

  if (degree === 1) {
    const b = polynomialToExpr(polynomialCoefficient(polynomial, variable, 1));
    const c = polynomialToExpr(polynomialCoefficient(polynomial, variable, 0));
    steps.push({
      rule: "linear-formula",
      coefficients: [b, c],
      solutions: result.solutions,
    });
    return { result, steps };
  }

  if (degree === 2) {
    const a = asNumeric(polynomialToExpr(polynomialCoefficient(polynomial, variable, 2)));
    const b = asNumeric(polynomialToExpr(polynomialCoefficient(polynomial, variable, 1)));
    const c = polynomialToExpr(polynomialCoefficient(polynomial, variable, 0));
    steps.push({
      rule: "quadratic-discriminant",
      coefficients: [a, b, c],
      expression: symbolicDiscriminant(a, b, c),
    });
    steps.push({ rule: "quadratic-formula", solutions: result.solutions });
    return { result, steps };
  }

  try {
    const factorization = factorPolynomial(polynomial, variable);
    steps.push({
      rule: "factor-over-rationals",
      factors: factorization.factors.map(item => ({
        expression: polynomialToExpr(item.factor),
        multiplicity: item.multiplicity,
      })),
    });
  } catch (error) {
    steps.push({
      rule: "factor-over-rationals",
      factors: [],
      message: error instanceof Error ? error.message : "Exact factorization failed.",
    });
  }
  steps.push({
    rule: "report-solver-status",
    status: result.status,
    solutions: result.solutions,
    ...(result.message === undefined ? {} : { message: result.message }),
  });
  return { result, steps };
}

/** Replay the solver trace and verify each reported exact solution in the input equation. */
export function verifyEquationSolveExplanation(
  expression: Expr,
  variable: string,
  explanation: EquationSolveExplanation,
): EquationSolveVerificationResult {
  try {
    const expected = solveWithSteps(expression, variable);
    const sameExpressions = (left: readonly Expr[] | undefined, right: readonly Expr[] | undefined) =>
      left === undefined
        ? right === undefined
        : right !== undefined && left.length === right.length &&
          left.every((item, index) => structuralKey(item) === structuralKey(right[index]!));
    const actualResult = explanation.result;
    if (actualResult.status !== expected.result.status ||
        actualResult.variable !== expected.result.variable ||
        actualResult.degree !== expected.result.degree ||
        actualResult.message !== expected.result.message ||
        actualResult.method !== expected.result.method ||
        actualResult.parameter?.name !== expected.result.parameter?.name ||
        actualResult.parameter?.domain !== expected.result.parameter?.domain ||
        !sameExpressions(actualResult.solutions, expected.result.solutions) ||
        explanation.steps.length !== expected.steps.length) {
      return { valid: false, errors: ["Equation-solve explanation does not match a replay."] };
    }

    for (let index = 0; index < expected.steps.length; index++) {
      const actual = explanation.steps[index]!;
      const replayed = expected.steps[index]!;
      if (actual.rule !== replayed.rule || actual.degree !== replayed.degree ||
          actual.status !== replayed.status || actual.message !== replayed.message ||
          (actual.expression === undefined) !== (replayed.expression === undefined) ||
          actual.expression !== undefined && replayed.expression !== undefined &&
            structuralKey(actual.expression) !== structuralKey(replayed.expression) ||
          !sameExpressions(actual.coefficients, replayed.coefficients) ||
          !sameExpressions(actual.solutions, replayed.solutions) ||
          (actual.factors?.length ?? -1) !== (replayed.factors?.length ?? -1) ||
          actual.factors?.some((factor, factorIndex) =>
            factor.multiplicity !== replayed.factors![factorIndex]!.multiplicity ||
            structuralKey(factor.expression) !==
              structuralKey(replayed.factors![factorIndex]!.expression))) {
        return { valid: false, errors: [`Equation-solve step ${index} does not match a replay.`] };
      }
    }

    let polynomial: ReturnType<typeof polynomialFromExpr>;
    try {
      polynomial = polynomialFromExpr(expression);
    } catch {
      if (actualResult.method === "principal-power") {
        return { valid: false, errors: ["Independent verification of principal-power solutions is not supported."] };
      }
      if (actualResult.status === "infinite") {
        return { valid: true, errors: [] };
      }
      return actualResult.solutions.length === 0
        ? { valid: true, errors: [] }
        : { valid: false, errors: ["A non-polynomial input cannot certify exact polynomial roots."] };
    }
    if (actualResult.method === "quartic-formula") {
      return { valid: false, errors: ["Independent verification of quartic radical solutions is not supported."] };
    }
    for (const solution of actualResult.solutions) {
      const residual = simplify(expand(simplifyRadicals(simplify(expand(substitute(
        expression,
        { [variable]: solution },
      ))))));
      if (!isNumeric(residual) || numericParts(residual)[0] !== 0n) {
        return { valid: false, errors: ["A reported solution does not satisfy the input equation exactly."] };
      }
    }
    if (!isUnivariateEquation(polynomial, variable) && actualResult.method !== "constant-coefficients") {
      return actualResult.solutions.length === 0
        ? { valid: true, errors: [] }
        : { valid: false, errors: ["The input is not a univariate polynomial equation."] };
    }
    return { valid: true, errors: [] };
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : "Could not verify equation-solve explanation."],
    };
  }
}

function isUnivariateEquation(
  polynomial: ReturnType<typeof polynomialFromExpr>,
  variable: string,
): boolean {
  return [...polynomial.terms.values()].every(term =>
    [...term.monomial.powers.keys()].every(name => name === variable),
  );
}
