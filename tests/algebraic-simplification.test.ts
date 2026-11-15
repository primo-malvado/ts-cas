import { describe, expect, it } from "vitest";
import {
  expand,
  equals,
  parse,
  simplify,
  toString,
} from "../src/index.js";

describe("trigonometric simplification", () => {
  it("evaluates common rational multiples of pi exactly", () => {
    const cases: readonly [string, string][] = [
      ["sin(pi)", "0"],
      ["cos(pi)", "-1"],
      ["sin(pi/2)", "1"],
      ["cos(pi/2)", "0"],
      ["sin(pi/6)", "1/2"],
      ["cos(pi/3)", "1/2"],
      ["cos(3*pi/4)", "sqrt(2)*-1/2"],
      ["sin(-pi/2)", "-1"],
    ];

    for (const [source, expected] of cases) {
      expect(toString(simplify(parse(source)))).toBe(expected);
    }
  });

  it("leaves unsupported exact angles symbolic", () => {
    expect(toString(simplify(parse("sin(pi/5)")))).toBe("sin(1/5*pi)");
  });

  it("applies the Pythagorean identity to matching arguments and coefficients", () => {
    expect(toString(simplify(parse("sin(x)^2 + cos(x)^2")))).toBe("1");
    expect(toString(simplify(parse("cos(x)^2 + sin(x)^2")))).toBe("1");
    expect(toString(simplify(parse("3*sin(x)^2 + 3*cos(x)^2")))).toBe("3");
    expect(toString(simplify(parse("1 - cos(x)^2")))).toBe("sin(x)^2");
    expect(equals(simplify(parse("a - a*cos(x)^2")), parse("a*sin(x)^2"))).toBe(true);
  });

  it("expands cos(2*a) into squares of sine and cosine", () => {
    expect(equals(expand(parse("cos(2*a)")), parse("cos(a)^2 - sin(a)^2"))).toBe(true);
    const otherMultiple = parse("cos(3*a)");
    expect(equals(expand(otherMultiple), otherMultiple)).toBe(true);
  });

  it("does not combine trigonometric squares with different arguments", () => {
    const expression = parse("sin(x)^2 + cos(y)^2");
    expect(equals(simplify(expression), expression)).toBe(true);
  });
});

describe("power simplification", () => {
  it.each([
    ["(4)^(1/2)", "2"],
    ["(9/16)^(1/2)", "3/4"],
    ["(1524157875322755800955129)^(1/2)", "1234567890123"],
    ["sqrt(4)", "2"],
    ["1 + (4)^(1/2)", "3"],
  ])("simplifies exact square roots: %s", (source, expected) => {
    expect(toString(simplify(parse(source)))).toBe(expected);
  });

  it.each(["2^(1/2)", "(-4)^(1/2)", "(x^2)^(1/2)", "sqrt(-4)"])(
    "keeps non-rational or branch-sensitive square roots symbolic: %s", source => {
      const expression = parse(source);
      expect(equals(simplify(expression), expression)).toBe(true);
    },
  );

  it("combines powers with a shared integer exponent", () => {
    expect(equals(simplify(parse("x^2*y^2")), parse("(x*y)^2"))).toBe(true);
  });

  it("combines arbitrary exponents only for bases known to be positive", () => {
    expect(equals(simplify(parse("E^a*E^b")), parse("E^(a+b)"))).toBe(true);
    const symbolicBase = parse("x^a*x^b");
    expect(equals(simplify(symbolicBase), symbolicBase)).toBe(true);
  });

  it("denests integer powers without changing fractional-power branches", () => {
    expect(equals(simplify(parse("(x^2)^3")), parse("x^6"))).toBe(true);
    const branchSensitive = parse("(x^2)^(1/2)");
    expect(equals(simplify(branchSensitive), branchSensitive)).toBe(true);
  });

  it("expands powers of products for integer exponents", () => {
    expect(equals(expand(parse("(x*y)^-2")), parse("x^-2*y^-2"))).toBe(true);
  });

  it("splits sums in exponents only for bases known to be positive", () => {
    expect(equals(expand(parse("2^(a+b)")), parse("2^a*2^b"))).toBe(true);
    const symbolicBase = parse("x^(a+b)");
    expect(equals(expand(symbolicBase), symbolicBase)).toBe(true);
  });
});
