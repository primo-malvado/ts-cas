import { describe, expect, it } from "vitest";
import { parse } from "../src/core/parser.js";
import { decimal, decimalAbs, decimalCompare, decimalSubtract, decimalToString } from "../src/numeric/decimal.js";
import { createNumericalEngine } from "../src/numeric/engine.js";

describe("shared high-precision numerical engine", () => {
  it("applies one precision setting to evaluation, differentiation, integration and roots", () => {
    const engine = createNumericalEngine({ precision: 40 });
    expect(engine.precision).toBe(40);
    expect(decimalToString(engine.evaluate(parse("1/7"))).startsWith("0.1428571428571428571428571428571428571429")).toBe(true);

    const derivative = engine.derivative(parse("x^3"), "x", "1.25");
    expect(derivative.precision).toBe(40);
    expect(derivative.method).toBe("symbolic");
    expect(derivative.valueText.startsWith("4.6875")).toBe(true);

    const integral = engine.integrate(parse("x^2"), "x", "0", "1");
    expect(integral.precision).toBe(40);
    expect(integral.converged).toBe(true);
    expect(integral.valueText.startsWith("0.3333333333333333333333333333333333333333")).toBe(true);

    const roots = engine.solvePolynomial(parse("x^2 - 2"), "x");
    expect(roots.precision).toBe(40);
    expect(roots.status).toBe("finite");
    expect(roots.roots).toHaveLength(2);
  });

  it("allows per-operation overrides without mutating the engine", () => {
    const engine = createNumericalEngine({ precision: 30 });
    const value = engine.evaluate(parse("sqrt(2)"), {}, { precision: 70 });
    expect(engine.precision).toBe(30);
    expect(value.scale).toBeGreaterThan(30);

    const derivative = engine.derivative(parse("sin(x)"), "x", "1", {}, {
      precision: 45,
      preferSymbolic: false,
      tolerance: "1e-35",
    });
    expect(derivative.precision).toBe(45);
  });

  it("creates immutable configured engines", () => {
    const base = createNumericalEngine({ precision: 25 });
    const high = base.withPrecision(90);
    const floor = base.withRounding("floor");
    expect(base.precision).toBe(25);
    expect(high.precision).toBe(90);
    expect(floor.rounding).toBe("floor");
    expect(high.rounding).toBe("half-even");
  });

  it("passes operation-specific tolerances and iteration budgets", () => {
    const engine = createNumericalEngine({
      precision: 40,
      rootTolerance: "1e-35",
      maxRootIterations: 800,
      integrationTolerance: "1e-32",
      maxIntegrationDepth: 8,
    });
    const roots = engine.solvePolynomial(parse("x^2 - 2"), "x");
    expect(roots.status).toBe("finite");
    expect(roots.roots.every(root => root.converged)).toBe(true);

    const integral = engine.integrate(parse("sin(x)"), "x", "0", "1");
    expect(integral.converged).toBe(true);
    expect(decimalCompare(integral.estimatedError, decimal("1e-30")) < 0).toBe(true);
  });

  it("applies the selected rounding mode consistently", () => {
    const floorEngine = createNumericalEngine({ precision: 6, rounding: "floor" });
    const evenEngine = createNumericalEngine({ precision: 6, rounding: "half-even" });
    expect(decimalToString(floorEngine.evaluate(parse("1/3")))).toBe("0.333333");
    expect(decimalToString(evenEngine.evaluate(parse("1/3")))).toBe("0.333333");
    expect(decimalToString(floorEngine.evaluate(parse("-1/3")))).toBe("-0.333334");
    expect(decimalToString(evenEngine.evaluate(parse("-1/3")))).toBe("-0.333333");
  });

  it("routes general-expression root finding through the shared precision settings", () => {
    const engine = createNumericalEngine({
      precision: 55,
      rootTolerance: "1e-65",
      maxRootIterations: 300,
    });
    const root = engine.solveRoot(parse("exp(x) - 2"), "x", "0", "1");
    expect(root.status).toBe("converged");
    expect(root.precision).toBe(55);
    expect(root.rootText?.startsWith("0.693147180559945309417232121458176568075500134360255")).toBe(true);

    const stricter = engine.solveRoot(parse("x^2 - 2"), "x", "1", "2", {}, {
      precision: 70,
      tolerance: "1e-62",
    });
    expect(stricter.precision).toBe(70);
    expect(stricter.converged).toBe(true);
    expect(engine.precision).toBe(55);
  });

  it("uses shared precision settings for complex evaluation", () => {
    const engine = createNumericalEngine({ precision: 60, rounding: "half-even" });
    const result = engine.evaluateComplex(parse("exp(i*pi) + 1"));
    expect(decimalCompare(decimalAbs(result.re), decimal("1e-55")) < 0).toBe(true);
    expect(decimalCompare(decimalAbs(result.im), decimal("1e-55")) < 0).toBe(true);
    const overridden = engine.evaluateComplex(parse("exp(i)"), {}, { precision: 75 });
    expect(overridden.re.scale).toBeGreaterThan(60);
    expect(engine.precision).toBe(60);
  });

  it("rejects invalid shared settings", () => {
    expect(() => createNumericalEngine({ precision: 1 })).toThrow();
    expect(() => createNumericalEngine({ derivativeTolerance: "0" })).toThrow(/positive/);
    expect(() => createNumericalEngine({ rounding: "invalid" as never })).toThrow();
  });
});
