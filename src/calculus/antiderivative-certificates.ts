import { add, integer, isZero, mul, structuralKey, type Expr } from "../core/expr.js";
import { parse } from "../core/parser.js";
import { toString } from "../core/printer.js";
import { differentiate } from "./differentiate.js";
import { integrate, IntegrationError } from "./integrate.js";
import { simplify } from "../algebra/simplify.js";

export interface AntiderivativeCertificate {
  readonly version: 1;
  readonly variable: string;
  readonly integrand: string;
  readonly antiderivative: string;
}

export type AntiderivativeCertificateCreationResult =
  | { readonly status: "complete"; readonly certificate: AntiderivativeCertificate }
  | { readonly status: "unsupported"; readonly message: string };

export interface AntiderivativeCertificateVerificationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Create an identity-check certificate for a supported antiderivative.
 * The certificate proves the derivative identity over the expressions'
 * common domain; it is not a formal proof of domain equivalence.
 */
export function createAntiderivativeCertificate(
  integrand: Expr,
  variable: string,
  candidate?: Expr,
): AntiderivativeCertificateCreationResult {
  let antiderivative: Expr;
  try {
    antiderivative = candidate ?? integrate(integrand, variable);
  } catch (error) {
    if (error instanceof IntegrationError) {
      return { status: "unsupported", message: error.message };
    }
    throw error;
  }

  const certificate: AntiderivativeCertificate = {
    version: 1,
    variable,
    integrand: toString(integrand),
    antiderivative: toString(antiderivative),
  };
  const verification = verifyAntiderivativeCertificate(certificate, integrand);
  if (!verification.valid) {
    return {
      status: "unsupported",
      message: `The candidate failed exact derivative verification: ${verification.errors.join("; ")}`,
    };
  }
  return { status: "complete", certificate };
}

/** Recompute the derivative identity instead of trusting the stored expression. */
export function verifyAntiderivativeCertificate(
  value: unknown,
  expectedIntegrand?: Expr,
): AntiderivativeCertificateVerificationResult {
  if (typeof value !== "object" || value === null ||
      !("version" in value) || value.version !== 1 ||
      !("variable" in value) || typeof value.variable !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.variable) ||
      !("integrand" in value) || typeof value.integrand !== "string" ||
      !("antiderivative" in value) || typeof value.antiderivative !== "string" ||
      value.integrand.length > 100_000 || value.antiderivative.length > 100_000) {
    return { valid: false, errors: ["Certificate must contain version-1 expressions and a valid variable."] };
  }

  try {
    const integrand = parse(value.integrand);
    const antiderivative = parse(value.antiderivative);
    if (expectedIntegrand && structuralKey(integrand) !== structuralKey(expectedIntegrand)) {
      return { valid: false, errors: ["Certificate integrand does not match the expected expression."] };
    }
    const residual = simplify(add(
      differentiate(antiderivative, value.variable),
      mul(integer(-1), integrand),
    ));
    if (!isZero(residual)) {
      return { valid: false, errors: ["Differentiating the antiderivative does not recover the integrand exactly."] };
    }
    return { valid: true, errors: [] };
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : "Could not verify the antiderivative certificate."],
    };
  }
}
