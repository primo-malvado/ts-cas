import { describe, expect, it } from "vitest";
import {
  createLinearSystemCertificate,
  parse,
  verifyLinearSystemCertificate,
} from "../src/index.js";

describe("verifiable exact linear-system certificates", () => {
  const variables = ["x", "y"];
  const equations = [
    { left: parse("x + y"), right: parse("3") },
    { left: parse("x - y"), right: parse("1") },
  ];

  it("certifies a unique rational solution and binds it to the input system", () => {
    const result = createLinearSystemCertificate(equations, variables);

    expect(result.status).toBe("complete");
    if (!("certificate" in result)) throw new Error("Expected a complete system certificate.");
    const saved = JSON.parse(JSON.stringify(result.certificate)) as unknown;
    expect(verifyLinearSystemCertificate(saved, equations, variables))
      .toEqual({ valid: true, errors: [] });
    expect(verifyLinearSystemCertificate(saved, [
      { left: parse("x + y"), right: parse("4") },
      equations[1]!,
    ], variables).valid).toBe(false);
  });

  it("rejects altered solutions and refuses non-unique systems", () => {
    const result = createLinearSystemCertificate(equations, variables);
    if (!("certificate" in result)) throw new Error("Expected a complete system certificate.");

    const altered = {
      ...result.certificate,
      solution: [{ numerator: "3", denominator: "1" }, { numerator: "1", denominator: "1" }],
    };
    expect(verifyLinearSystemCertificate(altered).valid).toBe(false);

    expect(createLinearSystemCertificate(
      [{ left: parse("x + y"), right: parse("3") }],
      variables,
    ).status).toBe("infinite");
  });
});
