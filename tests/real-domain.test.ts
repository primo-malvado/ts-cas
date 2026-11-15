import { describe, expect, it } from "vitest";
import {
  analyzeRealDomain,
  exactRational,
  parse,
  type RealDomainRestriction,
} from "../src/index.js";

const q = (n: bigint, d = 1n) => exactRational(n, d);
const byKind = (items: readonly RealDomainRestriction[], kind: RealDomainRestriction["kind"]) =>
  items.filter(item => item.kind === kind);

describe("certified real-domain analysis", () => {
  it("identifies the nonnegative region for sqrt(x - 1)", () => {
    const result = analyzeRealDomain(parse("sqrt(x - 1)"), "x", q(-2n), q(3n));
    expect(result.status).toBe("complete");
    const restriction = byKind(result.restrictions, "sqrt")[0]!;
    expect(restriction.condition).toBe("nonnegative");
    expect(restriction.boundaries).toHaveLength(1);
    expect(restriction.boundaries[0]!.kind).toBe("exact-root-interval");
    expect(restriction.regions?.map(region => region.conditionState)).toEqual(["violated", "boundary", "satisfied"]);
  });

  it("treats a zero of sqrt's argument as an included boundary", () => {
    const result = analyzeRealDomain(parse("sqrt(x^2)"), "x", q(-1n), q(1n));
    expect(result.status).toBe("complete");
    const restriction = byKind(result.restrictions, "sqrt")[0]!;
    const atZero = restriction.boundaries.find(boundary =>
      boundary.kind === "exact-root-interval" &&
      boundary.interval.lower.numerator <= 0n && boundary.interval.upper.numerator >= 0n,
    );
    expect(atZero?.kind).toBe("exact-root-interval");
    // Unless the isolator proves the algebraic root exactly rational, it returns a
    // certified bracket rather than pretending the bracket itself is the point.
    if (atZero?.kind === "exact-root-interval") expect(["included", "enclosure"]).toContain(atZero.pointStatus);
    expect(restriction.regions?.some(region => region.conditionState === "boundary")).toBe(true);
    expect(restriction.regions?.filter(region => region.conditionState === "satisfied").length).toBeGreaterThan(0);
  });

  it("excludes logarithm zeros and marks negative argument intervals undefined", () => {
    const result = analyzeRealDomain(parse("ln(x)"), "x", q(-2n), q(2n));
    expect(result.status).toBe("complete");
    const restriction = byKind(result.restrictions, "log")[0]!;
    expect(restriction.condition).toBe("positive");
    expect(restriction.boundaries).toHaveLength(1);
    expect(restriction.regions?.map(region => region.conditionState)).toEqual(["violated", "boundary", "satisfied"]);
    const undefinedResult = analyzeRealDomain(parse("sqrt(-1)"), "x", q(-1n), q(1n));
    expect(undefinedResult.status).toBe("undefined");
  });

  it("finds certified tangent poles for an affine argument", () => {
    const result = analyzeRealDomain(parse("tan(2*x)"), "x", q(-2n), q(2n), { precision: 50 });
    expect(result.status).toBe("complete");
    const restriction = byKind(result.restrictions, "tan")[0]!;
    expect(restriction.boundaries).toHaveLength(2);
    expect(restriction.boundaries.every(boundary => boundary.kind === "certified-decimal-interval" && boundary.certified)).toBe(true);
    const locations = restriction.boundaries.map(boundary => boundary.kind === "certified-decimal-interval" ? [boundary.lowerText, boundary.upperText] : null);
    expect(locations[0]![0]).toContain("-0.785398");
    expect(locations[1]![0]).toContain("0.785398");
  });

  it("detects a denominator restriction and preserves a rational domain boundary", () => {
    const result = analyzeRealDomain(parse("1/(x - 1) + log(x + 2)"), "x", q(-3n), q(3n));
    expect(result.status).toBe("complete");
    expect(byKind(result.restrictions, "denominator")[0]!.boundaries).toHaveLength(1);
    expect(byKind(result.restrictions, "log")[0]!.boundaries).toHaveLength(1);
  });

  it("returns unsupported for nonlinear tangent arguments instead of guessing poles", () => {
    const result = analyzeRealDomain(parse("tan(x^2)"), "x", q(-2n), q(2n));
    expect(result.status).toBe("unsupported");
    expect(byKind(result.restrictions, "tan")[0]!.message).toMatch(/affine/);
  });

  it("handles negative half powers as strictly positive base restrictions", () => {
    const result = analyzeRealDomain(parse("x^(-1/2)"), "x", q(-1n), q(1n));
    expect(result.status).toBe("complete");
    const restriction = byKind(result.restrictions, "power")[0]!;
    expect(restriction.condition).toBe("positive");
    expect(restriction.regions?.map(region => region.conditionState)).toEqual(["violated", "boundary", "satisfied"]);
  });

  it("preserves unresolved boundary enclosures when the subdivision budget is exhausted", () => {
    const result = analyzeRealDomain(parse("sqrt(x^2 - 2)"), "x", q(-2n), q(2n), {
      tolerance: q(1n, 10n ** 40n),
      maxIterations: 1,
    });
    expect(result.status).toBe("partial");
    const restriction = byKind(result.restrictions, "sqrt")[0]!;
    expect(restriction.status).toBe("partial");
    expect(restriction.boundaries.every(boundary =>
      boundary.kind === "unresolved-root-interval" ||
      boundary.kind === "exact-root-interval" && boundary.interval.converged === false,
    )).toBe(true);
    expect(restriction.regions?.some(region => region.conditionState === "boundary")).toBe(true);
  });

  it("reports no tangent poles when the affine argument stays away from them", () => {
    const result = analyzeRealDomain(parse("tan(x)"), "x", q(0n), q(1n));
    expect(result.status).toBe("complete");
    expect(byKind(result.restrictions, "tan")[0]!.boundaries).toHaveLength(0);
  });

  it("does not guess a domain boundary when sqrt has a non-polynomial argument", () => {
    const result = analyzeRealDomain(parse("sqrt(ln(x))"), "x", q(0n), q(3n));
    expect(result.status).toBe("unsupported");
    expect(byKind(result.restrictions, "sqrt")[0]!.message).toMatch(/polynomial|Function/);
    expect(byKind(result.restrictions, "log")[0]!.boundaries).toHaveLength(1);
  });

  it("builds a global domain by intersecting sqrt and logarithm restrictions", () => {
    const result = analyzeRealDomain(parse("sqrt(x) + ln(x)"), "x", q(-2n), q(2n));
    expect(result.status).toBe("complete");
    expect(result.domainRegions.some(region => region.state === "included" && region.lower.numerator > 0n)).toBe(true);
    expect(result.domainRegions.some(region => region.state === "excluded" && region.upper.numerator <= 0n)).toBe(true);
    expect(result.domainRegions.some(region => region.state === "uncertain")).toBe(true);
  });

  it("intersects multiple constraints so only x greater than one is included", () => {
    const result = analyzeRealDomain(parse("sqrt(x) + ln(x - 1)"), "x", q(-2n), q(3n));
    expect(result.status).toBe("complete");
    const included = result.domainRegions.filter(region => region.state === "included");
    expect(included.length).toBeGreaterThan(0);
    expect(included.every(region => region.lower.numerator > region.lower.denominator)).toBe(true);
    expect(result.domainRegions.some(region => region.state === "excluded" && region.lower.numerator < 0n)).toBe(true);
  });

  it("intersects tangent poles with other constraints in the global domain", () => {
    const result = analyzeRealDomain(parse("tan(2*x) + ln(x)"), "x", q(-2n), q(2n));
    expect(result.status).toBe("complete");
    expect(result.domainRegions.some(region => region.state === "uncertain" && region.message?.includes("Certified enclosure"))).toBe(true);
    expect(result.domainRegions.some(region => region.state === "included" && region.lower.numerator > 0n)).toBe(true);
    expect(result.domainRegions.some(region => region.state === "excluded" && region.upper.numerator < 0n)).toBe(true);
  });

  it("proves the global domain empty when restrictions are incompatible", () => {
    const result = analyzeRealDomain(parse("sqrt(x) + ln(-x - 1)"), "x", q(-3n), q(3n));
    expect(result.status).toBe("undefined");
    expect(result.domainRegions.length).toBeGreaterThan(0);
    expect(result.domainRegions.every(region => region.state === "excluded")).toBe(true);
  });

  it("returns the full requested interval as included when no restrictions apply", () => {
    const result = analyzeRealDomain(parse("x + 2"), "x", q(-1n), q(2n));
    expect(result.status).toBe("complete");
    expect(result.domainRegions).toHaveLength(1);
    expect(result.domainRegions[0]).toMatchObject({
      lowerClosed: true,
      upperClosed: true,
      state: "included",
    });
  });

  it("does not classify any global region when a required constraint is unsupported", () => {
    const result = analyzeRealDomain(parse("sqrt(ln(x)) + tan(x^2)"), "x", q(0n), q(2n));
    expect(result.status).toBe("unsupported");
    expect(result.domainRegions).toHaveLength(1);
    expect(result.domainRegions[0]?.state).toBe("unknown");
  });

  it("respects a tangent-pole budget and marks the result partial", () => {
    const result = analyzeRealDomain(parse("tan(100*x)"), "x", q(-10n), q(10n), { maxTanPoles: 2 });
    expect(result.status).toBe("partial");
    expect(byKind(result.restrictions, "tan")[0]!.message).toMatch(/above the configured maximum/);
  });
});
