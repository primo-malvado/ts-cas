import { describe, expect, it } from "vitest";
import { evaluate, parse, sampleFunction } from "../src/index.js";

describe("numeric evaluation", () => {
  it("evaluates expressions and constants", () => {
    expect(evaluate(parse("sin(pi/2)"))).toBeCloseTo(1, 12);
    expect(evaluate(parse("x^2 + 2x"), { x: 3 })).toBe(15);
  });
  it("rejects unknown symbols, real-domain errors and overflow", () => {
    expect(() => evaluate(parse("x+1"))).toThrow();
    expect(() => evaluate(parse("log(-1)"))).toThrow();
    expect(() => evaluate(parse("exp(1000)"))).toThrow(/non-finite/i);
  });
  it("samples graphs and leaves gaps at invalid points", () => {
    const sample = sampleFunction(parse("1/x"), "x", -1, 1, 5);
    expect(sample.points[0]!.y).toBe(-1);
    expect(sample.points[2]!.y).toBeNull();
    expect(sample.points[4]!.y).toBe(1);
  });
});
