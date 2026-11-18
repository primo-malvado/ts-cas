import { describe, expect, it } from "vitest";
import { highlightTutorialCode } from "./tutorial-code-highlight";

describe("tutorial code highlighting", () => {
  it("adds classes for keywords, strings, numbers, comments, and tsCas", () => {
    const highlighted = highlightTutorialCode(
      '// test\nconst expression = tsCas.parse("x^2");\nconsole.log(2);',
    );

    expect(highlighted).toContain('class="syntax-comment"');
    expect(highlighted).toContain('class="syntax-keyword"');
    expect(highlighted).toContain('class="syntax-library"');
    expect(highlighted).toContain('class="syntax-string"');
    expect(highlighted).toContain('class="syntax-number"');
  });

  it("escapes HTML without executing it", () => {
    expect(highlightTutorialCode("const tag = '<script>';"))
      .toContain("&lt;script&gt;");
  });

  it("ends highlighted output with a newline for editor alignment", () => {
    expect(highlightTutorialCode("const x = 1;").endsWith("\n")).toBe(true);
  });
});
