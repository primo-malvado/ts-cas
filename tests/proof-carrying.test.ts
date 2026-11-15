import { describe, expect, it } from "vitest";
import {
  differentiateWithProof,
  factorWithProof,
  integrateWithProof,
  parse,
  parseWithDomain,
  solveWithProof,
  verifyProofCarryingResult,
  type ProofCarryingCalculation,
  type ProofCarryingCreationResult,
} from "../src/index.js";

function calculation(result: ProofCarryingCreationResult): ProofCarryingCalculation {
  if (!("calculation" in result)) throw new Error(result.message);
  return result.calculation;
}

function jsonRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value) as string) as unknown;
}

describe("proof-carrying calculations", () => {
  it("serializes and verifies differentiation while binding inherited domain assumptions", () => {
    const source = parseWithDomain("(x^2 - 1)/(x - 1)");
    const proof = jsonRoundTrip(calculation(differentiateWithProof(source, "x")));
    const unbound = jsonRoundTrip(proof) as Record<string, unknown>;
    const domain = unbound.domain as { conditions: unknown[] };
    domain.conditions = [];

    expect(verifyProofCarryingResult(proof, source).valid).toBe(true);
    expect(verifyProofCarryingResult(unbound).valid).toBe(true);
    expect(verifyProofCarryingResult(unbound, source).valid).toBe(false);
  });

  it("verifies polynomial factorization and rejects a changed result", () => {
    const proof = jsonRoundTrip(calculation(factorWithProof(parse("x^2 - 1"), "x")));
    const tampered = jsonRoundTrip(proof) as Record<string, unknown>;
    tampered.result = "x^2 + 1";

    expect(verifyProofCarryingResult(proof, parse("x^2 - 1")).valid).toBe(true);
    expect(verifyProofCarryingResult(tampered).valid).toBe(false);
  });

  it("includes a verifiable antiderivative certificate and serialized domain", () => {
    const source = parseWithDomain("(2*x^2)/x");
    const proof = jsonRoundTrip(calculation(integrateWithProof(source, "x")));
    const tampered = jsonRoundTrip(proof) as Record<string, unknown>;
    tampered.result = "x";

    expect(verifyProofCarryingResult(proof, source).valid).toBe(true);
    expect(verifyProofCarryingResult(tampered).valid).toBe(false);
    const calculationWithCertificate = proof as Extract<
      ProofCarryingCalculation,
      { operation: "integrate" }
    >;
    expect(calculationWithCertificate.domain.conditions).toHaveLength(1);
    expect(calculationWithCertificate.proof.certificate.version).toBe(1);
  });

  it("certifies all real candidates and retains domain-excluded roots", () => {
    const source = parseWithDomain("((x - 1)^2)/(x - 1)");
    const proof = jsonRoundTrip(calculation(solveWithProof(source, "x"))) as
      Extract<ProofCarryingCalculation, { operation: "solve" }>;
    const tampered = jsonRoundTrip(proof) as Record<string, unknown>;
    const result = tampered.result as { excludedSolutions: string[] };
    result.excludedSolutions = [];

    expect(proof.result.candidates).toEqual(["1"]);
    expect(proof.result.solutions).toEqual([]);
    expect(proof.result.excludedSolutions).toEqual(["1"]);
    expect(verifyProofCarryingResult(proof, source).valid).toBe(true);
    expect(verifyProofCarryingResult(tampered).valid).toBe(false);
  });

  it.each(["x^4 + 10*x^2 + x + 1", "x^4 - 10*x^2 + x + 1"])(
    "does not create a proof when quartic radicals cannot be filtered: %s", source => {
      const result = solveWithProof(parse(source), "x");
      expect(result.status).toBe("unsupported");
      expect(result.message).toMatch(/Filtering quartic radical solutions/);
      expect("calculation" in result).toBe(false);
    },
  );

  it.each(["x^2 - pi", "x^2 - y"])("does not claim a real-root proof for %s", source => {
    const result = solveWithProof(parse(source), "x");
    expect(result.status).toBe("unsupported");
    expect(result.message).toMatch(/symbolic constants or parameters/);
  });

  it("does not claim a proof for an irrational-power solution", () => {
    const result = solveWithProof(parse("x^sqrt(2) - 2"), "x");
    expect(result.status).toBe("unsupported");
  });
});
