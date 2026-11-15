import { isNumeric, numericParts, structuralKey, type Expr } from "./expr.js";

const precedence = (expr: Expr): number => {
  switch (expr.kind) {
    case "Add": return 1;
    case "Mul": return 2;
    case "Pow": return 3;
    default: return 4;
  }
};

export function toString(expr: Expr, parentPrecedence = 0): string {
  let text: string;
  switch (expr.kind) {
    case "Integer": text = expr.value.toString(); break;
    case "Rational": text = `${expr.numerator}/${expr.denominator}`; break;
    case "Symbol": text = expr.name; break;
    case "Add": {
      // Inside a power's parenthesized base, place positive constants after symbolic
      // terms, matching inputs such as (x + 1)^2 while preserving negative factor forms.
      const displayTerms = parentPrecedence === 3
        ? [...expr.terms].sort((a, b) => {
            // Move positive constants to the end, but preserve negative constants
            // first so canonical factor forms such as (-2 + x)^2 remain stable.
            const aPositiveConstant = isNumeric(a) && numericParts(a)[0] > 0n;
            const bPositiveConstant = isNumeric(b) && numericParts(b)[0] > 0n;
            if (aPositiveConstant !== bPositiveConstant) return aPositiveConstant ? 1 : -1;
            return structuralKey(a).localeCompare(structuralKey(b));
          })
        : expr.terms;
      text = displayTerms.map((term, i) => {
        const part = toString(term, 1);
        if (i > 0 && part.startsWith("-")) return `- ${part.slice(1)}`;
        return i > 0 ? `+ ${part}` : part;
      }).join(" ");
      break;
    }
    case "Mul": text = expr.factors.map(factor => toString(factor, 2)).join("*"); break;
    case "Pow": {
      // Rational exponents need parentheses: x^3/2 is read as (x^3)/2, not x^(3/2).
      const exponentText = expr.exponent.kind === "Rational"
        ? `(${toString(expr.exponent)})`
        : toString(expr.exponent, 3);
      const baseText = expr.base.kind === "Pow" || expr.base.kind === "Rational" ||
        expr.base.kind === "Integer" && expr.base.value < 0n
        ? `(${toString(expr.base)})`
        : toString(expr.base, 3);
      text = `${baseText}^${exponentText}`;
      break;
    }
    case "Function": text = `${expr.name}(${expr.args.map(arg => toString(arg)).join(", ")})`; break;
  }
  return precedence(expr) < parentPrecedence ? `(${text})` : text;
}
