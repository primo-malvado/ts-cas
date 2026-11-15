import { describe, expect, it } from "vitest";
import * as tsCas from "ts-cas";
import * as typescript from "typescript";
import { transpileTutorialCode } from "./tutorial-code-transpiler";
import {
  TUTORIAL_CHAPTERS,
  TUTORIAL_MENU,
  toggleTutorialMenuGroup,
  type TutorialMenuGroupTitle,
} from "./tutorial-content";

type CellConsole = {
  log: (...values: unknown[]) => void;
  info: (...values: unknown[]) => void;
  warn: (...values: unknown[]) => void;
  error: (...values: unknown[]) => void;
};

describe("interactive tutorial code", () => {
  it("places every runnable example under a two-level menu group", () => {
    const menuItemIds = TUTORIAL_MENU.flatMap((group) =>
      group.items.map((item) => item.id),
    );
    const exampleIds = TUTORIAL_CHAPTERS.flatMap((chapter) =>
      chapter.examples.map((example) => `example-${example.id}`),
    );

    expect(new Set(menuItemIds).size).toBe(exampleIds.length);
    expect([...menuItemIds].sort()).toEqual([...exampleIds].sort());
    expect(TUTORIAL_MENU.every((group) => group.items.length > 0)).toBe(true);
    for (const group of TUTORIAL_MENU) {
      expect(group.sectionId).toBe(
        TUTORIAL_CHAPTERS.find((chapter) => chapter.menuGroup === group.title)?.id,
      );
    }
  });

  it("starts with all menu groups closed and opens only one at a time", () => {
    let openGroup: TutorialMenuGroupTitle | null = null;

    expect(openGroup).toBeNull();
    openGroup = toggleTutorialMenuGroup(openGroup, "Basic operations");
    expect(openGroup).toBe("Basic operations");
    openGroup = toggleTutorialMenuGroup(openGroup, "Calculus");
    expect(openGroup).toBe("Calculus");
    openGroup = toggleTutorialMenuGroup(openGroup, "Calculus");
    expect(openGroup).toBeNull();
  });

  it("transpiles and executes every documented example against the real library", async () => {
    const examples = TUTORIAL_CHAPTERS.flatMap((chapter) => chapter.examples);

    for (const example of examples) {
      const source = await transpileTutorialCode(example.code, typescript);
      const output: unknown[][] = [];
      const cellConsole: CellConsole = {
        log: (...values) => output.push(values),
        info: (...values) => output.push(values),
        warn: (...values) => output.push(values),
        error: (...values) => output.push(values),
      };
      const run = new Function(
        "tsCas",
        "console",
        `"use strict"; return (async () => {\n${source}\n})();`,
      ) as (api: typeof tsCas, cellConsole: CellConsole) => Promise<unknown>;

      await expect(run(tsCas, cellConsole), example.title).resolves.toBeUndefined();
      expect(output.length, example.title).toBeGreaterThan(0);
      if (example.id === "simplify-like-terms") {
        expect(output).toContainEqual(["(4)^(1/2) <=> 2"]);
      }
      if (example.id === "solve-trig-roots") {
        expect(output).toContainEqual(["(2*k + 1/2)*pi"]);
        expect(output).toContainEqual(["k is an integer"]);
      }
      if (example.id === "verified-factorization") {
        const verification = output.flat().find(
          (value): value is { readonly valid: boolean } =>
            typeof value === "object"
            && value !== null
            && "valid" in value
            && typeof value.valid === "boolean",
        );
        expect(verification?.valid).toBe(true);
      }
      if (example.id === "domain-aware-substitution") {
        expect(output[0]?.[1]).toBe("undefined");
        expect(output[1]?.[1]).toBe("complete");
      }
      if (example.id === "antiderivative-certificate") {
        const verification = output.flat().find(
          (value): value is { readonly valid: boolean } =>
            typeof value === "object"
            && value !== null
            && "valid" in value
            && typeof value.valid === "boolean",
        );
        expect(verification?.valid).toBe(true);
      }
      if (
        example.id === "polynomial-root-certificate"
        || example.id === "polynomial-inequality-certificate"
      ) {
        expect(output.flat()).toContain(true);
      }
    }
  });

  it("strips TypeScript annotations before browser execution", async () => {
    const source = await transpileTutorialCode(
      'const expression: string = "x + x"; console.log(expression);',
      typescript,
    );

    expect(source).not.toContain(": string");
    expect(source).toContain("console.log(expression)");
  });

  it("executes the quartic solve example with the published library", async () => {
    const example = TUTORIAL_CHAPTERS.flatMap(chapter => chapter.examples)
      .find(item => item.id === "quartic-complex-roots");
    if (!example) throw new Error("Missing quartic tutorial example.");
    const source = await transpileTutorialCode(example.code, typescript);
    const output: unknown[] = [];
    const run = new Function("tsCas", "console", `"use strict"; return (async () => {\n${source}\n})();`) as
      (api: typeof tsCas, console: Pick<CellConsole, "log">) => Promise<void>;
    await run(tsCas, { log: (...values) => output.push(...values) });
    expect(output).toHaveLength(1);
    expect(output[0]).not.toBe("No solutions found");
    expect(typeof output[0]).toBe("string");
    const roots = tsCas.solve(tsCas.parse("x^4 + 10*x^2 + x + 1"), "x").solutions.map(tsCas.toString);
    expect(roots).toHaveLength(4);
    for (const root of roots) {
      expect(output[0]).toContain(root);
      const value = tsCas.evaluateComplex(tsCas.parse(root));
      const residual = tsCas.evaluateComplex(tsCas.parse("x^4 + 10*x^2 + x + 1"), { x: value });
      expect(Math.hypot(residual.re, residual.im)).toBeLessThan(1e-8);
    }
  });

  it("solves the quadratic involving pi in an editable example", async () => {
    const example = TUTORIAL_CHAPTERS.flatMap(chapter => chapter.examples)
      .find(item => item.id === "quadratic-pi-roots");
    if (!example) throw new Error("Missing quadratic pi tutorial example.");
    const source = await transpileTutorialCode(example.code, typescript);
    const output: unknown[] = [];
    const run = new Function("tsCas", "console", `"use strict"; return (async () => {\n${source}\n})();`) as
      (api: typeof tsCas, console: Pick<CellConsole, "log">) => Promise<void>;
    await run(tsCas, { log: (...values) => output.push(...values) });
    expect(output).toEqual(["sqrt(pi)\n\nsqrt(pi)*-1"]);
  });

  it("solves the irrational-power example in the tutorial runner", async () => {
    const example = TUTORIAL_CHAPTERS.flatMap(chapter => chapter.examples)
      .find(item => item.id === "irrational-power-root");
    if (!example) throw new Error("Missing irrational-power tutorial example.");
    const source = await transpileTutorialCode(example.code, typescript);
    const output: unknown[] = [];
    const run = new Function("tsCas", "console", `"use strict"; return (async () => {\n${source}\n})();`) as
      (api: typeof tsCas, console: Pick<CellConsole, "log">) => Promise<void>;
    await run(tsCas, { log: (...values) => output.push(...values) });
    expect(output).toEqual(["2^(sqrt(2)*1/2)"]);
  });

  it("solves a quadratic with a symbolic parameter in the tutorial runner", async () => {
    const source = await transpileTutorialCode(`
      const result = tsCas.solve(tsCas.parse("x^2 - y"), "x");
      console.log(result.solutions.map(tsCas.toString).join("\\n\\n") || "No solutions found");
    `, typescript);
    const output: unknown[] = [];
    const run = new Function("tsCas", "console", `"use strict"; return (async () => {\n${source}\n})();`) as
      (api: typeof tsCas, console: Pick<CellConsole, "log">) => Promise<void>;
    await run(tsCas, { log: (...values) => output.push(...values) });
    expect(output).toEqual(["sqrt(y)\n\nsqrt(y)*-1"]);
  });

  it.each([
    'import { parse } from "ts-cas";',
    'const result = import("https://example.com/code.js");',
    'console.log(globalThis.fetch("https://example.com"));',
  ])("rejects module loading and browser/network access", async (source) => {
    await expect(transpileTutorialCode(source, typescript)).rejects.toThrow();
  });
});
