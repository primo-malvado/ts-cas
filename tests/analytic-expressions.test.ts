import { describe, expect, it } from "vitest";
import { parse, solveLineParabolaExpressions } from "../src/index.js";

describe("generic line/parabola parameter analysis", () => {
  it("extracts coefficients from the expressions and solves no-intersection condition", () => {
    const result = solveLineParabolaExpressions(
      parse("m*x + 2"),
      parse("x^2 - x + 6"),
      "x",
      "m",
      "no-intersection",
    );
    expect(result.status).toBe("complete");
    expect(result.discriminantText.replaceAll(" ", "")).toContain("m");
    expect(result.solutionSet).toContain("-5");
    expect(result.solutionSet).toContain("3");
  });
});
