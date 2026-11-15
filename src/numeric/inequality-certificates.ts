import type { Expr } from "../core/expr.js";
import type { InequalityRelation } from "../algebra/inequalities.js";
import {
  createPolynomialRootCertificate,
  verifyPolynomialRootCertificate,
  type PolynomialRootCertificate,
} from "./root-certificates.js";
import {
  evaluateExactPolynomialSign,
  exactRational,
  type ExactRational,
  type ExactRationalText,
} from "./sturm.js";

export interface CertifiedInequalityCell {
  readonly lowerRootIndex: number | null;
  readonly upperRootIndex: number | null;
  readonly sample: ExactRationalText;
  readonly sign: -1 | 1;
  readonly accepted: boolean;
}

export interface CertifiedPolynomialInequality {
  readonly version: 1;
  readonly variable: string;
  readonly relation: InequalityRelation;
  readonly polynomial: PolynomialRootCertificate;
  readonly cells: readonly CertifiedInequalityCell[];
  readonly includedRootIndices: readonly number[];
}

export type CertifiedPolynomialInequalityResult =
  | { readonly status: "complete"; readonly certificate: CertifiedPolynomialInequality }
  | { readonly status: "partial" | "unsupported"; readonly message: string };

export interface InequalityCertificateVerificationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

function addRational(a: ExactRational, b: ExactRational): ExactRational {
  return exactRational(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}

function subtractRational(a: ExactRational, b: ExactRational): ExactRational {
  return exactRational(
    a.numerator * b.denominator - b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}

function midpoint(a: ExactRational, b: ExactRational): ExactRational {
  return exactRational(
    a.numerator * b.denominator + b.numerator * a.denominator,
    2n * a.denominator * b.denominator,
  );
}

function compareRational(a: ExactRational, b: ExactRational): number {
  const left = a.numerator * b.denominator;
  const right = b.numerator * a.denominator;
  return left < right ? -1 : left > right ? 1 : 0;
}

function rationalText(value: ExactRational): ExactRationalText {
  const normalized = exactRational(value.numerator, value.denominator);
  return {
    numerator: normalized.numerator.toString(),
    denominator: normalized.denominator.toString(),
  };
}

function rationalFromText(value: ExactRationalText): ExactRational {
  return exactRational(BigInt(value.numerator), BigInt(value.denominator));
}

function acceptsSign(sign: -1 | 0 | 1, relation: InequalityRelation): boolean {
  switch (relation) {
    case "<": return sign < 0;
    case "<=": return sign <= 0;
    case ">": return sign > 0;
    case ">=": return sign >= 0;
    case "=": return sign === 0;
    case "!=": return sign !== 0;
  }
}

function intervalSamples(polynomial: PolynomialRootCertificate): ExactRational[] {
  const roots = polynomial.roots;
  if (roots.length === 0) return [exactRational(0n)];

  const samples: ExactRational[] = [
    subtractRational(rationalFromText(roots[0]!.lower), exactRational(1n)),
  ];
  for (let index = 1; index < roots.length; index++) {
    samples.push(midpoint(
      rationalFromText(roots[index - 1]!.upper),
      rationalFromText(roots[index]!.lower),
    ));
  }
  samples.push(addRational(rationalFromText(roots[roots.length - 1]!.upper), exactRational(1n)));
  return samples;
}

function fail(message: string): InequalityCertificateVerificationResult {
  return { valid: false, errors: [message] };
}

/**
 * Certify a univariate polynomial inequality using exact root isolation and
 * rational sign witnesses in every root-free cell.
 */
export function createPolynomialInequalityCertificate(
  expression: Expr,
  variable: string,
  relation: InequalityRelation,
): CertifiedPolynomialInequalityResult {
  const roots = createPolynomialRootCertificate(expression, variable);
  if (!("certificate" in roots)) {
    return {
      status: roots.status === "all" ? "unsupported" : roots.status,
      message: roots.message,
    };
  }
  if (roots.status === "partial") {
    return {
      status: "partial",
      message: "Some real roots are not isolated, so the inequality sign chart is incomplete.",
    };
  }

  const polynomial = roots.certificate;
  const samples = intervalSamples(polynomial);
  const coefficients = polynomial.coefficients.map(rationalFromText);
  const cells: CertifiedInequalityCell[] = samples.map((sample, index) => {
    const sign = evaluateExactPolynomialSign(coefficients, sample);
    if (sign === 0) throw new Error("A sign-chart witness unexpectedly lies on a polynomial root.");
    return {
      lowerRootIndex: index === 0 ? null : index - 1,
      upperRootIndex: index === polynomial.roots.length ? null : index,
      sample: rationalText(sample),
      sign,
      accepted: acceptsSign(sign, relation),
    };
  });
  const includedRootIndices = polynomial.roots
    .map((_, index) => index)
    .filter(() => acceptsSign(0, relation));
  const certificate: CertifiedPolynomialInequality = {
    version: 1,
    variable,
    relation,
    polynomial,
    cells,
    includedRootIndices,
  };
  const verification = verifyPolynomialInequalityCertificate(certificate, expression);
  if (!verification.valid) {
    throw new Error(`Generated inequality certificate failed verification: ${verification.errors.join("; ")}`);
  }
  return { status: "complete", certificate };
}

/**
 * Verify all root intervals and exact sign witnesses. Supplying the expected
 * expression also binds the nested root certificate to that polynomial.
 */
export function verifyPolynomialInequalityCertificate(
  value: unknown,
  expectedExpression?: Expr,
): InequalityCertificateVerificationResult {
  if (typeof value !== "object" || value === null || !("version" in value) ||
      value.version !== 1 || !("relation" in value) ||
      !["<", "<=", ">", ">=", "=", "!="].includes(String(value.relation))) {
    return fail("Certificate must have version 1 and a supported inequality relation.");
  }
  if (!("polynomial" in value) || !("cells" in value) || !Array.isArray(value.cells) ||
      !("includedRootIndices" in value) || !Array.isArray(value.includedRootIndices)) {
    return fail("Certificate is missing its polynomial, sign cells, or included roots.");
  }

  const polynomialResult = verifyPolynomialRootCertificate(value.polynomial, expectedExpression);
  if (!polynomialResult.valid) return polynomialResult;
  const polynomial = value.polynomial as PolynomialRootCertificate;
  const relation = value.relation as InequalityRelation;
  if (!("variable" in value) || value.variable !== polynomial.variable) {
    return fail("Inequality and polynomial certificate variables do not match.");
  }

  const roots = polynomial.roots;
  if (value.cells.length !== roots.length + 1) {
    return fail("A complete sign chart must contain exactly one cell before, between, and after the roots.");
  }
  const coefficients = polynomial.coefficients.map(rationalFromText);
  const expectedIncludedRoots = roots
    .map((_, index) => index)
    .filter(() => acceptsSign(0, relation));
  if (value.includedRootIndices.length !== expectedIncludedRoots.length ||
      value.includedRootIndices.some((index, i) => index !== expectedIncludedRoots[i])) {
    return fail("Included root points do not match the inequality relation.");
  }

  for (let index = 0; index < value.cells.length; index++) {
    const cell = value.cells[index];
    if (typeof cell !== "object" || cell === null ||
        !("lowerRootIndex" in cell) || !("upperRootIndex" in cell) ||
        !("sample" in cell) || !("sign" in cell) || !("accepted" in cell)) {
      return fail("A sign-chart cell is malformed.");
    }
    const expectedLower = index === 0 ? null : index - 1;
    const expectedUpper = index === roots.length ? null : index;
    if (cell.lowerRootIndex !== expectedLower || cell.upperRootIndex !== expectedUpper) {
      return fail("Sign-chart cells must be ordered around the certified roots.");
    }
    if (typeof cell.sample !== "object" || cell.sample === null ||
        !("numerator" in cell.sample) || !("denominator" in cell.sample) ||
        typeof cell.sample.numerator !== "string" || typeof cell.sample.denominator !== "string") {
      return fail("A sign-chart sample must be an exact rational.");
    }
    if (cell.sign !== -1 && cell.sign !== 1 || typeof cell.accepted !== "boolean") {
      return fail("A sign-chart cell has an invalid sign or acceptance state.");
    }

    let sample: ExactRational;
    try {
      sample = rationalFromText({
        numerator: cell.sample.numerator,
        denominator: cell.sample.denominator,
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Could not read the sign-chart sample.");
    }
    if (index === 0) {
      if (compareRational(sample, rationalFromText(roots[0]!.lower)) >= 0) {
        return fail("The leftmost sign witness is not to the left of the first root interval.");
      }
    } else if (index === roots.length) {
      if (compareRational(sample, rationalFromText(roots[roots.length - 1]!.upper)) <= 0) {
        return fail("The rightmost sign witness is not to the right of the last root interval.");
      }
    } else if (
      compareRational(sample, rationalFromText(roots[index - 1]!.upper)) < 0 ||
      compareRational(sample, rationalFromText(roots[index]!.lower)) > 0
    ) {
      return fail("An interior sign witness is outside the root-free cell.");
    }

    const actualSign = evaluateExactPolynomialSign(coefficients, sample);
    if (actualSign !== cell.sign || cell.accepted !== acceptsSign(actualSign, relation)) {
      return fail("A sign-chart witness does not verify against the exact polynomial and relation.");
    }
  }

  return { valid: true, errors: [] };
}
