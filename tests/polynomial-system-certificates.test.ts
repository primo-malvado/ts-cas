import { describe, expect, it } from "vitest";
import {
  createPolynomialSystemCompletenessCertificate,
  createPolynomialSystemWitnessCertificate,
  parse,
  verifyCertificate,
  verifyPolynomialSystemCompletenessCertificate,
  verifyPolynomialSystemWitnessCertificate,
} from "../src/index.js";

describe("polynomial-system witness certificates", () => {
  const variables = ["x", "y"];
  const equations = [
    { left: parse("x + y"), right: parse("3") },
    { left: parse("x^2 + y^2"), right: parse("5") },
  ];

  it("serializes and verifies every exact point without claiming completeness", () => {
    const result = createPolynomialSystemWitnessCertificate(equations, variables);

    expect(result.status).toBe("certified-witnesses");
    if (!("certificate" in result)) throw new Error("Expected solution witnesses.");
    expect(result.certificate.witnesses).toHaveLength(2);
    const saved = JSON.parse(JSON.stringify(result.certificate)) as unknown;
    expect(verifyPolynomialSystemWitnessCertificate(saved, equations, variables))
      .toEqual({ valid: true, errors: [] });
  });

  it("proves completeness for linear-plus-quadratic systems and rejects missing points", () => {
    const result = createPolynomialSystemCompletenessCertificate(equations, variables);

    expect(result.status).toBe("complete");
    if (!("certificate" in result)) throw new Error("Expected a complete system certificate.");
    const saved = JSON.parse(JSON.stringify(result.certificate)) as unknown;
    expect(verifyPolynomialSystemCompletenessCertificate(saved, equations, variables))
      .toEqual({ valid: true, errors: [] });
    expect(verifyCertificate("polynomial-system-complete", saved, {
      expectedPolynomialEquations: equations,
      expectedVariables: variables,
    }).valid).toBe(true);

    const certificate = result.certificate;
    const altered = {
      ...certificate,
      witnessCertificate: {
        ...certificate.witnessCertificate!,
        witnesses: certificate.witnessCertificate!.witnesses.slice(0, 1),
      },
    };
    expect(verifyPolynomialSystemCompletenessCertificate(altered, equations, variables).valid).toBe(false);
  });

  it("certifies an empty real solution set from a complete reduced-root count", () => {
    const noRealSolutions = [
      { left: parse("x + y"), right: parse("0") },
      { left: parse("x^2 + y^2"), right: parse("-1") },
    ];
    const result = createPolynomialSystemCompletenessCertificate(noRealSolutions, variables);

    expect(result.status).toBe("complete");
    if (!("certificate" in result)) throw new Error("Expected an empty-set completeness certificate.");
    expect(verifyPolynomialSystemCompletenessCertificate(
      JSON.parse(JSON.stringify(result.certificate)) as unknown,
      noRealSolutions,
      variables,
    )).toEqual({ valid: true, errors: [] });
  });

  it("proves completeness for linear systems and classifies degenerate families", () => {
    const linearSystem = [
      { left: parse("x + y"), right: parse("3") },
      { left: parse("x - y"), right: parse("1") },
    ];
    const unique = createPolynomialSystemCompletenessCertificate(linearSystem, variables);

    expect(unique.status).toBe("complete");
    if (!("certificate" in unique)) throw new Error("Expected a complete linear-system certificate.");
    expect(verifyPolynomialSystemCompletenessCertificate(
      JSON.parse(JSON.stringify(unique.certificate)) as unknown,
      linearSystem,
      variables,
    ).valid).toBe(true);

    const inconsistent = [
      { left: parse("x + y"), right: parse("3") },
      { left: parse("x + y"), right: parse("4") },
    ];
    const empty = createPolynomialSystemCompletenessCertificate(inconsistent, variables);
    expect(empty.status).toBe("complete");
    if (!("certificate" in empty)) throw new Error("Expected a certificate for the empty set.");
    expect(verifyPolynomialSystemCompletenessCertificate(
      empty.certificate,
      inconsistent,
      variables,
    ).valid).toBe(true);

    const dependent = [
      { left: parse("x + y"), right: parse("3") },
      { left: parse("2*x + 2*y"), right: parse("6") },
    ];
    expect(createPolynomialSystemCompletenessCertificate(dependent, variables).status)
      .toBe("infinite");

    const contradictoryConstant = [
      { left: parse("1"), right: parse("0") },
      { left: parse("x^2 + y^2"), right: parse("0") },
    ];
    const contradiction = createPolynomialSystemCompletenessCertificate(contradictoryConstant, variables);
    expect(contradiction.status).toBe("complete");
    if (!("certificate" in contradiction)) throw new Error("Expected an empty-set certificate.");
    expect(verifyPolynomialSystemCompletenessCertificate(
      contradiction.certificate,
      contradictoryConstant,
      variables,
    ).valid).toBe(true);

    const unconstrained = [
      { left: parse("0"), right: parse("0") },
      { left: parse("0"), right: parse("0") },
    ];
    expect(createPolynomialSystemCompletenessCertificate(unconstrained, variables).status)
      .toBe("infinite");
  });

  it("proves completeness for exact irrational real witnesses", () => {
    const irrationalSystem = [
      { left: parse("x + y"), right: parse("0") },
      { left: parse("x^2 + y^2"), right: parse("1") },
    ];
    const result = createPolynomialSystemCompletenessCertificate(irrationalSystem, variables);

    expect(result.status).toBe("complete");
    if (!("certificate" in result)) throw new Error("Expected an irrational completeness certificate.");
    expect(verifyPolynomialSystemCompletenessCertificate(
      JSON.parse(JSON.stringify(result.certificate)) as unknown,
      irrationalSystem,
      variables,
    ).valid).toBe(true);
  });

  it("rejects altered solution points and certificates bound to other equations", () => {
    const result = createPolynomialSystemWitnessCertificate(equations, variables);
    if (!("certificate" in result)) throw new Error("Expected solution witnesses.");

    const altered = {
      ...result.certificate,
      witnesses: [[
        { kind: "Integer", value: "0" },
        { kind: "Integer", value: "0" },
      ]],
    };
    expect(verifyPolynomialSystemWitnessCertificate(altered).valid).toBe(false);
    expect(verifyPolynomialSystemWitnessCertificate(
      result.certificate,
      [
        equations[0]!,
        { left: parse("x^2 + y^2"), right: parse("6") },
      ],
      variables,
    ).valid).toBe(false);
  });

  it("verifies exact radical witnesses after polynomial expansion", () => {
    const equations = [
      { left: parse("x + y"), right: parse("0") },
      { left: parse("x^2 + y^2"), right: parse("1") },
    ];
    const result = createPolynomialSystemWitnessCertificate(equations, variables);

    expect(result.status).toBe("certified-witnesses");
    if (!("certificate" in result)) throw new Error("Expected radical solution witnesses.");
    expect(verifyPolynomialSystemWitnessCertificate(result.certificate, equations, variables).valid)
      .toBe(true);
  });

  it("verifies a deterministic family of generated rational solution sets", () => {
    for (const [x, y] of [[-2, 1], [-1, -1], [0, 3], [2, 2], [4, -3]] as const) {
      const equations = [
        { left: parse("x + y"), right: parse(String(x + y)) },
        { left: parse("x^2 + y^2"), right: parse(String(x * x + y * y)) },
      ];
      const result = createPolynomialSystemWitnessCertificate(equations, variables);

      expect(result.status).toBe("certified-witnesses");
      if (!("certificate" in result)) throw new Error("Expected generated solution witnesses.");
      const saved = JSON.parse(JSON.stringify(result.certificate)) as unknown;
      expect(verifyPolynomialSystemWitnessCertificate(saved, equations, variables).valid).toBe(true);
    }
  });
});
