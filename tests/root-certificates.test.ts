import { describe, expect, it } from "vitest";
import {
  createPolynomialRootCertificate,
  exactRational,
  parse,
  verifyCertificate,
  verifyPolynomialRootCertificate,
} from "../src/index.js";

describe("verifiable polynomial root certificates", () => {
  it("survives JSON round-tripping and verifies exact root counts", () => {
    const expression = parse("x^2 - 2");
    const result = createPolynomialRootCertificate(expression, "x");

    expect(result.status).toBe("complete");
    if (!("certificate" in result)) throw new Error("Expected a complete root certificate.");
    expect(result.certificate.roots).toHaveLength(2);
    expect(result.certificate.totalDistinctRealRoots).toBe(2);

    const restored = JSON.parse(JSON.stringify(result.certificate)) as unknown;
    expect(verifyPolynomialRootCertificate(restored, expression)).toEqual({ valid: true, errors: [] });
    expect(verifyCertificate("polynomial-root", restored, { expectedExpression: expression }))
      .toEqual({ valid: true, errors: [] });
  });

  it("rejects altered Sturm variation counts and incomplete root lists", () => {
    const result = createPolynomialRootCertificate(parse("x^2 - 2"), "x");
    if (!("certificate" in result)) throw new Error("Expected a root certificate.");
    const certificate = result.certificate;
    const altered = {
      ...certificate,
      roots: certificate.roots.map((root, index) => index === 0
        ? {
            ...root,
            sturmVariations: {
              ...root.sturmVariations,
              atLower: root.sturmVariations.atLower + 1,
            },
          }
        : root),
    };
    expect(verifyPolynomialRootCertificate(altered).valid).toBe(false);
    expect(verifyPolynomialRootCertificate({
      ...certificate,
      roots: certificate.roots.slice(0, 1),
    }).valid).toBe(false);
  });

  it("checks multiplicity and binds a certificate to an expected expression", () => {
    const expression = parse("(x - 1)^2*(x + 2)^3");
    const result = createPolynomialRootCertificate(expression, "x");
    if (!("certificate" in result)) throw new Error("Expected a root certificate.");

    expect(result.certificate.roots.map(root => root.multiplicity)).toEqual([3, 2]);
    expect(verifyPolynomialRootCertificate(result.certificate, expression).valid).toBe(true);
    expect(verifyPolynomialRootCertificate(result.certificate, parse("x^2 - 3")).valid).toBe(false);
    expect(verifyPolynomialRootCertificate({
      ...result.certificate,
      roots: result.certificate.roots.map(root => ({ ...root, multiplicity: root.multiplicity + 1 })),
    }).valid).toBe(false);
  });

  it("returns verifiable partial certificates when some roots remain grouped", () => {
    const result = createPolynomialRootCertificate(parse("x^4 - 5*x^2 + 4"), "x", {
      tolerance: exactRational(1n, 1_000_000n),
      maxIterations: 1,
    });

    expect(result.status).toBe("partial");
    if (!("certificate" in result)) throw new Error("Expected a partial root certificate.");
    expect(result.certificate.unresolvedIntervals.length).toBeGreaterThan(0);
    expect(verifyPolynomialRootCertificate(result.certificate).valid).toBe(true);
  });

  it("does not claim a finite certificate for unsupported expressions or the zero polynomial", () => {
    expect(createPolynomialRootCertificate(parse("sin(x)"), "x").status).toBe("unsupported");
    expect(createPolynomialRootCertificate(parse("0"), "x").status).toBe("all");

    const constant = createPolynomialRootCertificate(parse("5"), "x");
    expect(constant.status).toBe("complete");
    if ("certificate" in constant) {
      expect(constant.certificate.totalDistinctRealRoots).toBe(0);
      expect(verifyPolynomialRootCertificate(constant.certificate).valid).toBe(true);
    }
  });
});
