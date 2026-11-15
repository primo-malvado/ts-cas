import type { Expr } from "./core/expr.js";
import {
  verifyAntiderivativeCertificate,
} from "./calculus/antiderivative-certificates.js";
import {
  verifyLinearSystemCertificate,
} from "./algebra/linear-system-certificates.js";
import {
  verifyPolynomialSystemCompletenessCertificate,
  verifyPolynomialSystemWitnessCertificate,
} from "./algebra/polynomial-system-certificates.js";
import type { LinearEquation, PolynomialEquation } from "./algebra/system.js";
import { verifyPolynomialInequalityCertificate } from "./numeric/inequality-certificates.js";
import { verifyPolynomialRootCertificate } from "./numeric/root-certificates.js";
import { verifyExactPolynomialRootCertificate } from "./numeric/sturm.js";

export type CertificateKind =
  | "exact-polynomial-root"
  | "polynomial-root"
  | "polynomial-inequality"
  | "linear-system"
  | "polynomial-system-complete"
  | "polynomial-system-witness"
  | "antiderivative";

export interface CertificateVerificationContext {
  readonly expectedExpression?: Expr;
  readonly expectedIntegrand?: Expr;
  readonly expectedLinearEquations?: readonly LinearEquation[];
  readonly expectedPolynomialEquations?: readonly PolynomialEquation[];
  readonly expectedVariables?: readonly string[];
}

export interface CertificateVerificationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/** Dispatch verification to the exact checker for the supplied certificate kind. */
export function verifyCertificate(
  kind: CertificateKind,
  certificate: unknown,
  context: CertificateVerificationContext = {},
): CertificateVerificationResult {
  switch (kind) {
    case "exact-polynomial-root":
      return verifyExactPolynomialRootCertificate(certificate);
    case "polynomial-root":
      return verifyPolynomialRootCertificate(certificate, context.expectedExpression);
    case "polynomial-inequality":
      return verifyPolynomialInequalityCertificate(certificate, context.expectedExpression);
    case "linear-system":
      return verifyLinearSystemCertificate(
        certificate,
        context.expectedLinearEquations,
        context.expectedVariables,
      );
    case "polynomial-system-witness":
      return verifyPolynomialSystemWitnessCertificate(
        certificate,
        context.expectedPolynomialEquations,
        context.expectedVariables,
      );
    case "polynomial-system-complete":
      if (!context.expectedPolynomialEquations || !context.expectedVariables) {
        return {
          valid: false,
          errors: ["Completeness verification requires the expected equations and variables."],
        };
      }
      return verifyPolynomialSystemCompletenessCertificate(
        certificate,
        context.expectedPolynomialEquations,
        context.expectedVariables,
      );
    case "antiderivative":
      return verifyAntiderivativeCertificate(certificate, context.expectedIntegrand);
    default:
      return {
        valid: false,
        errors: [`Unsupported certificate kind: ${String(kind)}`],
      };
  }
}
