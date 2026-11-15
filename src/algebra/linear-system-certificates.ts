import { add, integer, isNumeric, mul, numericParts, rational, type Expr } from "../core/expr.js";
import { polynomialFromExpr } from "./polynomial.js";
import { solveLinearSystem, type LinearEquation } from "./system.js";

export interface CertificateRational {
  readonly numerator: string;
  readonly denominator: string;
}

export interface LinearSystemCertificate {
  readonly version: 1;
  readonly variables: readonly string[];
  readonly coefficientMatrix: readonly (readonly CertificateRational[])[];
  readonly rightHandSide: readonly CertificateRational[];
  readonly solution: readonly CertificateRational[];
}

export type LinearSystemCertificateCreationResult =
  | { readonly status: "complete"; readonly certificate: LinearSystemCertificate }
  | { readonly status: "infinite" | "none" | "unsupported"; readonly message: string };

export interface LinearSystemCertificateVerificationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

interface Fraction {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

interface LinearSystemData {
  readonly coefficientMatrix: readonly (readonly Fraction[])[];
  readonly rightHandSide: readonly Fraction[];
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function fraction(numerator: bigint, denominator: bigint): Fraction {
  if (denominator === 0n) throw new RangeError("Rational denominator cannot be zero.");
  const divisor = gcd(numerator, denominator);
  const sign = denominator < 0n ? -1n : 1n;
  return {
    numerator: sign * numerator / divisor,
    denominator: sign * denominator / divisor,
  };
}

function addFractions(a: Fraction, b: Fraction): Fraction {
  return fraction(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}

function subtractFractions(a: Fraction, b: Fraction): Fraction {
  return fraction(
    a.numerator * b.denominator - b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}

function multiplyFractions(a: Fraction, b: Fraction): Fraction {
  return fraction(a.numerator * b.numerator, a.denominator * b.denominator);
}

function divideFractions(a: Fraction, b: Fraction): Fraction {
  if (b.numerator === 0n) throw new RangeError("Cannot divide by zero.");
  return fraction(a.numerator * b.denominator, a.denominator * b.numerator);
}

function equalFractions(a: Fraction, b: Fraction): boolean {
  return a.numerator === b.numerator && a.denominator === b.denominator;
}

function toText(value: Fraction): CertificateRational {
  return {
    numerator: value.numerator.toString(),
    denominator: value.denominator.toString(),
  };
}

function readRational(value: unknown): Fraction {
  if (typeof value !== "object" || value === null ||
      !("numerator" in value) || !("denominator" in value) ||
      typeof value.numerator !== "string" || typeof value.denominator !== "string" ||
      value.numerator.length > 4_096 || value.denominator.length > 4_096 ||
      !/^-?(0|[1-9][0-9]*)$/.test(value.numerator) ||
      !/^[1-9][0-9]*$/.test(value.denominator)) {
    throw new TypeError("Certificate values must be normalized exact rational strings.");
  }
  const result = fraction(BigInt(value.numerator), BigInt(value.denominator));
  if (result.numerator.toString() !== value.numerator ||
      result.denominator.toString() !== value.denominator) {
    throw new TypeError("Certificate rational values must be reduced.");
  }
  return result;
}

function exactValue(expression: Expr): Fraction {
  if (!isNumeric(expression)) throw new TypeError("Linear systems require exact rational coefficients.");
  const [numerator, denominator] = numericParts(expression);
  return fraction(numerator, denominator);
}

function extractSystemData(
  equations: readonly LinearEquation[],
  variables: readonly string[],
): LinearSystemData {
  if (variables.length === 0 || new Set(variables).size !== variables.length ||
      variables.some(variable => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable))) {
    throw new TypeError("Provide a non-empty list of distinct valid variable names.");
  }
  if (equations.length === 0) throw new TypeError("At least one equation is required.");
  if (variables.length > 128 || equations.length > 512) {
    throw new RangeError("Linear-system certificates are limited to 128 variables and 512 equations.");
  }

  const coefficientMatrix: Fraction[][] = [];
  const rightHandSide: Fraction[] = [];
  for (const equation of equations) {
    const difference = add(equation.left, mul(integer(-1), equation.right));
    const polynomial = polynomialFromExpr(difference);
    const row = variables.map(() => fraction(0n, 1n));
    let constant = fraction(0n, 1n);
    for (const term of polynomial.terms.values()) {
      if (!isNumeric(term.coefficient)) {
        throw new TypeError("Linear systems require exact rational coefficients.");
      }
      const powers = [...term.monomial.powers];
      if (powers.length === 0) {
        constant = addFractions(constant, exactValue(term.coefficient));
        continue;
      }
      if (powers.length !== 1 || powers[0]![1] !== 1) {
        throw new TypeError("The equations must be affine in the declared variables.");
      }
      const column = variables.indexOf(powers[0]![0]);
      if (column < 0) throw new TypeError("An equation uses an undeclared variable.");
      row[column] = exactValue(term.coefficient);
    }
    coefficientMatrix.push(row);
    rightHandSide.push(fraction(-constant.numerator, constant.denominator));
  }
  return { coefficientMatrix, rightHandSide };
}

function matrixRank(matrix: readonly (readonly Fraction[])[], columns: number): number {
  const rows = matrix.map(row => [...row]);
  let pivotRow = 0;
  for (let column = 0; column < columns && pivotRow < rows.length; column++) {
    let pivot = pivotRow;
    while (pivot < rows.length && rows[pivot]![column]!.numerator === 0n) pivot++;
    if (pivot === rows.length) continue;
    [rows[pivotRow], rows[pivot]] = [rows[pivot]!, rows[pivotRow]!];
    const pivotValue = rows[pivotRow]![column]!;
    rows[pivotRow] = rows[pivotRow]!.map(value => divideFractions(value, pivotValue));
    for (let row = 0; row < rows.length; row++) {
      if (row === pivotRow) continue;
      const factorValue = rows[row]![column]!;
      if (factorValue.numerator === 0n) continue;
      rows[row] = rows[row]!.map((value, index) =>
        subtractFractions(value, multiplyFractions(factorValue, rows[pivotRow]![index]!)));
    }
    pivotRow++;
  }
  return pivotRow;
}

function fail(message: string): LinearSystemCertificateVerificationResult {
  return { valid: false, errors: [message] };
}

/**
 * Certify a unique solution of an exact rational linear system. The verifier
 * checks every equation and independently confirms full column rank.
 */
export function createLinearSystemCertificate(
  equations: readonly LinearEquation[],
  variables: readonly string[],
): LinearSystemCertificateCreationResult {
  let data: LinearSystemData;
  try {
    data = extractSystemData(equations, variables);
  } catch (error) {
    return {
      status: "unsupported",
      message: error instanceof Error ? error.message : "The system is not supported.",
    };
  }

  const solved = solveLinearSystem(equations, variables);
  if (solved.status !== "unique" || !solved.solutions) {
    return {
      status: solved.status === "infinite" || solved.status === "none"
        ? solved.status
        : "unsupported",
      message: solved.message ?? `A unique solution is required; solver status is ${solved.status}.`,
    };
  }

  const solution = variables.map(variable => {
    const value = solved.solutions![variable];
    if (!value) throw new Error(`The solver omitted '${variable}'.`);
    return toText(exactValue(value));
  });
  const certificate: LinearSystemCertificate = {
    version: 1,
    variables: [...variables],
    coefficientMatrix: data.coefficientMatrix.map(row => row.map(toText)),
    rightHandSide: data.rightHandSide.map(toText),
    solution,
  };
  const verification = verifyLinearSystemCertificate(certificate, equations, variables);
  if (!verification.valid) {
    throw new Error(`Generated linear-system certificate failed verification: ${verification.errors.join("; ")}`);
  }
  return { status: "complete", certificate };
}

/** Verify the exact residuals and uniqueness claim in a serialized certificate. */
export function verifyLinearSystemCertificate(
  value: unknown,
  expectedEquations?: readonly LinearEquation[],
  expectedVariables?: readonly string[],
): LinearSystemCertificateVerificationResult {
  if (typeof value !== "object" || value === null ||
      !("version" in value) || value.version !== 1 ||
      !("variables" in value) || !Array.isArray(value.variables) ||
      !("coefficientMatrix" in value) || !Array.isArray(value.coefficientMatrix) ||
      !("rightHandSide" in value) || !Array.isArray(value.rightHandSide) ||
      !("solution" in value) || !Array.isArray(value.solution)) {
    return fail("Certificate is missing required version-1 linear-system fields.");
  }

  try {
    const variables = value.variables;
    if (variables.length === 0 || variables.some(variable =>
      typeof variable !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) ||
      new Set(variables).size !== variables.length) {
      return fail("Certificate variables must be valid, distinct identifiers.");
    }
    const columns = variables.length;
    if (columns > 128 || value.rightHandSide.length > 512) {
      return fail("Certificate exceeds the supported matrix dimensions.");
    }
    if (value.rightHandSide.length === 0 ||
        value.coefficientMatrix.length !== value.rightHandSide.length ||
        value.solution.length !== columns ||
        value.coefficientMatrix.some(row => !Array.isArray(row) || row.length !== columns)) {
      return fail("Coefficient matrix, right-hand side, and solution dimensions do not match.");
    }

    const matrix: Fraction[][] = value.coefficientMatrix.map((row: unknown[]) => row.map(readRational));
    const rhs: Fraction[] = value.rightHandSide.map((entry: unknown) => readRational(entry));
    const solution: Fraction[] = value.solution.map((entry: unknown) => readRational(entry));
    if (matrixRank(matrix, columns) !== columns) {
      return fail("The coefficient matrix does not have full column rank.");
    }
    for (let row = 0; row < matrix.length; row++) {
      const actual = matrix[row]!.reduce<Fraction>(
        (sum, coefficient, column) => addFractions(
          sum,
          multiplyFractions(coefficient, solution[column]!),
        ),
        fraction(0n, 1n),
      );
      if (!equalFractions(actual, rhs[row]!)) {
        return fail(`The proposed solution does not satisfy equation ${row + 1}.`);
      }
    }

    if (expectedVariables &&
        (expectedVariables.length !== columns ||
          expectedVariables.some((name, index) => name !== variables[index]))) {
      return fail("Certificate variables do not match the expected variable order.");
    }
    if (expectedEquations) {
      const expected = extractSystemData(expectedEquations, expectedVariables ?? variables);
      if (expected.coefficientMatrix.length !== matrix.length ||
          expected.coefficientMatrix.some((row, i) =>
            row.some((entry, j) => !equalFractions(entry, matrix[i]![j]!))) ||
          expected.rightHandSide.some((entry, i) => !equalFractions(entry, rhs[i]!))) {
        return fail("Certificate equations do not match the expected system.");
      }
    }
    return { valid: true, errors: [] };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not verify the linear-system certificate.");
  }
}
