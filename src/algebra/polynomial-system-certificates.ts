import {
  add, fn, integer, isNumeric, mul, numericAdd, numericDiv, numericMul, numericParts, pow,
  rational, structuralKey, symbol, type Expr, type NumericExpr,
} from "../core/expr.js";
import { polynomialDegree, polynomialFromExpr, type Polynomial } from "./polynomial.js";
import { expand } from "./expand.js";
import { simplify } from "./simplify.js";
import { simplifyRadicals } from "./radicals.js";
import { substitute } from "./substitute.js";
import { solvePolynomialSystem, type PolynomialEquation } from "./system.js";
import {
  createPolynomialRootCertificate,
  verifyPolynomialRootCertificate,
  type PolynomialRootCertificate,
} from "../numeric/root-certificates.js";

export type SerializedExactExpression =
  | { readonly kind: "Integer"; readonly value: string }
  | { readonly kind: "Rational"; readonly numerator: string; readonly denominator: string }
  | { readonly kind: "Symbol"; readonly name: string }
  | { readonly kind: "Add"; readonly terms: readonly SerializedExactExpression[] }
  | { readonly kind: "Mul"; readonly factors: readonly SerializedExactExpression[] }
  | { readonly kind: "Pow"; readonly base: SerializedExactExpression; readonly exponent: SerializedExactExpression }
  | { readonly kind: "Function"; readonly name: string; readonly args: readonly SerializedExactExpression[] };

export interface PolynomialSystemWitnessCertificate {
  readonly version: 1;
  readonly variables: readonly string[];
  readonly equations: readonly {
    readonly left: SerializedExactExpression;
    readonly right: SerializedExactExpression;
  }[];
  /** Every point is a verified solution; this does not assert that the list is exhaustive. */
  readonly witnesses: readonly (readonly SerializedExactExpression[])[];
}

export type PolynomialSystemWitnessCreationResult =
  | { readonly status: "certified-witnesses"; readonly certificate: PolynomialSystemWitnessCertificate }
  | { readonly status: "none" | "infinite" | "unsupported"; readonly message: string };

export interface PolynomialSystemWitnessVerificationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface PolynomialSystemCompletenessCertificate {
  readonly version: 1;
  readonly independentVariable: string;
  readonly dependentVariable: string;
  readonly reducedRoots: PolynomialRootCertificate;
  readonly witnessCertificate?: PolynomialSystemWitnessCertificate;
}

export type PolynomialSystemCompletenessCreationResult =
  | { readonly status: "complete"; readonly certificate: PolynomialSystemCompletenessCertificate }
  | { readonly status: "none" | "infinite" | "unsupported"; readonly message: string };

export interface PolynomialSystemCompletenessVerificationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

interface DecodeState {
  nodes: number;
}

function serializeExpression(expression: Expr): SerializedExactExpression {
  switch (expression.kind) {
    case "Integer":
      return { kind: "Integer", value: expression.value.toString() };
    case "Rational":
      return {
        kind: "Rational",
        numerator: expression.numerator.toString(),
        denominator: expression.denominator.toString(),
      };
    case "Symbol":
      return { kind: "Symbol", name: expression.name };
    case "Add":
      return { kind: "Add", terms: expression.terms.map(serializeExpression) };
    case "Mul":
      return { kind: "Mul", factors: expression.factors.map(serializeExpression) };
    case "Pow":
      return {
        kind: "Pow",
        base: serializeExpression(expression.base),
        exponent: serializeExpression(expression.exponent),
      };
    case "Function":
      return { kind: "Function", name: expression.name, args: expression.args.map(serializeExpression) };
  }
}

function readInteger(value: unknown): bigint {
  if (typeof value !== "string" || value.length > 1_024 ||
      !/^-?(0|[1-9][0-9]*)$/.test(value)) {
    throw new TypeError("Serialized integer is malformed.");
  }
  return BigInt(value);
}

function deserializeExpression(
  value: unknown,
  state: DecodeState,
  depth = 0,
): Expr {
  if (depth > 64 || ++state.nodes > 2_048 ||
      typeof value !== "object" || value === null || !("kind" in value) ||
      typeof value.kind !== "string") {
    throw new TypeError("Serialized expression is malformed or exceeds safety limits.");
  }
  switch (value.kind) {
    case "Integer":
      if (!("value" in value)) throw new TypeError("Serialized integer is missing its value.");
      return integer(readInteger(value.value));
    case "Rational": {
      if (!("numerator" in value) || !("denominator" in value)) {
        throw new TypeError("Serialized rational is missing a component.");
      }
      const numerator = readInteger(value.numerator);
      const denominator = readInteger(value.denominator);
      if (denominator <= 0n) throw new TypeError("Serialized rational denominator must be positive.");
      const result = rational(numerator, denominator);
      if (result.kind === "Integer" && numerator !== result.value ||
          result.kind === "Rational" &&
            (result.numerator !== numerator || result.denominator !== denominator)) {
        throw new TypeError("Serialized rational must be reduced.");
      }
      return result;
    }
    case "Symbol":
      if (!("name" in value) || typeof value.name !== "string") {
        throw new TypeError("Serialized symbol is malformed.");
      }
      return symbol(value.name);
    case "Add": {
      if (!("terms" in value) || !Array.isArray(value.terms) ||
          value.terms.length === 0 || value.terms.length > 512) {
        throw new TypeError("Serialized sum or product is malformed.");
      }
      const children = value.terms.map((child: unknown) =>
        deserializeExpression(child, state, depth + 1));
      return add(...children);
    }
    case "Mul": {
      if (!("factors" in value) || !Array.isArray(value.factors) ||
          value.factors.length === 0 || value.factors.length > 512) {
        throw new TypeError("Serialized sum or product is malformed.");
      }
      const children = value.factors.map((child: unknown) =>
        deserializeExpression(child, state, depth + 1));
      return mul(...children);
    }
    case "Pow":
      if (!("base" in value) || !("exponent" in value)) {
        throw new TypeError("Serialized power is malformed.");
      }
      const base = deserializeExpression(value.base, state, depth + 1);
      const exponent = deserializeExpression(value.exponent, state, depth + 1);
      if (exponent.kind === "Integer" &&
          (exponent.value > 16n || exponent.value < -16n)) {
        throw new RangeError("Serialized integer exponents are limited to magnitude 16.");
      }
      return pow(base, exponent);
    case "Function":
      if (!("name" in value) || typeof value.name !== "string" ||
          !("args" in value) || !Array.isArray(value.args) || value.args.length > 16) {
        throw new TypeError("Serialized function is malformed.");
      }
      return fn(value.name, ...value.args.map((arg: unknown) =>
        deserializeExpression(arg, state, depth + 1)));
    default:
      throw new TypeError("Serialized expression uses an unknown node kind.");
  }
}

function validatePolynomialSystem(
  equations: readonly PolynomialEquation[],
  variables: readonly string[],
): void {
  if (variables.length !== 2 || new Set(variables).size !== variables.length ||
      variables.some(variable => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable))) {
    throw new TypeError("Provide two distinct valid variables.");
  }
  if (equations.length !== 2) throw new TypeError("Provide exactly two polynomial equations.");
  for (const equation of equations) {
    const polynomial = polynomialFromExpr(add(equation.left, mul(integer(-1), equation.right)));
    for (const term of polynomial.terms.values()) {
      if (!isNumeric(term.coefficient)) throw new TypeError("Polynomial coefficients must be rational.");
      let totalDegree = 0;
      for (const [name, exponent] of term.monomial.powers) {
        if (!variables.includes(name) || exponent < 0) {
          throw new TypeError("Equations must use only the declared polynomial variables.");
        }
        totalDegree += exponent;
      }
      if (totalDegree > 16) throw new RangeError("Polynomial degree exceeds the witness-certificate limit of 16.");
    }
  }
}

function exactNumeric(value: Expr): NumericExpr {
  if (!isNumeric(value)) throw new TypeError("Expected exact rational arithmetic.");
  return value;
}

function linearCoefficients(
  expression: Expr,
  variables: readonly string[],
): readonly NumericExpr[] | null {
  const coefficients = variables.map(() => integer(0) as NumericExpr);
  let constant: NumericExpr = integer(0);
  let polynomial: Polynomial;
  try {
    polynomial = polynomialFromExpr(expression);
  } catch {
    return null;
  }
  for (const term of polynomial.terms.values()) {
    let variableIndex = -1;
    for (const [name, exponent] of term.monomial.powers) {
      const index = variables.indexOf(name);
      if (index < 0 || exponent !== 1 || variableIndex !== -1) return null;
      variableIndex = index;
    }
    if (variableIndex === -1) {
      constant = exactNumeric(numericAdd(constant, term.coefficient));
    } else {
      coefficients[variableIndex] = exactNumeric(
        numericAdd(coefficients[variableIndex]!, term.coefficient),
      );
    }
  }
  return [...coefficients, exactNumeric(numericMul(integer(-1), constant))];
}

function reduceToUnivariateQuadratic(
  equations: readonly PolynomialEquation[],
  variables: readonly string[],
): { readonly dependent: string; readonly independent: string; readonly expression: Expr } {
  validatePolynomialSystem(equations, variables);
  const differences = equations.map(equation =>
    add(equation.left, mul(integer(-1), equation.right)));
  const rows = differences.map(difference => linearCoefficients(difference, variables));
  const isZeroCoefficient = (value: NumericExpr) => numericParts(value)[0] === 0n;
  const contradictoryConstant = rows.findIndex(row =>
    row !== null && isZeroCoefficient(row[0]!) && isZeroCoefficient(row[1]!) &&
    !isZeroCoefficient(row[2]!));
  if (contradictoryConstant >= 0) {
    return {
      dependent: variables[1]!,
      independent: variables[0]!,
      expression: differences[contradictoryConstant]!,
    };
  }
  if (rows.every(row => row !== null &&
      isZeroCoefficient(row[0]!) && isZeroCoefficient(row[1]!))) {
    return {
      dependent: variables[1]!,
      independent: variables[0]!,
      expression: integer(0),
    };
  }
  const linearEquation = rows
    .map((row, index) => ({ row, index }))
    .find(({ row }) => row !== null &&
      (numericParts(row[0]!)[0] !== 0n || numericParts(row[1]!)[0] !== 0n));
  if (!linearEquation) {
    throw new TypeError("A completeness certificate requires a non-constant linear equation for elimination.");
  }

  const { row, index } = linearEquation;
  const linearRow = row!;
  const nonlinearIndex = 1 - index;
  const dependentIndex = numericParts(linearRow[1]!)[0] === 0n ? 0 : 1;
  const independentIndex = 1 - dependentIndex;
  const dependent = variables[dependentIndex]!;
  const independent = variables[independentIndex]!;
  const dependentCoefficient = linearRow[dependentIndex]!;
  const independentCoefficient = linearRow[independentIndex]!;
  const slope = exactNumeric(numericDiv(
    exactNumeric(numericMul(integer(-1), independentCoefficient)),
    dependentCoefficient,
  ));
  const intercept = exactNumeric(numericDiv(linearRow[2]!, dependentCoefficient));
  const dependentExpression = add(intercept, mul(slope, symbol(independent)));
  const expression = expand(substitute(
    differences[nonlinearIndex]!,
    { [dependent]: dependentExpression },
  ));
  const polynomial = polynomialFromExpr(expression);
  if ([...polynomial.terms.values()].some(term =>
    [...term.monomial.powers.keys()].some(name => name !== independent)) ||
      polynomialDegree(polynomial, independent) > 2) {
    throw new TypeError("Substitution must reduce the system to a univariate polynomial of degree at most two.");
  }
  return { dependent, independent, expression };
}

function verifyPolynomialWitness(
  equations: readonly PolynomialEquation[],
  variables: readonly string[],
  values: readonly Expr[],
): boolean {
  const bindings = Object.fromEntries(variables.map((variable, index) => [variable, values[index]!]));
  for (const equation of equations) {
    const residual = simplifyRadicals(simplify(expand(substitute(
      add(equation.left, mul(integer(-1), equation.right)),
      bindings,
    ))));
    if (!isNumeric(residual) || numericParts(residual)[0] !== 0n) return false;
  }
  return true;
}

function isProvablyRealAlgebraic(expression: Expr): boolean {
  switch (expression.kind) {
    case "Integer":
    case "Rational":
      return true;
    case "Symbol":
      return false;
    case "Add":
    case "Mul":
      return expression.kind === "Add"
        ? expression.terms.every(isProvablyRealAlgebraic)
        : expression.factors.every(isProvablyRealAlgebraic);
    case "Pow":
      return expression.exponent.kind === "Integer" &&
        isProvablyRealAlgebraic(expression.base);
    case "Function":
      return expression.name === "sqrt" && expression.args.length === 1 &&
        isNumeric(expression.args[0]!) && numericParts(expression.args[0]!)[0] >= 0n;
  }
}

function fail(message: string): PolynomialSystemWitnessVerificationResult {
  return { valid: false, errors: [message] };
}

/**
 * Produce exact witnesses for the finite solution points returned by the
 * current two-variable polynomial-system solver. This proves each listed point
 * is a solution but makes no completeness claim.
 */
export function createPolynomialSystemWitnessCertificate(
  equations: readonly PolynomialEquation[],
  variables: readonly string[],
): PolynomialSystemWitnessCreationResult {
  try {
    validatePolynomialSystem(equations, variables);
  } catch (error) {
    return {
      status: "unsupported",
      message: error instanceof Error ? error.message : "The polynomial system is not supported.",
    };
  }
  const result = solvePolynomialSystem(equations, variables);
  if (result.status !== "finite") {
    return {
      status: result.status === "infinite" || result.status === "none"
        ? result.status
        : "unsupported",
      message: result.message ?? `Finite solution points are required; solver status is ${result.status}.`,
    };
  }

  const witnesses = result.solutions.map(solution =>
    variables.map(variable => solution[variable]).filter((value): value is Expr => value !== undefined));
  if (witnesses.some(witness => witness.length !== variables.length ||
      !verifyPolynomialWitness(equations, variables, witness))) {
    return {
      status: "unsupported",
      message: "The solver returned a point that could not be verified using exact simplification.",
    };
  }

  const certificate: PolynomialSystemWitnessCertificate = {
    version: 1,
    variables: [...variables],
    equations: equations.map(equation => ({
      left: serializeExpression(equation.left),
      right: serializeExpression(equation.right),
    })),
    witnesses: witnesses.map(witness => witness.map(serializeExpression)),
  };
  const verification = verifyPolynomialSystemWitnessCertificate(certificate, equations, variables);
  if (!verification.valid) {
    throw new Error(`Generated polynomial-system certificate failed verification: ${verification.errors.join("; ")}`);
  }
  return { status: "certified-witnesses", certificate };
}

/** Verify that every listed exact point satisfies every serialized equation. */
export function verifyPolynomialSystemWitnessCertificate(
  value: unknown,
  expectedEquations?: readonly PolynomialEquation[],
  expectedVariables?: readonly string[],
): PolynomialSystemWitnessVerificationResult {
  if (typeof value !== "object" || value === null ||
      !("version" in value) || value.version !== 1 ||
      !("variables" in value) || !Array.isArray(value.variables) ||
      !("equations" in value) || !Array.isArray(value.equations) ||
      !("witnesses" in value) || !Array.isArray(value.witnesses)) {
    return fail("Certificate is missing required version-1 polynomial-system fields.");
  }

  try {
    const variables = value.variables;
    if (variables.length !== 2 || variables.some((name: unknown) =>
      typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) ||
      new Set(variables).size !== variables.length ||
      value.equations.length !== 2 || value.witnesses.length === 0 ||
      value.witnesses.length > 64) {
      return fail("Certificate dimensions or variable names are invalid.");
    }
    if (expectedVariables &&
        (expectedVariables.length !== variables.length ||
          expectedVariables.some((name, index) => name !== variables[index]))) {
      return fail("Certificate variables do not match the expected variable order.");
    }

    const state: DecodeState = { nodes: 0 };
    const equations: PolynomialEquation[] = value.equations.map((item: unknown) => {
      if (typeof item !== "object" || item === null ||
          !("left" in item) || !("right" in item)) {
        throw new TypeError("A serialized polynomial equation is malformed.");
      }
      return {
        left: deserializeExpression(item.left, state),
        right: deserializeExpression(item.right, state),
      };
    });
    validatePolynomialSystem(equations, variables);

    const witnesses = value.witnesses.map((point: unknown) => {
      if (!Array.isArray(point) || point.length !== variables.length) {
        throw new TypeError("A witness point must provide one value per variable.");
      }
      return point.map((entry: unknown) => deserializeExpression(entry, state));
    });
    if (witnesses.some((point: Expr[]) => !verifyPolynomialWitness(equations, variables, point))) {
      return fail("A listed point does not satisfy every polynomial equation exactly.");
    }

    if (expectedEquations) {
      validatePolynomialSystem(expectedEquations, expectedVariables ?? variables);
      if (expectedEquations.length !== equations.length ||
          equations.some((equation, index) =>
            structuralKey(equation.left) !== structuralKey(expectedEquations[index]!.left) ||
            structuralKey(equation.right) !== structuralKey(expectedEquations[index]!.right))) {
        return fail("Certificate equations do not match the expected system.");
      }
    }
    return { valid: true, errors: [] };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not verify the polynomial-system certificate.");
  }
}

/**
 * Certify completeness for the supported case reducible to one real quadratic.
 * The Sturm certificate counts every real root; exact system witnesses prove
 * the same number of distinct points satisfies both original equations.
 */
export function createPolynomialSystemCompletenessCertificate(
    equations: readonly PolynomialEquation[],
    variables: readonly string[],
  ): PolynomialSystemCompletenessCreationResult {
    let reduction: ReturnType<typeof reduceToUnivariateQuadratic>;
    try {
      reduction = reduceToUnivariateQuadratic(equations, variables);
    } catch (error) {
      return {
        status: "unsupported",
        message: error instanceof Error ? error.message : "The system cannot be reduced to a supported quadratic.",
      };
    }

    const rootResult = createPolynomialRootCertificate(reduction.expression, reduction.independent, {
      maxDegree: 2,
    });
    if (rootResult.status === "all") {
      return {
        status: "infinite",
        message: "Elimination leaves the zero polynomial, so every value of the independent variable gives a solution.",
      };
    }
    if (rootResult.status !== "complete") {
      return {
        status: "unsupported",
        message: "A complete real-root certificate could not be created for the reduced equation.",
      };
    }
    const certificate: PolynomialSystemCompletenessCertificate = {
      version: 1,
      independentVariable: reduction.independent,
      dependentVariable: reduction.dependent,
      reducedRoots: rootResult.certificate,
    };
    if (rootResult.certificate.totalDistinctRealRoots > 0) {
      const witnesses = createPolynomialSystemWitnessCertificate(equations, variables);
      if (witnesses.status !== "certified-witnesses") {
        return { status: witnesses.status, message: witnesses.message };
      }
      return {
        status: "complete",
        certificate: { ...certificate, witnessCertificate: witnesses.certificate },
      };
    }
    return { status: "complete", certificate };
  }

/** Verify root-count completeness and a one-to-one set of exact system witnesses. */
export function verifyPolynomialSystemCompletenessCertificate(
    value: unknown,
    expectedEquations: readonly PolynomialEquation[],
    expectedVariables: readonly string[],
  ): PolynomialSystemCompletenessVerificationResult {
    const failResult = (message: string): PolynomialSystemCompletenessVerificationResult =>
      ({ valid: false, errors: [message] });
    if (typeof value !== "object" || value === null ||
        !("version" in value) || value.version !== 1 ||
        !("independentVariable" in value) || typeof value.independentVariable !== "string" ||
        !("dependentVariable" in value) || typeof value.dependentVariable !== "string" ||
        !("reducedRoots" in value)) {
      return failResult("Certificate is missing required version-1 completeness fields.");
    }

    try {
      const reduction = reduceToUnivariateQuadratic(expectedEquations, expectedVariables);
      if (value.independentVariable !== reduction.independent ||
          value.dependentVariable !== reduction.dependent) {
        return failResult("Certificate variable elimination does not match the expected system.");
      }
      const roots = value.reducedRoots;
      if (typeof roots !== "object" || roots === null || !("status" in roots) ||
          roots.status !== "complete" || !("variable" in roots) ||
          roots.variable !== reduction.independent ||
          !("totalDistinctRealRoots" in roots) ||
          typeof roots.totalDistinctRealRoots !== "number") {
        return failResult("Reduced-equation root certificate is not complete or uses the wrong variable.");
      }
      const rootVerification = verifyPolynomialRootCertificate(roots, reduction.expression);
      if (!rootVerification.valid) {
        return failResult(`Reduced-equation certificate is invalid: ${rootVerification.errors.join("; ")}`);
      }

      const rootCount = roots.totalDistinctRealRoots;
      if (rootCount === 0) {
        if ("witnessCertificate" in value && value.witnessCertificate !== undefined) {
          return failResult("An empty real solution set must not include solution witnesses.");
        }
        return { valid: true, errors: [] };
      }

      if (!("witnessCertificate" in value)) {
        return failResult("A non-empty complete solution set requires exact witnesses.");
      }
      const witnesses = value.witnessCertificate;
      const witnessVerification = verifyPolynomialSystemWitnessCertificate(
        witnesses,
        expectedEquations,
        expectedVariables,
      );
      if (!witnessVerification.valid) {
        return failResult(`System witnesses are invalid: ${witnessVerification.errors.join("; ")}`);
      }
      if (typeof witnesses !== "object" || witnesses === null ||
          !("witnesses" in witnesses) || !Array.isArray(witnesses.witnesses) ||
          witnesses.witnesses.length !== rootCount) {
        return failResult("The number of exact system witnesses does not match the complete real-root count.");
      }

      const state: DecodeState = { nodes: 0 };
      const points = witnesses.witnesses.map((point: unknown) => {
        if (!Array.isArray(point) || point.length !== expectedVariables.length) {
          throw new TypeError("A witness point must provide one value per variable.");
        }
        return point.map((entry: unknown) => deserializeExpression(entry, state));
      });
      if (points.some(point => point.some(coordinate => !isProvablyRealAlgebraic(coordinate)))) {
        return failResult("Completeness witnesses must use provably real exact algebraic coordinates.");
      }
      for (let left = 0; left < points.length; left++) {
        for (let right = left + 1; right < points.length; right++) {
          const duplicates = points[left]!.every((coordinate, index) => {
            const difference = simplifyRadicals(simplify(expand(add(
              coordinate,
              mul(integer(-1), points[right]![index]!),
            ))));
            return isNumeric(difference) && numericParts(difference)[0] === 0n;
          });
          if (duplicates) return failResult("The witness list contains duplicate solution points.");
        }
      }
      return { valid: true, errors: [] };
    } catch (error) {
      return failResult(error instanceof Error ? error.message : "Could not verify the completeness certificate.");
    }
  }

