import { describe, expect, it } from "vitest";
import {
  createPolynomialInequalityCertificate,
  parse,
  verifyPolynomialInequalityCertificate,
} from "../src/index.js";

describe("verifiable polynomial inequality certificates", () => {
  it("certifies a complete sign chart from exact root intervals and rational witnesses", () => {
    const expression = parse("x^2 - 4");
    const result = createPolynomialInequalityCertificate(expression, "x", "<=");

    expect(result.status).toBe("complete");
    if (!("certificate" in result)) throw new Error("Expected an inequality certificate.");
    expect(result.certificate.polynomial.roots).toHaveLength(2);
    expect(result.certificate.cells.map(cell => [cell.sign, cell.accepted])).toEqual([
      [1, false],
      [-1, true],
      [1, false],
    ]);
    expect(result.certificate.includedRootIndices).toEqual([0, 1]);
    expect(verifyPolynomialInequalityCertificate(
      JSON.parse(JSON.stringify(result.certificate)) as unknown,
      expression,
    )).toEqual({ valid: true, errors: [] });
  });

  it("rejects altered sign claims and certificates for a different expression", () => {
    const expression = parse("x^2 - 4");
    const result = createPolynomialInequalityCertificate(expression, "x", ">");
    if (!("certificate" in result)) throw new Error("Expected an inequality certificate.");

    const altered = {
      ...result.certificate,
      cells: result.certificate.cells.map((cell, index) => index === 1
        ? { ...cell, accepted: !cell.accepted }
        : cell),
    };
    expect(verifyPolynomialInequalityCertificate(altered).valid).toBe(false);
    expect(verifyPolynomialInequalityCertificate(
      result.certificate,
      parse("x^2 - 5"),
    ).valid).toBe(false);
  });

  it("refuses to certify expressions outside the exact polynomial domain", () => {
    expect(createPolynomialInequalityCertificate(parse("sin(x)"), "x", ">").status)
      .toBe("unsupported");
  });
});
