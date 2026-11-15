import type { Expr } from "../core/expr.js";
import { isNumeric, numericParts } from "../core/expr.js";
import {
  polynomialDegree,
  polynomialFromExpr,
  isUnivariatePolynomial,
} from "../algebra/polynomial.js";
import {
  createExactPolynomialRootCertificate,
  exactRational,
  verifyExactPolynomialRootCertificate,
  type ExactPolynomialRootCertificate,
  type ExactRational,
} from "./sturm.js";

export interface PolynomialRootCertificate extends ExactPolynomialRootCertificate {
  readonly variable: string;
}

export interface PolynomialRootCertificateOptions {
  readonly tolerance?: ExactRational;
  readonly maxDegree?: number;
  readonly maxIterations?: number;
}

export type PolynomialRootCertificateCreationResult =
  | { readonly status: "complete" | "partial"; readonly certificate: PolynomialRootCertificate }
  | { readonly status: "all" | "unsupported"; readonly message: string };

export interface PolynomialRootCertificateVerificationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

function serializedCoefficients(expression: Expr, variable: string): {
  readonly coefficients: readonly { readonly numerator: string; readonly denominator: string }[];
  readonly degree: number;
} {
  const polynomial = polynomialFromExpr(expression);
  if (!isUnivariatePolynomial(polynomial, variable)) {
    throw new TypeError(`The expression must be a univariate polynomial in '${variable}'.`);
  }
  const degree = polynomialDegree(polynomial, variable);
  const coefficients = Array.from(
    { length: Math.max(0, degree + 1) },
    () => exactRational(0n),
  );
  for (const term of polynomial.terms.values()) {
    if (!isNumeric(term.coefficient)) throw new TypeError("Polynomial coefficients must be exact rationals.");
    const exponent = term.monomial.powers.get(variable) ?? 0;
    const [numerator, denominator] = numericParts(term.coefficient);
    coefficients[exponent] = exactRational(numerator, denominator);
  }
  return {
    degree,
    coefficients: coefficients.map(coefficient => ({
      numerator: coefficient.numerator.toString(),
      denominator: coefficient.denominator.toString(),
    })),
  };
}

/**
 * Create a JSON-serializable exact root certificate for a univariate polynomial.
 * The certificate proves unique-root intervals, multiplicities, and the total
 * distinct real-root count using rational Sturm variations.
 */
export function createPolynomialRootCertificate(
  expression: Expr,
  variable: string,
  options: PolynomialRootCertificateOptions = {},
): PolynomialRootCertificateCreationResult {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) {
    throw new TypeError(`Invalid variable name: ${variable}`);
  }

  const tolerance = options.tolerance ?? exactRational(1n, 1_000_000_000_000n);
  const maxDegree = options.maxDegree ?? 24;
  const maxIterations = options.maxIterations ?? 512;
  if (tolerance.numerator <= 0n) throw new RangeError("tolerance must be positive.");
  if (!Number.isSafeInteger(maxDegree) || maxDegree < 1 || maxDegree > 64) {
    throw new RangeError("maxDegree must be an integer in [1, 64].");
  }
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > 20_000) {
    throw new RangeError("maxIterations must be an integer in [1, 20000].");
  }

  let polynomial: ReturnType<typeof polynomialFromExpr>;
  try {
    polynomial = polynomialFromExpr(expression);
  } catch (error) {
    return {
      status: "unsupported",
      message: error instanceof Error ? error.message : "The expression is not a supported polynomial.",
    };
  }
  if (!isUnivariatePolynomial(polynomial, variable)) {
    return {
      status: "unsupported",
      message: `The expression must be a univariate polynomial in '${variable}'.`,
    };
  }

  const data = serializedCoefficients(expression, variable);
  if (data.degree < 0) {
    return {
      status: "all",
      message: "The zero polynomial is zero for every real value and has no finite root certificate.",
    };
  }
  if (data.degree > maxDegree) {
    return {
      status: "unsupported",
      message: `Polynomial degree ${data.degree} exceeds the configured maximum ${maxDegree}.`,
    };
  }

  const coefficients = data.coefficients.map(value =>
    exactRational(BigInt(value.numerator), BigInt(value.denominator)),
  );
  const result = createExactPolynomialRootCertificate(coefficients, tolerance, maxDegree, maxIterations);
  if (!("certificate" in result)) return result;

  const certificate: PolynomialRootCertificate = {
    ...result.certificate,
    variable,
  };
  const verification = verifyPolynomialRootCertificate(certificate, expression);
  if (!verification.valid) {
    throw new Error(`Generated root certificate failed verification: ${verification.errors.join("; ")}`);
  }
  return { status: result.status, certificate };
}

/**
 * Verify a serialized root certificate. If an expression is supplied, also
 * check that the certificate's coefficients match that expression and variable.
 */
export function verifyPolynomialRootCertificate(
  value: unknown,
  expectedExpression?: Expr,
): PolynomialRootCertificateVerificationResult {
  const verification = verifyExactPolynomialRootCertificate(value);
  if (!verification.valid) return verification;
  if (typeof value !== "object" || value === null || !("variable" in value) ||
      typeof value.variable !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.variable)) {
    return { valid: false, errors: ["Certificate must include a valid variable name."] };
  }
  if (expectedExpression === undefined) return verification;

  try {
    const expected = serializedCoefficients(expectedExpression, value.variable);
    const certificate = value as PolynomialRootCertificate;
    if (expected.coefficients.length !== certificate.coefficients.length ||
        expected.coefficients.some((coefficient, index) => {
          const certified = certificate.coefficients[index]!;
          return coefficient.numerator !== certified.numerator ||
            coefficient.denominator !== certified.denominator;
        })) {
      return { valid: false, errors: ["Certificate coefficients do not match the expected expression."] };
    }
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : "Could not match the certificate to the expected expression."],
    };
  }

  return verification;
}
