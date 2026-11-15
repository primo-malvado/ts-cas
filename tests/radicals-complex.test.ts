import { describe, expect, it } from "vitest";
import {
  complex, complexDivide, complexMultiply, integer, parse, rational, simplifyRadicals, toString,
} from "../src/index.js";

describe("radical simplification", () => {
  it("extracts square factors", () => {
    expect(toString(simplifyRadicals(parse("sqrt(12)")))).toBe("sqrt(3)*2");
  });

  it("simplifies rational radicals exactly", () => {
    expect(toString(simplifyRadicals(parse("sqrt(2/3)")))).toBe("sqrt(6)*1/3");
  });

  it("handles negative radicands using i", () => {
    expect(toString(simplifyRadicals(parse("sqrt(-4)")))).toBe("2*i");
  });

  it("reduces integer powers of i", () => {
    expect(toString(simplifyRadicals(parse("i^2")))).toBe("-1");
    expect(toString(simplifyRadicals(parse("i^3")))).toBe("-1*i");
    expect(toString(simplifyRadicals(parse("i^4")))).toBe("1");
  });
});

describe("exact complex arithmetic", () => {
  it("multiplies Gaussian rationals", () => {
    const result = complexMultiply(complex(integer(1), integer(2)), complex(integer(3), integer(4)));
    expect(toString(result.re)).toBe("-5");
    expect(toString(result.im)).toBe("10");
  });

  it("divides Gaussian rationals", () => {
    const result = complexDivide(complex(integer(1), integer(2)), complex(integer(3), integer(4)));
    expect(toString(result.re)).toBe("11/25");
    expect(toString(result.im)).toBe("2/25");
  });
});
