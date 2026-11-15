import { fn, isNumeric, numericParts, structuralKey, type Expr } from "../core/expr.js";
import { simplify } from "./simplify.js";
import { simplifyRational } from "./rational.js";

export type DomainRelation = "nonzero" | "positive" | "nonnegative";
export type DomainSimplificationStatus = "complete" | "partial" | "unsupported" | "undefined";

export interface DomainCondition {
  readonly expression: Expr;
  readonly relation: DomainRelation;
}

export interface DomainSimplificationResult {
  readonly status: DomainSimplificationStatus;
  readonly expression?: Expr;
  readonly conditions: readonly DomainCondition[];
  readonly message?: string;
}

const REAL_FUNCTIONS = new Set(["sin", "cos", "tan", "atan", "exp", "log", "ln", "sqrt", "cbrt", "abs", "sign"]);

/**
 * Simplify an expression while returning the real-domain conditions required
 * for the result to agree with the input expression.
 */
export function simplifyWithDomain(expression: Expr): DomainSimplificationResult {
  const rational = simplifyRational(expression);
  const conditions = new Map<string, DomainCondition>();
  const unsupportedFunctions = new Set<string>();
  let impossibleCondition = false;

  const addCondition = (value: Expr, relation: DomainRelation): void => {
    const conditionExpression = simplify(value);
    if (isNumeric(conditionExpression)) {
      const [numerator] = numericParts(conditionExpression);
      const holds = relation === "nonzero"
        ? numerator !== 0n
        : relation === "positive"
          ? numerator > 0n
          : numerator >= 0n;
      if (!holds) impossibleCondition = true;
      return;
    }

    const key = `${relation}:${structuralKey(conditionExpression)}`;
    conditions.set(key, { expression: conditionExpression, relation });
  };

  for (const restriction of rational.restrictions) addCondition(restriction, "nonzero");

  const visit = (node: Expr): void => {
    switch (node.kind) {
      case "Integer":
      case "Rational":
      case "Symbol":
        return;
      case "Add":
        node.terms.forEach(visit);
        return;
      case "Mul":
        node.factors.forEach(visit);
        return;
      case "Pow": {
        visit(node.base);
        visit(node.exponent);
        if (!isNumeric(node.exponent)) {
          addCondition(node.base, "positive");
          return;
        }

        const [numerator, denominator] = numericParts(node.exponent);
        if (numerator === 0n || denominator === 1n) return;
        if (denominator % 2n === 0n) {
          addCondition(node.base, numerator < 0n ? "positive" : "nonnegative");
        } else if (numerator < 0n) {
          addCondition(node.base, "nonzero");
        }
        return;
      }
      case "Function": {
        node.args.forEach(visit);
        if (!REAL_FUNCTIONS.has(node.name) || node.args.length !== 1) {
          unsupportedFunctions.add(node.name);
          return;
        }

        const argument = node.args[0]!;
        switch (node.name) {
          case "sqrt": addCondition(argument, "nonnegative"); break;
          case "log":
          case "ln": addCondition(argument, "positive"); break;
          case "tan": addCondition(fn("cos", argument), "nonzero"); break;
        }
      }
    }
  };

  visit(expression);

  if (rational.status === "undefined") {
    return {
      status: "undefined",
      conditions: [...conditions.values()],
      ...(rational.message === undefined ? {} : { message: rational.message }),
    };
  }
  if (impossibleCondition && unsupportedFunctions.size === 0) {
    return {
      status: "undefined",
      conditions: [...conditions.values()],
      message: "An exact numeric domain condition is false, so the expression has no real values.",
    };
  }

  const simplifiedExpression = rational.expression
    ? simplify(rational.expression)
    : simplify(expression);
  if (unsupportedFunctions.size > 0) {
    const functions = [...unsupportedFunctions].sort().join(", ");
    return {
      status: "unsupported",
      expression: simplifiedExpression,
      conditions: [...conditions.values()],
      message: `Real-domain conditions are not known for function(s): ${functions}.`,
    };
  }
  if (rational.status === "partial") {
    return {
      status: "partial",
      expression: simplifiedExpression,
      conditions: [...conditions.values()],
      ...(rational.message === undefined ? {} : { message: rational.message }),
    };
  }

  return {
    status: "complete",
    expression: simplifiedExpression,
    conditions: [...conditions.values()],
  };
}
