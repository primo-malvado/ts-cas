import { describe, expect, it } from "vitest";
import { analyzeContinuity, parse, toString } from "../src/index.js";

describe("continuity analysis", () => {
  it("classifies a polynomial as continuous", () => {
    const result = analyzeContinuity(parse("x^2 + 1"), "x", parse("2"));
    expect(result.status).toBe("complete");
    expect(result.classification).toBe("continuous");
    expect(toString(result.pointValue!)).toBe("5");
  });

  it("detects a removable hole even when the limit exists", () => {
    const result = analyzeContinuity(parse("(x^2 - 1)/(x - 1)"), "x", parse("1"));
    expect(result.status).toBe("complete");
    expect(result.classification).toBe("removable-discontinuity");
    expect(result.pointDomain).toBe("undefined");
    expect(toString(result.commonLimit!)).toBe("2");
  });

  it("detects a jump discontinuity", () => {
    const result = analyzeContinuity(parse("sign(x)"), "x", parse("0"));
    expect(result.classification).toBe("jump-discontinuity");
    expect(result.leftLimit.status).toBe("finite");
    expect(result.rightLimit.status).toBe("finite");
  });

  it("detects an infinite discontinuity", () => {
    const result = analyzeContinuity(parse("1/x"), "x", parse("0"));
    expect(result.classification).toBe("infinite-discontinuity");
  });

  it("treats a domain endpoint as continuous relative to the real domain", () => {
    const result = analyzeContinuity(parse("sqrt(x)"), "x", parse("0"));
    expect(result.status).toBe("complete");
    expect(result.classification).toBe("continuous");
    expect(result.leftDomain).toBe("excluded");
    expect(result.rightDomain).toBe("available");
  });

  it("identifies logarithmic divergence at a domain boundary", () => {
    const result = analyzeContinuity(parse("ln(x)"), "x", parse("0"));
    expect(result.classification).toBe("infinite-discontinuity");
    expect(result.leftDomain).toBe("excluded");
    expect(result.rightDomain).toBe("available");
  });

  it("does not claim a point value at a removable singularity", () => {
    const result = analyzeContinuity(parse("(x^2 - 4)/(x - 2)"), "x", parse("2"));
    expect(result.pointValue).toBeUndefined();
    expect(result.classification).toBe("removable-discontinuity");
    expect(toString(result.commonLimit!)).toBe("4");
  });

  it("classifies negative fractional powers as infinite discontinuities at zero", () => {
    const result = analyzeContinuity(parse("x^(-1/2)"), "x", parse("0"));
    expect(result.pointValue).toBeUndefined();
    expect(result.classification).toBe("infinite-discontinuity");
    expect(result.rightLimit.status).toBe("positive-infinity");
    expect(result.leftDomain).toBe("excluded");
    expect(result.rightDomain).toBe("available");
  });

  it("supports exact rational points", () => {
    const result = analyzeContinuity(parse("x"), "x", parse("1/2"));
    expect(result.classification).toBe("continuous");
    expect(toString(result.pointValue!)).toBe("1/2");
  });
});
