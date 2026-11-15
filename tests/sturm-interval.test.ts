import { describe, expect, it } from "vitest";
import {
  exactRational,
  isolateRealRootsExactInInterval,
} from "../src/numeric/sturm.js";

describe("exact bounded Sturm isolation", () => {
  it("includes roots on both closed-interval endpoints", () => {
    const result = isolateRealRootsExactInInterval(
      [exactRational(2n), exactRational(-3n), exactRational(1n)],
      exactRational(1n),
      exactRational(2n),
      exactRational(1n, 1_000_000n),
    );
    expect(result.status).toBe("finite");
    expect(result.totalDistinctRealRoots).toBe(2);
    expect(result.roots).toHaveLength(2);
    expect(result.roots.map(root => [root.lower.numerator, root.upper.numerator])).toEqual([
      [1n, 1n],
      [2n, 2n],
    ]);
  });

  it("isolates an interior root when both endpoints are also roots", () => {
    // (x - 1)(x - 3/2)(x - 2) = x^3 - 9/2*x^2 + 13/2*x - 3
    const result = isolateRealRootsExactInInterval(
      [exactRational(-3n), exactRational(13n, 2n), exactRational(-9n, 2n), exactRational(1n)],
      exactRational(1n),
      exactRational(2n),
      exactRational(1n, 1_000_000n),
    );
    expect(result.status).toBe("finite");
    expect(result.totalDistinctRealRoots).toBe(3);
    expect(result.roots).toHaveLength(3);
    expect(result.roots[0]!.lower).toEqual(exactRational(1n));
    expect(result.roots[0]!.upper).toEqual(exactRational(1n));
    expect(result.roots[1]!.multiplicity).toBe(1);
    expect(result.roots[1]!.converged).toBe(true);
    expect(result.roots[2]!.lower).toEqual(exactRational(2n));
    expect(result.roots[2]!.upper).toEqual(exactRational(2n));
  });

  it("retains exact multiplicity for roots inside the interval", () => {
    const result = isolateRealRootsExactInInterval(
      [exactRational(1n), exactRational(-2n), exactRational(1n)],
      exactRational(0n),
      exactRational(2n),
      exactRational(1n, 1_000_000n),
    );
    expect(result.status).toBe("finite");
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]!.multiplicity).toBe(2);
  });

  it("proves an interval contains no real roots", () => {
    const result = isolateRealRootsExactInInterval(
      [exactRational(-2n), exactRational(0n), exactRational(1n)],
      exactRational(-1n),
      exactRational(1n),
      exactRational(1n, 1_000_000n),
    );
    expect(result.status).toBe("none");
    expect(result.totalDistinctRealRoots).toBe(0);
  });
});
