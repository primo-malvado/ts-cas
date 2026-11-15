import { describe, expect, it } from "vitest";
import { parse, solveLineParabolaParameter } from "../src/index.js";

describe("step-by-step analytic geometry problem solver", () => {
  it("solves a line-parabola no-intersection problem", () => {
    const result = solveLineParabolaParameter(
      parse("m"), parse("2"), parse("1"), parse("-1"), parse("6"), "m", "no-intersection",
    );
    expect(result.status).toBe("complete");
    expect(result.discriminantText).toBe("-15 + 2*m + m^2");
    expect(result.solutionSet).toBe("]-5, 3[");
    expect(result.steps).toHaveLength(7);
  });

  it("solves the tangent condition", () => {
    const result = solveLineParabolaParameter(
      parse("m"), parse("2"), parse("1"), parse("-1"), parse("6"), "m", "tangent",
    );
    expect(result.status).toBe("complete");
    expect(result.solutionSet).toContain("-5");
    expect(result.solutionSet).toContain("3");
  });

  it("solves the two-distinct-intersections condition", () => {
    const result = solveLineParabolaParameter(
      parse("m"), parse("2"), parse("1"), parse("-1"), parse("6"), "m", "two-intersections",
    );
    expect(result.status).toBe("complete");
    expect(result.solutionSet).toBe("]−∞, -5[ ∪ ]3, +∞[");
  });
  it("solves the at-least-one-intersection condition", () => {
    const result = solveLineParabolaParameter(
      parse("m"), parse("2"), parse("1"), parse("-1"), parse("6"), "m", "at-least-one-intersection",
    );
    expect(result.status).toBe("complete");
    expect(result.solutionSet).toBe("]−∞, -5] ∪ [3, +∞[");
  });

});
