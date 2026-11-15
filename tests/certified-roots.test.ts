import { describe, expect, it } from "vitest";
import { parse } from "../src/core/parser.js";
import { decimalInterval } from "../src/numeric/interval.js";
import { decimal, decimalCompare } from "../src/numeric/decimal.js";
import { certifyRealRoots } from "../src/numeric/certified-roots.js";

describe("certified interval root isolation", () => {
  it("certifies simple roots and excludes the remaining real interval", () => {
    const result = certifyRealRoots(parse("x^2 - 2"), "x", "-2", "2", {
      precision: 35,
      tolerance: "1e-20",
    });
    expect(result.status).toBe("certified");
    expect(result.certified).toBe(true);
    expect(result.roots).toHaveLength(2);
    expect(result.roots.every(root => root.certified && root.unique)).toBe(true);
    expect(result.roots[0]!.upperText.startsWith("-1.4142135623")).toBe(true);
    expect(result.roots[1]!.lowerText.startsWith("1.4142135623")).toBe(true);
  });

  it("certifies a unique root for a nonlinear algebraic expression", () => {
    const result = certifyRealRoots(parse("sqrt(x + 2) - 2"), "x", "0", "5", {
      precision: 35,
      tolerance: "1e-18",
    });
    expect(result.status).toBe("certified");
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]!.lowerText.startsWith("1.999999999")).toBe(true);
    expect(result.roots[0]!.upperText.startsWith("2")).toBe(true);
    expect(result.roots[0]!.certified).toBe(true);
  });

  it("is exposed through the shared engine with the configured precision", async () => {
    const { createNumericalEngine } = await import("../src/numeric/engine.js");
    const cas = createNumericalEngine({ precision: 35, rootTolerance: "1e-22" });
    const result = cas.certifyRoots(parse("x^2 - 2"), "x", "1", "2");
    expect(result.status).toBe("certified");
    expect(result.precision).toBe(35);
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]!.widthText).not.toBe("0");
  });

  it("certifies no root when interval images exclude zero", () => {
    const result = certifyRealRoots(parse("x^2 + 1"), "x", "-5", "5", {
      precision: 30,
      tolerance: "1e-15",
    });
    expect(result.status).toBe("none");
    expect(result.certified).toBe(true);
    expect(result.roots).toHaveLength(0);
  });

  it("certifies multiple polynomial roots exactly and reports multiplicity", () => {
    const result = certifyRealRoots(parse("(x - 1)^2*(x + 2)^3"), "x", "-3", "2", {
      precision: 30,
      tolerance: "1e-16",
    });
    expect(result.status).toBe("certified");
    expect(result.certified).toBe(true);
    expect(result.roots).toHaveLength(2);
    expect(result.roots.map(root => root.multiplicity)).toEqual([3, 2]);
    expect(result.roots.every(root => root.method === "exact-sturm" && root.certified)).toBe(true);
  });

  it("includes exact polynomial roots that lie on the search endpoints", () => {
    const result = certifyRealRoots(parse("(x - 1)*(x - 2)"), "x", "1", "2", {
      precision: 30,
      tolerance: "1e-15",
    });
    expect(result.status).toBe("certified");
    expect(result.roots).toHaveLength(2);
    expect(result.roots[0]!.lowerText).toBe("1");
    expect(result.roots[0]!.upperText).toBe("1");
    expect(result.roots[1]!.lowerText).toBe("2");
    expect(result.roots[1]!.upperText).toBe("2");
  });

  it("reports that the zero polynomial has a continuum of roots", () => {
    const result = certifyRealRoots(parse("0"), "x", "-1", "1");
    expect(result.status).toBe("partial");
    expect(result.certified).toBe(false);
    expect(result.unresolved).toHaveLength(1);
    expect(result.message).toContain("every point");
  });

  it("certifies supported transcendental expressions and rejects unsupported ones", () => {
    const sine = certifyRealRoots(parse("sin(x)"), "x", "-1", "1", {
      precision: 35,
      tolerance: "1e-20",
    });
    expect(sine.status).toBe("certified");
    expect(sine.certified).toBe(true);
    expect(sine.roots).toHaveLength(1);
    expect(sine.roots[0]!.lowerText).toBe("0");
    expect(sine.roots[0]!.upperText).toBe("0");

    const unsupported = certifyRealRoots(parse("atan(x)"), "x", "-1", "1");
    expect(unsupported.status).toBe("unsupported");
    expect(unsupported.certified).toBe(false);
    expect(unsupported.message).toContain("no certified interval extension");
  });

  it("applies fixed interval bindings for other variables", () => {
    const result = certifyRealRoots(parse("x + a - 3"), "x", "0", "5", {
      precision: 25,
      tolerance: "1e-12",
      bindings: { a: decimalInterval(1) },
    });
    expect(result.status).toBe("certified");
    expect(result.roots).toHaveLength(1);
    expect(decimalCompare(result.roots[0]!.lower, decimal("2")) <= 0).toBe(true);
    expect(decimalCompare(result.roots[0]!.upper, decimal("2")) >= 0).toBe(true);
  });

  it("uses interval Newton to contract a simple root bracket efficiently", () => {
    const result = certifyRealRoots(parse("exp(x) - 2"), "x", "0", "1", {
      precision: 40,
      tolerance: "1e-28",
      maxSubdivisions: 100,
    });
    expect(result.status).toBe("certified");
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]!.widthText.length).toBeGreaterThan(0);
    // A pure bisection proof at this tolerance would require about 94 splits.
    expect(result.subdivisions).toBeLessThan(30);
  });

  it("keeps two simple roots in separate certified brackets", () => {
    const result = certifyRealRoots(parse("(x - 1)*(x - 1.0001)"), "x", "0.9", "1.1", {
      precision: 40,
      tolerance: "1e-18",
      maxSubdivisions: 2000,
    });
    expect(result.status).toBe("certified");
    expect(result.roots).toHaveLength(2);
    expect(decimalCompare(result.roots[0]!.upper, result.roots[1]!.lower)).toBeLessThanOrEqual(0);
    expect(result.roots.every(root => root.certified && root.unique)).toBe(true);
  });

  it("certifies absolute-value roots when the bracket stays away from the cusp", () => {
    const result = certifyRealRoots(parse("abs(x) - 1"), "x", "-2", "2", {
      precision: 25,
      tolerance: "1e-10",
    });
    expect(result.status).toBe("certified");
    expect(result.roots).toHaveLength(2);
    expect(result.roots[0]!.lowerText).toBe("-1");
    expect(result.roots[1]!.upperText).toBe("1");
  });

  it("does not use smooth-root certification across an absolute-value cusp", () => {
    const result = certifyRealRoots(parse("abs(x) + 3*x"), "x", "-1", "1", {
      precision: 25,
      tolerance: "1e-8",
      maxSubdivisions: 300,
    });
    expect(result.status).toBe("partial");
    expect(result.certified).toBe(false);
    expect(result.unresolved.length).toBeGreaterThan(0);
  });

  it("isolates an interior root even when both search endpoints are exact roots", () => {
    const result = certifyRealRoots(
      parse("(x - 1)*(x - 1.00000000000000000001)*(x - 1.00000000000000000002)"),
      "x",
      "1",
      "1.00000000000000000002",
      { precision: 35, tolerance: "1e-30", maxSubdivisions: 500 },
    );
    expect(result.status).toBe("certified");
    expect(result.roots).toHaveLength(3);
    expect(result.roots.map(root => root.multiplicity)).toEqual([1, 1, 1]);
  });

  it("reports an explicit partial result if the subdivision budget is exhausted", () => {
    const result = certifyRealRoots(parse("x^2 - 2"), "x", "-2", "2", {
      precision: 40,
      tolerance: "1e-30",
      maxSubdivisions: 1,
    });
    expect(result.status).toBe("partial");
    expect(result.certified).toBe(false);
    expect(result.unresolved.length).toBeGreaterThan(0);
  });
});
