import { describe, expect, it } from "vitest";
import { parse } from "../src/core/parser.js";
import { decimal, decimalAbs, decimalCompare, decimalSubtract } from "../src/numeric/decimal.js";
import { solveRootDecimal } from "../src/numeric/root-finding-decimal.js";

describe("arbitrary-precision root finding for general expressions", () => {
  it("solves a transcendental equation beyond double precision", () => {
    const result = solveRootDecimal(parse("exp(x) - 2"), "x", "0", "1", {}, {
      precision: 65,
      tolerance: "1e-72",
    });
    expect(result.status).toBe("converged");
    expect(result.rootText?.startsWith("0.6931471805599453094172321214581765680755001343602552541206800")).toBe(true);
    expect(decimalCompare(result.residual!, decimal("1e-55"))).toBeLessThan(0);
  });

  it("solves a general expression using exact decimal endpoints", () => {
    const result = solveRootDecimal(parse("x^2 - 2"), "x", "1", "2", {}, {
      precision: 80,
      tolerance: "1e-78",
    });
    expect(result.converged).toBe(true);
    expect(result.rootText?.startsWith("1.41421356237309504880168872420969807856967187537694807317667973799")).toBe(true);
    const root = decimal(result.rootText!);
    expect(decimalCompare(decimalAbs(decimalSubtract(root, decimal("1.4142135623730950488016887242096980785696718753769480731766797379907324784621070388503875343276415727"))), decimal("1e-70"))).toBeLessThan(0);
  });

  it("reports when an interval does not bracket a root", () => {
    const result = solveRootDecimal(parse("x^2 + 1"), "x", "-1", "1");
    expect(result.status).toBe("no-bracket");
    expect(result.converged).toBe(false);
    expect(result.root).toBeUndefined();
  });

  it("returns exact endpoint roots immediately", () => {
    const result = solveRootDecimal(parse("x^2 - 1"), "x", "1", "2");
    expect(result.status).toBe("converged");
    expect(result.iterations).toBe(0);
    expect(result.rootText).toBe("1");
  });

  it("makes an exhausted iteration budget explicit", () => {
    const result = solveRootDecimal(parse("x^2 - 2"), "x", "1", "2", {}, {
      precision: 60,
      tolerance: "1e-50",
      maxIterations: 2,
    });
    expect(result.status).toBe("max-iterations");
    expect(result.converged).toBe(false);
    expect(result.root).toBeDefined();
  });

  it("preserves the working-precision bracket and applies the selected rounding mode", () => {
    const result = solveRootDecimal(parse("x - 1.25"), "x", "1", "2", {}, {
      precision: 2,
      rounding: "ceil",
    });
    expect(result.status).toBe("converged");
    expect(result.rootText).toBe("1.3");
    expect(result.lowerText).toBe("1.25");
    expect(result.upperText).toBe("1.25");
  });

  it("rejects invalid intervals and tolerances", () => {
    expect(() => solveRootDecimal(parse("x"), "x", "1", "1")).toThrow(/distinct endpoints/);
    expect(() => solveRootDecimal(parse("x"), "x", "0", "1", {}, { tolerance: "0" })).toThrow(/positive/);
  });
});
