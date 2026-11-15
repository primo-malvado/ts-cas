import { describe, expect, it } from "vitest";
import {
  createAntiderivativeCertificate,
  parse,
  verifyAntiderivativeCertificate,
} from "../src/index.js";

describe("antiderivative identity certificates", () => {
  it("verifies polynomial, elementary, and substitution primitives after JSON round-trip", () => {
    for (const source of ["2*x", "cos(x)", "2*x*cos(x^2)"]) {
      const integrand = parse(source);
      const result = createAntiderivativeCertificate(integrand, "x");

      expect(result.status).toBe("complete");
      if (!("certificate" in result)) throw new Error("Expected an antiderivative certificate.");
      const saved = JSON.parse(JSON.stringify(result.certificate)) as unknown;
      expect(verifyAntiderivativeCertificate(saved, integrand))
        .toEqual({ valid: true, errors: [] });
    }
  });

  it("rejects altered integrands and incorrect candidate primitives", () => {
    const integrand = parse("2*x");
    const result = createAntiderivativeCertificate(integrand, "x");
    if (!("certificate" in result)) throw new Error("Expected an antiderivative certificate.");

    expect(verifyAntiderivativeCertificate({
      ...result.certificate,
      antiderivative: "x",
    }).valid).toBe(false);
    expect(verifyAntiderivativeCertificate(
      result.certificate,
      parse("3*x"),
    ).valid).toBe(false);
    expect(createAntiderivativeCertificate(integrand, "x", parse("x")).status)
      .toBe("unsupported");
  });
});
