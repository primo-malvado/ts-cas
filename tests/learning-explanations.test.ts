import { describe, expect, it } from "vitest";
import {
  differentiateWithSteps,
  factorWithSteps,
  integrateWithSteps,
  parse,
  solveWithSteps,
  toLearningExplanation,
} from "../src/index.js";

describe("learning-oriented explanations", () => {
  it("explains differentiation rules and their real-domain requirements", () => {
    const trace = differentiateWithSteps(parse("ln(x)"), "x");
    const lesson = toLearningExplanation(trace, { variable: "x" });

    expect(lesson.operation).toBe("differentiate");
    expect(lesson.result).toBe("x^-1");
    expect(lesson.steps.at(-1)).toMatchObject({
      rule: "chain-rule-log",
      title: "Apply the chain rule to the logarithm",
      why: expect.stringContaining("u'/u"),
      conditions: expect.arrayContaining([expect.stringContaining("u is positive")]),
    });
  });

  it("turns recursive integration steps into a readable parent-linked lesson", () => {
    const trace = integrateWithSteps(parse("x^2 + sin(2*x)"), "x");
    const lesson = toLearningExplanation(trace);
    const simpleIntegral = toLearningExplanation(integrateWithSteps(parse("2*x"), "x"));
    const root = lesson.steps.find(item => item.parentId === null)!;
    const children = lesson.steps.filter(item => item.parentId === root.id);

    expect(lesson.operation).toBe("integrate");
    expect(root.title).toBe("Integrate each term");
    expect(root.why).toContain("sum");
    expect(root.conditions).toContain("Each term has a supported primitive.");
    expect(children).toHaveLength(2);
    expect(children.every(item => item.title.length > 0 && item.conditions.length > 0)).toBe(true);
    expect(simpleIntegral.result).toBe("x^2 + C");
  });

  it("explains factorization and solver conditions with concrete step data", () => {
    const factorLesson = toLearningExplanation(factorWithSteps(parse("x^2 - 1")));
    const solveLesson = toLearningExplanation(solveWithSteps(parse("x^2 - 5*x + 6"), "x"));
    const identityLesson = toLearningExplanation(solveWithSteps(parse("0"), "x"));
    const discriminant = solveLesson.steps.find(item => item.rule === "quadratic-discriminant")!;

    expect(factorLesson.steps[0]!.why).toContain("canonical polynomial");
    expect(factorLesson.steps[1]!.details).toContain("-1 + x");
    expect(discriminant.expression).toBe("1");
    expect(discriminant.conditions).toContain("The equation is quadratic and a is nonzero.");
    expect(solveLesson.result).toBe("finite: x = 3, 2");
    expect(identityLesson.result).toBe("all: all values of x");
  });

  it("requires the differentiation variable when converting an existing trace", () => {
    const trace = differentiateWithSteps(parse("x^2"), "x");

    expect(() => toLearningExplanation(trace)).toThrow(/variable is required/);
  });
});
