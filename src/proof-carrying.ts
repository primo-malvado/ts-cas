import {
  add, integer, isNumeric, mul, numericParts, structuralKey, type Expr,
} from "./core/expr.js";
import { parse } from "./core/parser.js";
import { toString } from "./core/printer.js";
import { simplify } from "./algebra/simplify.js";
import { simplifyRadicals } from "./algebra/radicals.js";
import {
  differentiateWithSteps,
  verifyDifferentiationExplanation,
  type DifferentiationResult,
} from "./calculus/differentiate.js";
import {
  createAntiderivativeCertificate,
  verifyAntiderivativeCertificate,
  type AntiderivativeCertificate,
} from "./calculus/antiderivative-certificates.js";
import {
  integrateWithSteps,
  verifyIntegrationExplanation,
  IntegrationError,
} from "./calculus/integrate.js";
import {
  factorWithSteps,
  verifyFactorizationExplanation,
} from "./algebra/factor.js";
import {
  polynomialFromExpr,
  polynomialToExpr,
} from "./algebra/polynomial.js";
import {
  solveWithSteps,
  verifyEquationSolveExplanation,
  type EquationSolveStatus,
} from "./algebra/solve.js";
import {
  simplifyWithDomain,
  type DomainCondition,
  type DomainSimplificationResult,
  type DomainSimplificationStatus,
} from "./algebra/simplify-with-domain.js";
import {
  solveWithDomain,
  type DomainEquationSolveResult,
} from "./algebra/domain-aware-operations.js";
import {
  createPolynomialRootCertificate,
  verifyPolynomialRootCertificate,
  type PolynomialRootCertificate,
} from "./numeric/root-certificates.js";

export interface SerializedDomainCondition {
  readonly expression: string;
  readonly relation: DomainCondition["relation"];
}

export interface SerializableProofStep {
  readonly rule: string;
  readonly id?: number;
  readonly parentId?: number | null;
  readonly input?: string;
  readonly output?: string;
  readonly expression?: string;
  readonly degree?: number;
  readonly coefficients?: readonly string[];
  readonly factors?: readonly { readonly expression: string; readonly multiplicity: number }[];
  readonly solutions?: readonly string[];
  readonly status?: string;
  readonly message?: string;
}

interface ProofCarryingBase {
  readonly version: 1;
  readonly status: "complete" | "partial";
  readonly input: string;
  readonly domain: {
    readonly status: "complete" | "partial";
    readonly conditions: readonly SerializedDomainCondition[];
  };
  readonly explanation: readonly SerializableProofStep[];
}

export type ProofCarryingCalculation =
  | (ProofCarryingBase & {
      readonly operation: "differentiate";
      readonly variable: string;
      readonly result: string;
      readonly proof: { readonly kind: "derivative-identity" };
    })
  | (ProofCarryingBase & {
      readonly operation: "factor";
      readonly variable?: string;
      readonly result: string;
      readonly proof: { readonly kind: "polynomial-factorization-identity" };
    })
  | (ProofCarryingBase & {
      readonly operation: "integrate";
      readonly variable: string;
      readonly result: string;
      readonly proof: {
        readonly kind: "antiderivative-identity";
        readonly certificate: AntiderivativeCertificate;
      };
    })
  | (ProofCarryingBase & {
      readonly operation: "solve";
      readonly variable: string;
      readonly result: {
        readonly solverStatus: EquationSolveStatus;
        readonly candidates: readonly string[];
        readonly solutions: readonly string[];
        readonly excludedSolutions: readonly string[];
        readonly undeterminedSolutions: readonly string[];
      };
      readonly proof: {
        readonly kind: "complete-real-root-set";
        readonly certificate: PolynomialRootCertificate;
      };
    });

export type ProofCarryingCreationResult =
  | { readonly status: "complete" | "partial"; readonly calculation: ProofCarryingCalculation }
  | {
      readonly status: "unsupported";
      readonly conditions: readonly SerializedDomainCondition[];
      readonly message: string;
    };

export interface ProofCarryingVerificationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRelation(value: unknown): value is DomainCondition["relation"] {
  return value === "nonzero" || value === "positive" || value === "nonnegative";
}

function serializeConditions(
  conditions: readonly DomainCondition[],
): readonly SerializedDomainCondition[] {
  return conditions.map(condition => ({
    expression: toString(condition.expression),
    relation: condition.relation,
  }));
}

function prepareInput(input: Expr | DomainSimplificationResult): DomainSimplificationResult {
  return "conditions" in input ? input : simplifyWithDomain(input);
}

function unsupported(
  domain: DomainSimplificationResult,
  message: string,
): ProofCarryingCreationResult {
  return {
    status: "unsupported",
    conditions: serializeConditions(domain.conditions),
    message,
  };
}

function baseFor(domain: DomainSimplificationResult, explanation: readonly SerializableProofStep[]) {
  return {
    version: 1 as const,
    status: domain.status === "partial" ? "partial" as const : "complete" as const,
    input: toString(domain.expression!),
    domain: {
      status: domain.status === "partial" ? "partial" as const : "complete" as const,
      conditions: serializeConditions(domain.conditions),
    },
    explanation,
  };
}

function serializeDifferentiationSteps(
  steps: ReturnType<typeof differentiateWithSteps>["steps"],
): readonly SerializableProofStep[] {
  return steps.map(step => ({
    id: step.id,
    parentId: step.parentId,
    rule: step.rule,
    expression: toString(step.expression),
    output: toString(step.derivative),
  }));
}

function serializeFactorizationSteps(
  steps: ReturnType<typeof factorWithSteps>["steps"],
): readonly SerializableProofStep[] {
  return steps.map(step => ({
    rule: step.rule,
    input: toString(step.input),
    output: toString(step.output),
    ...(step.content === undefined ? {} : { expression: toString(step.content) }),
    ...(step.factors === undefined
      ? {}
      : {
          factors: step.factors.map(factor => ({
            expression: toString(factor.expression),
            multiplicity: factor.multiplicity,
          })),
        }),
  }));
}

function serializeIntegrationSteps(
  steps: ReturnType<typeof integrateWithSteps>["steps"],
): readonly SerializableProofStep[] {
  return steps.map(step => ({
    id: step.id,
    parentId: step.parentId,
    rule: step.rule,
    input: toString(step.input),
    output: toString(step.result),
  }));
}

function serializeSolveSteps(
  steps: ReturnType<typeof solveWithSteps>["steps"],
): readonly SerializableProofStep[] {
  return steps.map(step => ({
    rule: step.rule,
    ...(step.expression === undefined ? {} : { expression: toString(step.expression) }),
    ...(step.degree === undefined ? {} : { degree: step.degree }),
    ...(step.coefficients === undefined
      ? {}
      : { coefficients: step.coefficients.map(toString) }),
    ...(step.factors === undefined
      ? {}
      : {
          factors: step.factors.map(factor => ({
            expression: toString(factor.expression),
            multiplicity: factor.multiplicity,
          })),
        }),
    ...(step.solutions === undefined ? {} : { solutions: step.solutions.map(toString) }),
    ...(step.status === undefined ? {} : { status: step.status }),
    ...(step.message === undefined ? {} : { message: step.message }),
  }));
}

export function differentiateWithProof(
  input: Expr | DomainSimplificationResult,
  variable: string,
): ProofCarryingCreationResult {
  const domain = prepareInput(input);
  if (!domain.expression || domain.status === "undefined" || domain.status === "unsupported") {
    return unsupported(domain, domain.message ?? "The expression's real domain is not supported.");
  }
  const result = differentiateWithSteps(domain.expression, variable);
  const calculation: ProofCarryingCalculation = {
    ...baseFor(domain, serializeDifferentiationSteps(result.steps)),
    operation: "differentiate",
    variable,
    result: toString(result.derivative),
    proof: { kind: "derivative-identity" },
  };
  return { status: calculation.status, calculation };
}

export function factorWithProof(
  input: Expr | DomainSimplificationResult,
  variable?: string,
): ProofCarryingCreationResult {
  const domain = prepareInput(input);
  if (!domain.expression || domain.status === "undefined" || domain.status === "unsupported") {
    return unsupported(domain, domain.message ?? "The expression's real domain is not supported.");
  }
  try {
    polynomialFromExpr(domain.expression);
  } catch (error) {
    if (error instanceof TypeError) return unsupported(domain, error.message);
    throw error;
  }
  const result = factorWithSteps(domain.expression, variable);
  const calculation: ProofCarryingCalculation = {
    ...baseFor(domain, serializeFactorizationSteps(result.steps)),
    operation: "factor",
    ...(variable === undefined ? {} : { variable }),
    result: toString(result.expression),
    proof: { kind: "polynomial-factorization-identity" },
  };
  return { status: calculation.status, calculation };
}

export function integrateWithProof(
  input: Expr | DomainSimplificationResult,
  variable: string,
): ProofCarryingCreationResult {
  const domain = prepareInput(input);
  if (!domain.expression || domain.status === "undefined" || domain.status === "unsupported") {
    return unsupported(domain, domain.message ?? "The expression's real domain is not supported.");
  }
  let explanation: ReturnType<typeof integrateWithSteps>;
  try {
    explanation = integrateWithSteps(domain.expression, variable);
  } catch (error) {
    if (error instanceof IntegrationError) return unsupported(domain, error.message);
    throw error;
  }
  const proof = createAntiderivativeCertificate(
    domain.expression,
    variable,
    explanation.antiderivative,
  );
  if (proof.status !== "complete") return unsupported(domain, proof.message);
  const calculation: ProofCarryingCalculation = {
    ...baseFor(domain, serializeIntegrationSteps(explanation.steps)),
    operation: "integrate",
    variable,
    result: toString(explanation.antiderivative),
    proof: { kind: "antiderivative-identity", certificate: proof.certificate },
  };
  return { status: calculation.status, calculation };
}

export function solveWithProof(
  input: Expr | DomainSimplificationResult,
  variable: string,
): ProofCarryingCreationResult {
  const domain = prepareInput(input);
  if (!domain.expression || domain.status === "undefined" || domain.status === "unsupported") {
    return unsupported(domain, domain.message ?? "The expression's real domain is not supported.");
  }
  const solved = solveWithDomain(domain, variable);
  if (solved.status === "unsupported" || !solved.equation || solved.equation.status !== "finite") {
    return unsupported(domain, solved.message ?? "A complete finite equation solution is not available.");
  }
  const rootResult = createPolynomialRootCertificate(domain.expression, variable);
  if (rootResult.status !== "complete") {
    return unsupported(domain, "A complete real-root certificate is not available for this equation.");
  }
  if (solved.equation.solutions.length !== rootResult.certificate.totalDistinctRealRoots) {
    return unsupported(domain, "The symbolic solutions do not match the certified real-root count.");
  }
  const explanation = solveWithSteps(domain.expression, variable);
  const calculation: ProofCarryingCalculation = {
    ...baseFor(domain, serializeSolveSteps(explanation.steps)),
    operation: "solve",
    variable,
    result: {
      solverStatus: solved.equation.status,
      candidates: solved.equation.solutions.map(toString),
      solutions: solved.solutions.map(toString),
      excludedSolutions: solved.excludedSolutions.map(toString),
      undeterminedSolutions: solved.undeterminedSolutions.map(toString),
    },
    proof: {
      kind: "complete-real-root-set",
      certificate: rootResult.certificate,
    },
  };
  const status: "partial" | "complete" = domain.status === "partial" || solved.status === "partial"
    ? "partial"
    : "complete";
  const calculationWithStatus = { ...calculation, status };
  return { status, calculation: calculationWithStatus };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort()
      .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function fail(message: string): ProofCarryingVerificationResult {
  return { valid: false, errors: [message] };
}

function parseConditions(
  conditions: readonly SerializedDomainCondition[],
): readonly DomainCondition[] {
  return conditions.map(condition => ({
    expression: parse(condition.expression),
    relation: condition.relation,
  }));
}

function serializeRootValues(values: readonly Expr[]): readonly string[] {
  return values.map(toString);
}

function expressionsAreDistinct(values: readonly Expr[]): boolean {
  for (let left = 0; left < values.length; left++) {
    for (let right = left + 1; right < values.length; right++) {
      const difference = add(values[left]!, mul(integer(-1), values[right]!));
      const normalized = simplifyRadicals(simplify(difference));
      if (normalized && isNumeric(normalized) && numericParts(normalized)[0] === 0n) return false;
      if (structuralKey(values[left]!) === structuralKey(values[right]!)) return false;
    }
  }
  return true;
}

function matchesExpectedInput(
  inputExpression: Expr,
  domain: ProofCarryingBase["domain"],
  expectedInput: Expr | DomainSimplificationResult,
): boolean {
  const expected = prepareInput(expectedInput);
  if (!expected.expression || expected.status === "undefined" || expected.status === "unsupported" ||
      structuralKey(inputExpression) !== structuralKey(expected.expression) ||
      expected.status !== domain.status) {
    return false;
  }
  const actualConditions = parseConditions(domain.conditions);
  if (actualConditions.length !== expected.conditions.length) return false;
  return actualConditions.every(condition => expected.conditions.some(expectedCondition =>
    condition.relation === expectedCondition.relation &&
    structuralKey(condition.expression) === structuralKey(expectedCondition.expression)));
}

function isSerializedProofStep(value: unknown): value is SerializableProofStep {
  if (!isRecord(value) || typeof value.rule !== "string") return false;
  return (value.id === undefined || Number.isSafeInteger(value.id)) &&
    (value.parentId === undefined || value.parentId === null || Number.isSafeInteger(value.parentId)) &&
    ["input", "output", "expression", "status", "message"].every(key =>
      value[key] === undefined || typeof value[key] === "string") &&
    (value.degree === undefined || Number.isSafeInteger(value.degree)) &&
    (value.coefficients === undefined ||
      Array.isArray(value.coefficients) && value.coefficients.every(item => typeof item === "string")) &&
    (value.solutions === undefined ||
      Array.isArray(value.solutions) && value.solutions.every(item => typeof item === "string")) &&
    (value.factors === undefined ||
      Array.isArray(value.factors) && value.factors.every(item =>
        isRecord(item) && typeof item.expression === "string" &&
        Number.isSafeInteger(item.multiplicity)));
}

function isCalculation(value: unknown): value is ProofCarryingCalculation {
  if (!isRecord(value) || value.version !== 1 ||
      (value.status !== "complete" && value.status !== "partial") ||
      typeof value.input !== "string" || !isRecord(value.domain) ||
      (value.domain.status !== "complete" && value.domain.status !== "partial") ||
      !Array.isArray(value.domain.conditions) ||
      !value.domain.conditions.every(condition =>
        isRecord(condition) && typeof condition.expression === "string" && isRelation(condition.relation)) ||
      !Array.isArray(value.explanation) || !value.explanation.every(isSerializedProofStep)) {
    return false;
  }
  if (value.operation === "differentiate") {
    return typeof value.variable === "string" && typeof value.result === "string" &&
      isRecord(value.proof) && value.proof.kind === "derivative-identity";
  }
  if (value.operation === "factor") {
    return (value.variable === undefined || typeof value.variable === "string") &&
      typeof value.result === "string" &&
      isRecord(value.proof) && value.proof.kind === "polynomial-factorization-identity";
  }
  if (value.operation === "integrate") {
    return typeof value.variable === "string" && typeof value.result === "string" &&
      isRecord(value.proof) && value.proof.kind === "antiderivative-identity" &&
      isRecord(value.proof.certificate) && value.proof.certificate.version === 1;
  }
  if (value.operation === "solve") {
    const result = value.result;
    return typeof value.variable === "string" && isRecord(result) &&
      typeof result.solverStatus === "string" &&
      ["candidates", "solutions", "excludedSolutions", "undeterminedSolutions"]
        .every(key => Array.isArray(result[key]) &&
          (result[key] as unknown[]).every(item => typeof item === "string")) &&
      isRecord(value.proof) && value.proof.kind === "complete-real-root-set" &&
      isRecord(value.proof.certificate) && value.proof.certificate.version === 1;
  }
  return false;
}

/** Verify the embedded proof. Pass expectedInput to bind the serialized domain assumptions. */
export function verifyProofCarryingResult(
  value: unknown,
  expectedInput?: Expr | DomainSimplificationResult,
): ProofCarryingVerificationResult {
  if (!isCalculation(value)) return fail("Proof-carrying result has an invalid or unsupported shape.");
  try {
    const input = parse(value.input);
    const conditions = parseConditions(value.domain.conditions);
    if (expectedInput && !matchesExpectedInput(input, value.domain, expectedInput)) {
      return fail("Proof-carrying result does not match the expected expression and domain.");
    }
    if (value.operation !== "solve" && value.status !== value.domain.status) {
      return fail("Calculation status does not match the serialized domain status.");
    }

    switch (value.operation) {
      case "differentiate": {
        const replay = differentiateWithSteps(input, value.variable);
        const explanation = serializeDifferentiationSteps(replay.steps);
        if (stableJson(explanation) !== stableJson(value.explanation) ||
            toString(replay.derivative) !== value.result ||
            !verifyDifferentiationExplanation(input, value.variable, replay).valid) {
          return fail("Differentiation result or trace does not verify.");
        }
        return { valid: true, errors: [] };
      }
      case "factor": {
        const replay = factorWithSteps(input, value.variable);
        if (stableJson(serializeFactorizationSteps(replay.steps)) !== stableJson(value.explanation) ||
            toString(replay.expression) !== value.result ||
            !verifyFactorizationExplanation(input, replay).valid) {
          return fail("Factorization result or trace does not verify.");
        }
        const source = polynomialToExpr(polynomialFromExpr(input));
        const output = polynomialToExpr(polynomialFromExpr(parse(value.result)));
        if (structuralKey(source) !== structuralKey(output)) {
          return fail("The claimed factorization does not expand to the input polynomial.");
        }
        return { valid: true, errors: [] };
      }
      case "integrate": {
        const replay = integrateWithSteps(input, value.variable);
        if (stableJson(serializeIntegrationSteps(replay.steps)) !== stableJson(value.explanation) ||
            toString(replay.antiderivative) !== value.result ||
            !verifyIntegrationExplanation(input, replay, value.variable).valid) {
          return fail("Integration result or trace does not verify.");
        }
        const certificate = value.proof.certificate;
        if (!verifyAntiderivativeCertificate(certificate, input).valid ||
            certificate.antiderivative !== value.result) {
          return fail("Antiderivative certificate does not verify.");
        }
        return { valid: true, errors: [] };
      }
      case "solve": {
        const replay = solveWithSteps(input, value.variable);
        if (stableJson(serializeSolveSteps(replay.steps)) !== stableJson(value.explanation) ||
            !verifyEquationSolveExplanation(input, value.variable, replay).valid) {
          return fail("Equation-solve trace does not verify.");
        }
        const rootCertificate = value.proof.certificate;
        const rootVerification = verifyPolynomialRootCertificate(rootCertificate, input);
        if (!rootVerification.valid || rootCertificate.status !== "complete") {
          return fail(`Real-root certificate is invalid: ${rootVerification.errors.join("; ")}`);
        }
        const domain: DomainSimplificationResult = {
          status: value.domain.status,
          expression: input,
          conditions,
        };
        const solved: DomainEquationSolveResult = solveWithDomain(domain, value.variable);
        if (solved.status === "unsupported" || !solved.equation || solved.equation.status !== "finite" ||
            value.status !== (value.domain.status === "partial" || solved.status === "partial"
              ? "partial"
              : "complete") ||
            value.result.solverStatus !== solved.equation.status ||
            solved.equation.solutions.length !== rootCertificate.totalDistinctRealRoots ||
            !expressionsAreDistinct(solved.equation.solutions) ||
            stableJson(value.result.candidates) !== stableJson(serializeRootValues(solved.equation.solutions)) ||
            stableJson(value.result.solutions) !== stableJson(serializeRootValues(solved.solutions)) ||
            stableJson(value.result.excludedSolutions) !== stableJson(serializeRootValues(solved.excludedSolutions)) ||
            stableJson(value.result.undeterminedSolutions) !== stableJson(serializeRootValues(solved.undeterminedSolutions))) {
          return fail("Solved candidates, domain filtering, or certified root count do not match.");
        }
        return { valid: true, errors: [] };
      }
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not verify the proof-carrying result.");
  }
}
