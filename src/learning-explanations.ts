import type { DifferentiationResult, DifferentiationRule } from "./calculus/differentiate.js";
import type { FactorizationExplanation, FactorizationStepRule } from "./algebra/factor.js";
import type { IntegrationExplanation, IntegrationRule } from "./calculus/integrate.js";
import type { EquationSolveExplanation, EquationSolveRule } from "./algebra/solve.js";
import { toString } from "./core/printer.js";

type LearningRule =
  | DifferentiationRule
  | FactorizationStepRule
  | IntegrationRule
  | EquationSolveRule;
type SharedLearningRule = Exclude<LearningRule, "sum-rule" | "power-rule">;

type ExplanationTrace =
  | DifferentiationResult
  | FactorizationExplanation
  | IntegrationExplanation
  | EquationSolveExplanation;

export interface LearningStep {
  readonly sequence: number;
  readonly id?: number;
  readonly parentId?: number | null;
  readonly rule: LearningRule;
  readonly title: string;
  readonly why: string;
  readonly conditions: readonly string[];
  readonly expression?: string;
  readonly input?: string;
  readonly output?: string;
  readonly details?: readonly string[];
}

export interface LearningExplanation {
  readonly operation: "differentiate" | "factor" | "integrate" | "solve";
  readonly problem: string;
  readonly variable?: string;
  readonly result: string;
  readonly steps: readonly LearningStep[];
}

interface RuleDescription {
  readonly title: string;
  readonly why: string;
  readonly conditions: readonly string[];
}

const ruleDescriptions: Record<SharedLearningRule, RuleDescription> = {
  constant: {
    title: "Differentiate a numeric constant",
    why: "A constant does not change as the differentiation variable changes.",
    conditions: ["The expression is independent of the differentiation variable."],
  },
  variable: {
    title: "Differentiate the selected variable",
    why: "The derivative of the selected variable with respect to itself is one.",
    conditions: ["The symbol is the variable being differentiated."],
  },
  "constant-symbol": {
    title: "Differentiate another symbol",
    why: "A symbol other than the selected variable is treated as constant.",
    conditions: ["The symbol is independent of the differentiation variable."],
  },
  "product-rule": {
    title: "Apply the product rule",
    why: "Differentiate one factor at a time, sum those products, and leave the other factors unchanged.",
    conditions: ["Each factor is differentiable at the point or on the interval considered."],
  },
  "logarithmic-power-rule": {
    title: "Differentiate a variable power",
    why: "Rewrite u(x)^v(x) as exp(v(x)*log(u(x))) and apply the chain and product rules.",
    conditions: [
      "The base u(x) is positive, and both base and exponent are differentiable.",
    ],
  },
  "chain-rule-sin": {
    title: "Apply the chain rule to sine",
    why: "The derivative of sin(u) is cos(u)*u'.",
    conditions: ["The inner function is differentiable."],
  },
  "chain-rule-cos": {
    title: "Apply the chain rule to cosine",
    why: "The derivative of cos(u) is -sin(u)*u'.",
    conditions: ["The inner function is differentiable."],
  },
  "chain-rule-tan": {
    title: "Apply the chain rule to tangent",
    why: "The derivative of tan(u) is u'/cos(u)^2.",
    conditions: ["The inner function is differentiable and cos(u) is nonzero."],
  },
  "chain-rule-atan": {
    title: "Apply the chain rule to arctangent",
    why: "The derivative of atan(u) is u'/(1+u^2).",
    conditions: ["The inner function is differentiable."],
  },
  "chain-rule-exp": {
    title: "Apply the chain rule to the exponential",
    why: "The derivative of exp(u) is exp(u)*u'.",
    conditions: ["The inner function is differentiable."],
  },
  "chain-rule-log": {
    title: "Apply the chain rule to the logarithm",
    why: "The derivative of log(u) is u'/u.",
    conditions: ["The inner function is differentiable and u is positive."],
  },
  "chain-rule-log-abs": {
    title: "Differentiate log of an absolute value",
    why: "On either side of zero, the derivative of log(|u|) is u'/u.",
    conditions: ["The inner function is differentiable and u is nonzero."],
  },
  "chain-rule-sqrt": {
    title: "Apply the chain rule to the square root",
    why: "For positive u, the derivative of sqrt(u) is u'/(2*sqrt(u)).",
    conditions: ["The inner function is differentiable and u is positive."],
  },
  "chain-rule-cbrt": {
    title: "Apply the chain rule to the cube root",
    why: "Away from zero, the derivative of cbrt(u) is u'/(3*cbrt(u)^2).",
    conditions: ["The inner function is differentiable and u is nonzero."],
  },
  "chain-rule-abs": {
    title: "Differentiate an absolute value",
    why: "Where u is nonzero, the derivative of |u| is sign(u)*u'.",
    conditions: ["The inner function is differentiable and u is nonzero."],
  },
  "integrate-independent-expression": {
    title: "Integrate an expression independent of x",
    why: "A factor that does not depend on x is constant with respect to x, so its primitive is that factor times x.",
    conditions: ["The integrand is independent of the integration variable."],
  },
  "integrate-polynomial": {
    title: "Integrate a polynomial term by term",
    why: "For each term c*x^n, increase the exponent by one and divide by the new exponent.",
    conditions: ["The integrand is a polynomial with exact rational coefficients."],
  },
  "u-substitution": {
    title: "Use substitution",
    why: "A factor matches the derivative of an inner expression, reducing the integral to a supported outer primitive.",
    conditions: [
      "The inner-derivative relationship is exact.",
      "The resulting outer integral has a supported primitive.",
    ],
  },
  "rational-partial-fractions": {
    title: "Integrate by partial fractions",
    why: "Polynomial division and partial fractions reduce the rational function to supported simpler terms.",
    conditions: [
      "The denominator factors into rational linear factors over the rationals.",
      "The identity is interpreted on intervals where the original denominator is nonzero.",
    ],
  },
  "integration-by-parts": {
    title: "Use integration by parts",
    why: "Choose factors u and dv so that the integral becomes u*v minus a simpler supported integral.",
    conditions: [
      "The selected factors admit the required derivatives and primitive.",
      "The remaining integral is supported by the integrator.",
    ],
  },
  "constant-multiple": {
    title: "Factor out a constant",
    why: "A factor independent of x can be taken outside the integral.",
    conditions: ["The extracted factor is independent of the integration variable."],
  },
  "elementary-chain-rule": {
    title: "Integrate an elementary function of an affine expression",
    why: "Use a known elementary primitive and divide by the inner expression's slope.",
    conditions: [
      "The argument is affine in the integration variable with nonzero slope.",
      "The primitive is interpreted on an interval where the real expressions are defined.",
    ],
  },
  "convert-to-polynomial": {
    title: "Convert the expression to polynomial form",
    why: "A canonical polynomial representation makes exact factorization algorithms applicable.",
    conditions: ["The expression is a polynomial with exact rational coefficients."],
  },
  "factor-univariate-over-rationals": {
    title: "Factor a univariate polynomial over the rationals",
    why: "The algorithm searches for rational roots and repeated factors; irreducible factors may remain.",
    conditions: ["The polynomial has at most one variable and exact rational coefficients."],
  },
  "factor-multivariate-patterns": {
    title: "Look for supported multivariate patterns",
    why: "The factorizer checks exact identities such as common monomials, difference of squares, perfect squares, and grouping.",
    conditions: [
      "The input is a multivariate polynomial with exact rational coefficients.",
      "Only patterns recognized by the current factorizer are split.",
    ],
  },
  "reconstruct-factorization": {
    title: "Reconstruct the factorization",
    why: "Multiply the scalar content and listed factors, respecting each factor's multiplicity.",
    conditions: ["The product of the listed factors must equal the input polynomial exactly."],
  },
  "normalize-to-zero": {
    title: "Write the equation as an expression equal to zero",
    why: "The solver interprets the input expression as the left side of an equation whose right side is zero.",
    conditions: ["The equation can be represented by its left side minus its right side."],
  },
  "classify-polynomial-degree": {
    title: "Classify the polynomial degree",
    why: "The degree determines which exact solving rule can be applied.",
    conditions: ["The expression is a univariate polynomial with exact rational coefficients."],
  },
  "constant-equation": {
    title: "Resolve a constant equation",
    why: "A nonzero constant has no roots; the zero polynomial is satisfied by every value.",
    conditions: ["The polynomial has degree zero or is identically zero."],
  },
  "linear-formula": {
    title: "Solve the linear equation",
    why: "For a*x+b=0, isolate x to obtain x=-b/a.",
    conditions: ["The equation has degree one and a is nonzero."],
  },
  "quadratic-discriminant": {
    title: "Compute the discriminant",
    why: "The value Δ=b^2-4ac determines the number and form of quadratic roots.",
    conditions: ["The equation is quadratic and a is nonzero."],
  },
  "quadratic-formula": {
    title: "Apply the quadratic formula",
    why: "Substitute a, b, and c into x=(-b±sqrt(Δ))/(2a).",
    conditions: [
      "The equation is quadratic and a is nonzero.",
      "For real roots, the discriminant must be nonnegative; negative discriminants produce complex-valued expressions.",
    ],
  },
  "factor-over-rationals": {
    title: "Factor over the rationals",
    why: "Rational factors can reduce a higher-degree equation to linear or quadratic subproblems.",
    conditions: [
      "The expression is a univariate polynomial with exact rational coefficients.",
      "Factors of degree greater than two may remain unresolved.",
    ],
  },
  "report-solver-status": {
    title: "Report the solver status",
    why: "The status distinguishes a complete answer from partial or unsupported work.",
    conditions: ["Only roots found by supported exact rules are listed as solved."],
  },
  "unsupported-input": {
    title: "Stop at an unsupported input",
    why: "The current exact solver cannot apply its polynomial rules to this input.",
    conditions: ["Use a univariate polynomial with exact rational coefficients for these solving rules."],
  },
  "trigonometric-periodicity": {
    title: "Use trigonometric periodicity",
    why: "The supported sine and cosine values repeat periodically.",
    conditions: ["The parameter is an integer and the equation is solved over the reals."],
  },
  "principal-power-inversion": {
    title: "Invert the principal power",
    why: "Raise the positive target to the reciprocal exponent.",
    conditions: ["The exponent is positive and less than two; the target is positive."],
  },
};

const overlappingRuleDescriptions: Record<
  "differentiate" | "integrate",
  Record<"sum-rule" | "power-rule", RuleDescription>
> = {
  differentiate: {
    "sum-rule": {
      title: "Apply the sum rule",
      why: "The derivative of a sum is the sum of the derivatives of its terms.",
      conditions: ["Every term is differentiable at the point or on the interval considered."],
    },
    "power-rule": {
      title: "Apply the power rule",
      why: "For u(x)^n with constant n, the derivative is n*u(x)^(n-1)*u'(x).",
      conditions: [
        "The exponent is constant and the inner function is differentiable.",
        "The power and resulting derivative must be defined over the real domain at the point considered.",
      ],
    },
  },
  integrate: {
    "sum-rule": {
      title: "Integrate each term",
      why: "The primitive of a sum is the sum of the primitives.",
      conditions: ["Each term has a supported primitive."],
    },
    "power-rule": {
      title: "Use the affine power rule",
      why: "Integrate the power of an affine expression and divide by its slope.",
      conditions: [
        "The base is affine in the integration variable with nonzero slope.",
        "For exponent -1, the logarithmic primitive is valid only where the base is nonzero.",
      ],
    },
  },
};

function step(
  operation: LearningExplanation["operation"],
  sequence: number,
  rule: LearningRule,
  fields: Omit<LearningStep, "sequence" | "rule" | "title" | "why" | "conditions">,
): LearningStep {
  const description = rule === "sum-rule" || rule === "power-rule"
    ? overlappingRuleDescriptions[operation === "integrate" ? "integrate" : "differentiate"][rule]
    : ruleDescriptions[rule];
  return {
    sequence,
    rule,
    ...description,
    ...fields,
  };
}

function joined(values: readonly string[] | undefined): string | undefined {
  return values?.length ? values.join(", ") : undefined;
}

/** Convert an existing algorithm trace into readable, teachable steps. */
export function toLearningExplanation(
  explanation: ExplanationTrace,
  options: { readonly variable?: string } = {},
): LearningExplanation {
  if ("derivative" in explanation) {
    if (!options.variable) {
      throw new TypeError("A differentiation variable is required to explain this trace.");
    }
    return {
      operation: "differentiate",
      problem: explanation.steps.length
        ? toString(explanation.steps.at(-1)!.expression)
        : toString(explanation.derivative),
      variable: options.variable,
      result: toString(explanation.derivative),
      steps: explanation.steps.map((item, sequence) => step("differentiate", sequence, item.rule, {
        id: item.id,
        parentId: item.parentId,
        input: toString(item.expression),
        output: toString(item.derivative),
        details: [`Differentiate with respect to ${options.variable}.`],
      })),
    };
  }
  if ("factorization" in explanation) {
    const problem = explanation.steps[0] ? toString(explanation.steps[0].input) : toString(explanation.expression);
    return {
      operation: "factor",
      problem,
      result: toString(explanation.expression),
      steps: explanation.steps.map((item, sequence) => step("factor", sequence, item.rule, {
        input: toString(item.input),
        output: toString(item.output),
        ...(item.factors === undefined
          ? {}
          : {
              details: [
                `Content: ${toString(item.content!)}`,
                ...item.factors.map(factor =>
                  `${toString(factor.expression)}${factor.multiplicity > 1 ? ` (multiplicity ${factor.multiplicity})` : ""}`),
              ],
            }),
      })),
    };
  }
  if ("antiderivative" in explanation) {
    const root = explanation.steps.find(item => item.parentId === null);
    const problem = root ? toString(root.input) : toString(explanation.antiderivative);
    return {
      operation: "integrate",
      problem,
      variable: explanation.variable,
      result: `${toString(explanation.antiderivative)} + C`,
      steps: explanation.steps.map((item, sequence) => step("integrate", sequence, item.rule, {
        id: item.id,
        parentId: item.parentId,
        input: toString(item.input),
        output: toString(item.result),
        details: [`Integrate with respect to ${explanation.variable}.`],
      })),
    };
  }
  const problem = explanation.steps[0]?.expression
    ? toString(explanation.steps[0].expression)
    : explanation.steps[0]?.message ?? explanation.result.status;
  return {
    operation: "solve",
    problem,
    variable: explanation.result.variable,
    result: `${explanation.result.status}: ${
      explanation.result.status === "all"
        ? `all values of ${explanation.result.variable}`
        : explanation.result.solutions.length
        ? `${explanation.result.variable} = ${joined(explanation.result.solutions.map(toString))}${
            explanation.result.parameter ? `, ${explanation.result.parameter.name} is an integer` : ""
          }`
        : "no explicit solutions"
    }`,
    steps: explanation.steps.map((item, sequence) => step("solve", sequence, item.rule, {
      ...(item.expression === undefined ? {} : { expression: toString(item.expression) }),
      ...(item.solutions?.length
        ? { output: item.solutions.map(toString).join(", ") }
        : {}),
      details: [
        ...(item.degree === undefined ? [] : [`Degree: ${item.degree}.`]),
        ...(item.coefficients === undefined
          ? []
          : item.coefficients.map((coefficient, index) => {
              const label = item.rule === "linear-formula"
                ? ["b", "c"][index]
                : ["a", "b", "c"][index];
              return `${label ?? `Coefficient ${index + 1}`} = ${toString(coefficient)}.`;
            })),
        ...(item.rule === "quadratic-discriminant" && item.expression
          ? [`Discriminant: ${toString(item.expression)}.`]
          : []),
        ...(item.factors === undefined
          ? []
          : item.factors.map(factor =>
              `${toString(factor.expression)}${factor.multiplicity > 1 ? ` (multiplicity ${factor.multiplicity})` : ""}`)),
        ...(item.status === undefined ? [] : [`Status: ${item.status}.`]),
        ...(item.message === undefined ? [] : [item.message]),
      ],
    })),
  };
}
