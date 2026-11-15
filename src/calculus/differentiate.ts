import type { Expr } from "../core/expr.js";
import { add, fn, integer, isNumeric, mul, pow, structuralKey, symbol } from "../core/expr.js";
import { simplify } from "../algebra/simplify.js";

export type DifferentiationRule =
  | "constant"
  | "variable"
  | "constant-symbol"
  | "sum-rule"
  | "product-rule"
  | "power-rule"
  | "logarithmic-power-rule"
  | "chain-rule-sin"
  | "chain-rule-cos"
  | "chain-rule-tan"
  | "chain-rule-atan"
  | "chain-rule-exp"
  | "chain-rule-log"
  | "chain-rule-log-abs"
  | "chain-rule-sqrt"
  | "chain-rule-cbrt"
  | "chain-rule-abs";

export interface DifferentiationStep {
  readonly id: number;
  readonly parentId: number | null;
  readonly rule: DifferentiationRule;
  readonly expression: Expr;
  readonly derivative: Expr;
}

export interface DifferentiationResult {
  readonly derivative: Expr;
  /** Post-order rule applications; parentId links each step to its containing rule. */
  readonly steps: readonly DifferentiationStep[];
}

export interface DifferentiationVerificationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

interface DifferentiationTrace {
  nextId: number;
  steps: DifferentiationStep[];
}

export function differentiate(expr: Expr, variable: string): Expr {
  return differentiateNode(expr, variable);
}

/**
 * Differentiate an expression and return a language-neutral rule trace.
 * The trace is optional data for clients to render or localize; it is not a proof
 * of the expression's domain or of identities outside the implemented rules.
 */
export function differentiateWithSteps(expr: Expr, variable: string): DifferentiationResult {
  const trace: DifferentiationTrace = { nextId: 0, steps: [] };
  const derivative = differentiateNode(expr, variable, trace);
  return { derivative, steps: trace.steps };
}

/** Replay and independently recalculate every derivative claim in a trace. */
export function verifyDifferentiationExplanation(
  expression: Expr,
  variable: string,
  explanation: DifferentiationResult,
): DifferentiationVerificationResult {
  try {
    const expected = differentiateWithSteps(expression, variable);
    if (structuralKey(expected.derivative) !== structuralKey(explanation.derivative) ||
        expected.steps.length !== explanation.steps.length) {
      return { valid: false, errors: ["Differentiation result does not match a replay of the expression."] };
    }

    for (let index = 0; index < expected.steps.length; index++) {
      const step = explanation.steps[index]!;
      const replayed = expected.steps[index]!;
      if (step.id !== replayed.id || step.parentId !== replayed.parentId ||
          step.rule !== replayed.rule ||
          structuralKey(step.expression) !== structuralKey(replayed.expression) ||
          structuralKey(step.derivative) !== structuralKey(replayed.derivative)) {
        return { valid: false, errors: [`Differentiation step ${index} does not match a replay.`] };
      }
      const recalculated = simplify(differentiate(step.expression, variable));
      if (structuralKey(recalculated) !== structuralKey(simplify(step.derivative))) {
        return { valid: false, errors: [`Differentiation step ${step.id} has an invalid derivative.`] };
      }
    }
    return { valid: true, errors: [] };
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : "Could not verify differentiation explanation."],
    };
  }
}

function differentiateNode(
  expr: Expr,
  variable: string,
  trace?: DifferentiationTrace,
  parentId: number | null = null,
): Expr {
  const stepId = trace ? trace.nextId++ : undefined;
  const d = (child: Expr) => differentiateNode(child, variable, trace, stepId ?? null);
  const finish = (rule: DifferentiationRule, derivative: Expr): Expr => {
    if (trace && stepId !== undefined) {
      trace.steps.push({ id: stepId, parentId, rule, expression: expr, derivative });
    }
    return derivative;
  };

  switch (expr.kind) {
    case "Integer":
    case "Rational":
      return finish("constant", integer(0));
    case "Symbol":
      return expr.name === variable
        ? finish("variable", integer(1))
        : finish("constant-symbol", integer(0));
    case "Add":
      return finish("sum-rule", simplify(add(...expr.terms.map(d))));
    case "Mul": {
      const terms: Expr[] = [];
      for (let i = 0; i < expr.factors.length; i++) {
        const factors = [...expr.factors];
        factors[i] = d(factors[i]!);
        terms.push(mul(...factors));
      }
      return finish("product-rule", simplify(add(...terms)));
    }
    case "Pow": {
      if (isNumeric(expr.exponent)) {
        return finish("power-rule", simplify(mul(
          expr.exponent,
          pow(expr.base, add(expr.exponent, integer(-1))),
          d(expr.base)
        )));
      }
      // General rule d(u^v) = u^v * (v' log(u) + v*u'/u).
      return finish("logarithmic-power-rule", simplify(mul(
        expr,
        add(
          mul(d(expr.exponent), fn("log", expr.base)),
          mul(expr.exponent, d(expr.base), pow(expr.base, integer(-1)))
        )
      )));
    }
    case "Function": {
      if (expr.args.length !== 1) throw new Error(`Differentiation of ${expr.name} with ${expr.args.length} arguments is not implemented.`);
      const u = expr.args[0]!, du = d(u);
      switch (expr.name) {
        case "sin": return finish("chain-rule-sin", simplify(mul(fn("cos", u), du)));
        case "cos": return finish("chain-rule-cos", simplify(mul(integer(-1), fn("sin", u), du)));
        case "tan": return finish("chain-rule-tan", simplify(mul(pow(fn("cos", u), integer(-2)), du)));
        case "atan": return finish("chain-rule-atan", simplify(mul(du, pow(add(integer(1), pow(u, integer(2))), integer(-1)))));
        case "exp": return finish("chain-rule-exp", simplify(mul(fn("exp", u), du)));
        case "log":
        case "ln": {
          // d(log(abs(u)))/dx = u'/u for real u != 0. Keeping this identity
          // explicit avoids an otherwise unsimplified sign(u)/abs(u) expression.
          if (u.kind === "Function" && u.name === "abs" && u.args.length === 1) {
            const inner = u.args[0]!;
            return finish("chain-rule-log-abs", simplify(mul(d(inner), pow(inner, integer(-1)))));
          }
          return finish("chain-rule-log", simplify(mul(du, pow(u, integer(-1)))));
        }
        case "sqrt": return finish("chain-rule-sqrt", simplify(mul(du, integer(1), pow(mul(integer(2), fn("sqrt", u)), integer(-1)))));
        case "cbrt": return finish("chain-rule-cbrt", simplify(mul(du, pow(mul(integer(3), pow(fn("cbrt", u), integer(2))), integer(-1)))));
        case "abs": return finish("chain-rule-abs", mul(fn("sign", u), du));
        default: throw new Error(`Differentiation rule for '${expr.name}' is not implemented.`);
      }
    }
  }
}
