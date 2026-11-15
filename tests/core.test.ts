import { describe, expect, it } from "vitest";
import { differentiate, equals, expand, parse, simplify, toString } from "../src/index.js";

describe("parser", () => {
  it("parses implicit multiplication", () => {
    expect(toString(simplify(parse("2x + 3x")))).toBe("5*x");
  });
  it("respects precedence and parentheses", () => {
    expect(toString(parse("2 + 3*x"))).toBe("2 + 3*x");
    expect(toString(parse("(x + 1)^2"))).toBe("(x + 1)^2");
  });
  it("parses functions", () => {
    expect(toString(parse("sin(x^2)"))).toBe("sin(x^2)");
  });
  it("parses decimals as exact rationals", () => {
    expect(toString(parse("0.25"))).toBe("1/4");
  });
  it("parses scientific notation as an exact rational without confusing e with a symbol", () => {
    expect(toString(parse("1e-50"))).toBe("1/100000000000000000000000000000000000000000000000000");
    expect(toString(parse("2.5E+3"))).toBe("2500");
    expect(toString(parse("2E"))).toBe("2*E");
  });
  it.each(["(-63)^(1/3)", "(1/2)^(1/3)", "(x^(1/3))^-1"])(
    "preserves power bases when printing %s", source => {
      const expression = parse(source);
      expect(equals(parse(toString(expression)), expression)).toBe(true);
    },
  );
});

describe("simplification and expansion", () => {
  it("collects like terms", () => {
    expect(toString(simplify(parse("2x + 3x - x")))).toBe("4*x");
  });
  it("simplifies integer powers", () => {
    expect(toString(simplify(parse("2^5")))).toBe("32");
  });
  it("expands a square", () => {
    expect(toString(expand(parse("(x + 2)^2")))).toBe("4 + 4*x + x^2");
  });
});

describe("differentiation", () => {
  it("differentiates a polynomial", () => {
    expect(toString(differentiate(parse("x^3 + 2x"), "x"))).toBe("2 + 3*x^2");
  });
  it("uses the chain rule for sin(x^2)", () => {
    expect(toString(differentiate(parse("sin(x^2)"), "x"))).toBe("2*x*cos(x^2)");
  });
});


describe("canonical expression constructors", () => {
  it("flattens nested sums and sorts terms", () => {
    expect(toString(parse("x + (y + x)"))).toBe("2*x + y");
  });
  it("combines repeated factors and powers", () => {
    expect(toString(parse("x*x*x"))).toBe("x^3");
    expect(toString(parse("x^2*x^3"))).toBe("x^5");
  });
  it("normalizes rational numbers", () => {
    expect(toString(parse("2/4"))).toBe("1/2");
    expect(toString(parse("0.5 + 1/2"))).toBe("1");
  });
});

describe("structural equality after canonicalization", () => {
  it("recognizes identical canonical forms", () => {
    expect(equals(parse("x + x"), parse("2*x"))).toBe(true);
    expect(equals(parse("x*x"), parse("x^2"))).toBe(true);
  });
});
