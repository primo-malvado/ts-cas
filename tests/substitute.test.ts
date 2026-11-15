import { describe, expect, it } from "vitest";
import { parse, substitute, toString } from "../src/index.js";

describe("symbolic substitution", () => {
  it("substitutes multiple variables and simplifies exact arithmetic", () => {
    expect(toString(substitute(parse("x^2 + y"), { x: parse("2"), y: parse("3") }))).toBe("7");
  });

  it("leaves symbols not present in the substitution map unchanged", () => {
    expect(toString(substitute(parse("x + y"), { x: parse("4") }))).toBe("4 + y");
  });

  it("substitutes inside function arguments without evaluating unsupported functions", () => {
    expect(toString(substitute(parse("sin(x) + 1"), { x: parse("pi/2") }))).toBe("sin(1/2*pi) + 1");
  });
});
