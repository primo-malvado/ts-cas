import {
  isNumeric, numericParts, rational, structuralKey, type Expr,
} from "../core/expr.js";
import { expand } from "./expand.js";
import { factor } from "./factor.js";
import { substitute } from "./substitute.js";
import { integrate } from "../calculus/integrate.js";
import { differentiate } from "../calculus/differentiate.js";
import { solve, type EquationSolution } from "./solve.js";
import { simplify } from "./simplify.js";
import { simplifyRadicals } from "./radicals.js";
import { evaluate, type NumericBindings } from "../numeric/evaluate.js";
import { limit, type LimitDirection, type LimitPoint, type LimitResult } from "../calculus/limit.js";
import {
  laurentSeries, series, taylorSeries, type SeriesResult,
} from "../calculus/series.js";
import {
  analyzeContinuity,
  type ContinuityAnalysisOptions,
  type ContinuityAnalysisResult,
} from "../calculus/continuity.js";
import {
  solvePolynomialSystem,
  type PolynomialEquation,
  type PolynomialSystemResult,
} from "./system.js";
import {
  simplifyWithDomain,
  type DomainCondition,
  type DomainSimplificationResult,
  type DomainSimplificationStatus,
} from "./simplify-with-domain.js";

export type DomainExpressionTransform = (expression: Expr) => Expr;
export type DomainExpressionCombine = (expressions: readonly Expr[]) => Expr;

export interface DomainEquationSolveResult {
  readonly status: DomainSimplificationResult["status"];
  readonly equation?: EquationSolution;
  readonly conditions: readonly DomainCondition[];
  readonly solutions: readonly Expr[];
  readonly excludedSolutions: readonly Expr[];
  readonly undeterminedSolutions: readonly Expr[];
  readonly message?: string;
}

export interface DomainPolynomialEquation {
  readonly left: Expr | DomainSimplificationResult;
  readonly right: Expr | DomainSimplificationResult;
}

export interface DomainPolynomialSystemSolveResult {
  readonly status: DomainSimplificationResult["status"];
  readonly system?: PolynomialSystemResult;
  readonly conditions: readonly DomainCondition[];
  readonly solutions: readonly Readonly<Record<string, Expr>>[];
  readonly excludedSolutions: readonly Readonly<Record<string, Expr>>[];
  readonly undeterminedSolutions: readonly Readonly<Record<string, Expr>>[];
  readonly message?: string;
}

export interface DomainEvaluationResult {
  readonly status: DomainSimplificationStatus;
  readonly value?: number;
  readonly conditions: readonly DomainCondition[];
  readonly message?: string;
}

export type DomainPointStatus = "defined" | "undefined" | "unknown";

export interface DomainLimitResult {
  readonly status: DomainSimplificationStatus;
  readonly limit?: LimitResult;
  readonly conditions: readonly DomainCondition[];
  readonly pointDomain?: DomainPointStatus;
  readonly message?: string;
}

export interface DomainSeriesResult {
  readonly status: DomainSimplificationStatus;
  readonly series?: SeriesResult;
  readonly conditions: readonly DomainCondition[];
  readonly pointDomain: DomainPointStatus;
  readonly message?: string;
}

export interface DomainContinuityResult {
  readonly status: DomainSimplificationStatus;
  readonly analysis?: ContinuityAnalysisResult;
  readonly conditions: readonly DomainCondition[];
  readonly pointDomain: DomainPointStatus;
  readonly message?: string;
}

function asDomainResult(input: Expr | DomainSimplificationResult): DomainSimplificationResult {
  return "conditions" in input ? input : simplifyWithDomain(input);
}

function exactExpressionForNumber(value: number): Expr | undefined {
  if (!Number.isFinite(value)) return undefined;
  const [mantissa, exponentText] = value.toString().toLowerCase().split("e");
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  const negative = mantissa!.startsWith("-");
  const unsigned = negative ? mantissa!.slice(1) : mantissa!;
  const [whole, fraction = ""] = unsigned.split(".");
  const digits = `${whole}${fraction}`;
  let numerator = BigInt(digits) * (negative ? -1n : 1n);
  const scale = exponent - fraction.length;
  let denominator = 1n;
  if (scale >= 0) numerator *= 10n ** BigInt(scale);
  else denominator = 10n ** BigInt(-scale);
  return rational(numerator, denominator);
}

function relationHolds(condition: DomainCondition, value: Expr): boolean | null {
  const normalized = simplifyRadicals(simplify(value));
  if (!isNumeric(normalized)) return null;
  const [numerator] = numericParts(normalized);
  return condition.relation === "nonzero"
    ? numerator !== 0n
    : condition.relation === "positive"
      ? numerator > 0n
      : numerator >= 0n;
}

function numericRelationHolds(condition: DomainCondition, value: number): boolean | null {
  const tolerance = 32 * Number.EPSILON * Math.max(1, Math.abs(value));
  if (Math.abs(value) <= tolerance) return null;
  return condition.relation === "nonzero"
    ? true
    : condition.relation === "positive"
      ? value > 0
      : value > 0;
}

function domainAtPoint(
  conditions: readonly DomainCondition[],
  variable: string,
  point: Expr,
): DomainPointStatus {
  let unknown = false;
  for (const condition of conditions) {
    const value = simplifyRadicals(simplify(substitute(
      condition.expression,
      { [variable]: point },
    )));
    const holds = relationHolds(condition, value);
    if (holds === false) return "undefined";
    if (holds === null) unknown = true;
  }
  return unknown ? "unknown" : "defined";
}

function domainPointStatus(
  domain: DomainSimplificationResult,
  variable: string,
  point: Expr,
): DomainPointStatus {
  if (!domain.expression) return domain.status === "undefined" ? "undefined" : "unknown";
  return domainAtPoint(domain.conditions, variable, point);
}

function needsLocalDomainReview(
  domain: DomainSimplificationResult,
  pointDomain: DomainPointStatus | undefined,
  variable?: string,
  point?: Expr,
): boolean {
  return domain.conditions.length > 0 &&
    (pointDomain !== "defined" ||
      variable !== undefined && point !== undefined &&
        domain.conditions.some(condition => {
          if (condition.relation !== "nonnegative") return false;
          const value = simplifyRadicals(simplify(substitute(
            condition.expression,
            { [variable]: point },
          )));
          return isNumeric(value) && numericParts(value)[0] === 0n;
        }));
}

function resultFromSeries(
  domain: DomainSimplificationResult,
  pointDomain: DomainPointStatus,
  variable: string,
  point: Expr,
  compute: (expression: Expr) => SeriesResult,
): DomainSeriesResult {
  if (!domain.expression || domain.status === "undefined" || domain.status === "unsupported") {
    return {
      status: domain.status,
      conditions: domain.conditions,
      pointDomain,
      ...(domain.message === undefined ? {} : { message: domain.message }),
    };
  }
  const expansion = compute(domain.expression);
  const localDomainReview = needsLocalDomainReview(domain, pointDomain, variable, point);
  return {
    status: localDomainReview ? "partial" : domain.status,
    series: expansion,
    conditions: domain.conditions,
    pointDomain,
    ...(localDomainReview
      ? { message: "The expansion is retained, but carried domain conditions need local review at the center." }
      : domain.message === undefined ? {} : { message: domain.message }),
  };
}

/**
 * Combine multiple domain-aware expressions without discarding any operand's
 * source restrictions, while also collecting restrictions from the result.
 */
export function combineWithDomain(
  inputs: readonly DomainSimplificationResult[],
  combine: DomainExpressionCombine,
): DomainSimplificationResult {
  if (inputs.length === 0) throw new TypeError("At least one domain-aware expression is required.");
  const conditions = new Map<string, DomainCondition>();
  for (const input of inputs) {
    for (const condition of input.conditions) {
      const truth = relationHolds(condition, condition.expression);
      if (truth !== true) {
        conditions.set(
          `${condition.relation}:${structuralKey(condition.expression)}`,
          condition,
        );
      }
    }
  }
  const carriedConditions = [...conditions.values()];
  if (inputs.some(input => input.status === "undefined")) {
    return {
      status: "undefined",
      conditions: carriedConditions,
      message: "At least one input expression is undefined over the reals.",
    };
  }
  if (inputs.some(input => !input.expression)) {
    const unsupported = inputs.find(input => input.status === "unsupported");
    return {
      status: unsupported ? "unsupported" : "partial",
      conditions: carriedConditions,
      ...(unsupported?.message === undefined ? {} : { message: unsupported.message }),
    };
  }

  const expression = combine(inputs.map(input => input.expression!));
  const output = simplifyWithDomain(expression);
  const allConditions = new Map<string, DomainCondition>(conditions);
  for (const condition of output.conditions) {
    allConditions.set(
      `${condition.relation}:${structuralKey(condition.expression)}`,
      condition,
    );
  }
  const retainedConditions = [...allConditions.values()];
  if (output.status === "undefined") {
    return {
      status: "undefined",
      conditions: retainedConditions,
      ...(output.message === undefined ? {} : { message: output.message }),
    };
  }

  const message = output.message ?? inputs.find(input => input.message)?.message;
  if (inputs.some(input => input.status === "unsupported") || output.status === "unsupported") {
    return {
      status: "unsupported",
      ...(output.expression === undefined ? {} : { expression: output.expression }),
      conditions: retainedConditions,
      ...(message === undefined ? {} : { message }),
    };
  }
  if (inputs.some(input => input.status === "partial") || output.status === "partial") {
    return {
      status: "partial",
      ...(output.expression === undefined ? {} : { expression: output.expression }),
      conditions: retainedConditions,
      ...(message === undefined ? {} : { message }),
    };
  }
  return {
    status: "complete",
    ...(output.expression === undefined ? {} : { expression: output.expression }),
    conditions: retainedConditions,
    ...(message === undefined ? {} : { message }),
  };
}

/**
 * Apply an expression transformation while carrying existing domain conditions
 * forward and collecting any new conditions introduced by the result.
 */
export function transformWithDomain(
  input: DomainSimplificationResult,
  transform: DomainExpressionTransform,
  transformCondition: DomainExpressionTransform = expression => expression,
): DomainSimplificationResult {
  if (!input.expression) return input;

  const output = simplifyWithDomain(transform(input.expression));
  const conditions = new Map<string, DomainCondition>();
  const addCondition = (expression: Expr, relation: DomainCondition["relation"]): boolean | null => {
    const normalized = expression;
    if (isNumeric(normalized)) {
      const [numerator] = numericParts(normalized);
      const holds = relation === "nonzero"
        ? numerator !== 0n
        : relation === "positive"
          ? numerator > 0n
          : numerator >= 0n;
      return holds;
    }
    conditions.set(`${relation}:${structuralKey(normalized)}`, { expression: normalized, relation });
    return null;
  };

  for (const condition of output.conditions) addCondition(condition.expression, condition.relation);

  let domainContradiction = output.status === "undefined";
  let unsupported = output.status === "unsupported" || input.status === "unsupported";
  let partial = output.status === "partial" || input.status === "partial";
  for (const condition of input.conditions) {
    const mapped = transformCondition(condition.expression);
    const mappedDomain = simplifyWithDomain(mapped);
    if (mappedDomain.status === "undefined") domainContradiction = true;
    if (mappedDomain.status === "unsupported") unsupported = true;
    if (mappedDomain.status === "partial") partial = true;
    for (const nested of mappedDomain.conditions) addCondition(nested.expression, nested.relation);

    const mappedExpression = mappedDomain.expression ?? mapped;
    if (addCondition(mappedExpression, condition.relation) === false) domainContradiction = true;
  }

  const message = output.message ?? input.message;
  const retainedConditions = [...conditions.values()];
  if (domainContradiction) {
    return {
      status: "undefined",
      conditions: retainedConditions,
      message: "A carried domain condition is false after the transformation.",
    };
  }
  if (unsupported) {
    return {
      status: "unsupported",
      ...(output.expression === undefined ? {} : { expression: output.expression }),
      conditions: retainedConditions,
      ...(message === undefined ? {} : { message }),
    };
  }
  if (partial) {
    return {
      status: "partial",
      ...(output.expression === undefined ? {} : { expression: output.expression }),
      conditions: retainedConditions,
      ...(message === undefined ? {} : { message }),
    };
  }
  return {
    status: "complete",
    ...(output.expression === undefined ? {} : { expression: output.expression }),
    conditions: retainedConditions,
    ...(message === undefined ? {} : { message }),
  };
}

export function substituteWithDomain(
  input: DomainSimplificationResult,
  values: Readonly<Record<string, Expr>>,
): DomainSimplificationResult {
  const applySubstitution = (expression: Expr) => substitute(expression, values);
  return transformWithDomain(input, applySubstitution, applySubstitution);
}

export function differentiateWithDomain(
  input: DomainSimplificationResult,
  variable: string,
): DomainSimplificationResult {
  return transformWithDomain(input, expression => differentiate(expression, variable));
}

export function expandWithDomain(input: DomainSimplificationResult): DomainSimplificationResult {
  return transformWithDomain(input, expand);
}

export function factorWithDomain(
  input: DomainSimplificationResult,
  variable?: string,
): DomainSimplificationResult {
  return transformWithDomain(input, expression => factor(expression, variable));
}

export function integrateWithDomain(
  input: DomainSimplificationResult,
  variable: string,
): DomainSimplificationResult {
  return transformWithDomain(input, expression => integrate(expression, variable));
}

/**
 * Evaluate a domain-aware expression only when its carried real-domain
 * conditions are satisfied. Near floating-point boundaries, returns partial
 * rather than claiming that an approximate comparison is exact.
 */
export function evaluateWithDomain(
  input: Expr | DomainSimplificationResult,
  bindings: NumericBindings = {},
): DomainEvaluationResult {
  const domain = asDomainResult(input);
  if (!domain.expression || domain.status === "undefined" || domain.status === "unsupported") {
    return {
      status: domain.status,
      conditions: domain.conditions,
      ...(domain.message === undefined ? {} : { message: domain.message }),
    };
  }

  const exactBindings = Object.fromEntries(
    Object.entries(bindings).flatMap(([name, value]) => {
      const exact = exactExpressionForNumber(value);
      return exact === undefined ? [] : [[name, exact]];
    }),
  );
  let undecided = false;
  for (const condition of domain.conditions) {
    const exactValue = simplifyRadicals(simplify(substitute(condition.expression, exactBindings)));
    let holds = relationHolds(condition, exactValue);
    if (holds === null) {
      try {
        holds = numericRelationHolds(condition, evaluate(condition.expression, bindings));
      } catch (error) {
        if (!(error instanceof ReferenceError)) throw error;
      }
    }
    if (holds === false) {
      return {
        status: "undefined",
        conditions: domain.conditions,
        message: "The supplied values violate a carried real-domain condition.",
      };
    }
    if (holds === null) undecided = true;
  }

  if (undecided || domain.status === "partial") {
    return {
      status: "partial",
      conditions: domain.conditions,
      message: domain.message ??
        "The value was not returned because the original real-domain conditions are not fully verified.",
    };
  }
  return {
    status: "complete",
    value: evaluate(domain.expression, bindings),
    conditions: domain.conditions,
  };
}

/**
 * Compute a limit while retaining the source expression's conditions. A limit
 * at an excluded point remains meaningful and is reported alongside pointDomain.
 */
export function limitWithDomain(
  input: Expr | DomainSimplificationResult,
  variable: string,
  point: LimitPoint,
  direction: LimitDirection = "both",
): DomainLimitResult {
  const domain = asDomainResult(input);
  const pointDomain = point === "infinity" || point === "-infinity"
    ? undefined
    : domainPointStatus(domain, variable, point);
  if (!domain.expression || domain.status === "undefined" || domain.status === "unsupported") {
    return {
      status: domain.status,
      conditions: domain.conditions,
      ...(pointDomain === undefined ? {} : { pointDomain }),
      ...(domain.message === undefined ? {} : { message: domain.message }),
    };
  }
  const result = limit(domain.expression, variable, point, direction);
  const finitePoint = typeof point === "string" ? undefined : point;
  const localDomainReview = needsLocalDomainReview(
    domain,
    pointDomain,
    finitePoint === undefined ? undefined : variable,
    finitePoint,
  );
  const status = result.status === "unsupported"
    ? "unsupported"
    : localDomainReview || domain.status === "partial" ? "partial" : domain.status;
  const message = localDomainReview
    ? "Carried domain conditions may restrict the approach used for this limit."
    : result.message ?? domain.message;
  return {
    status,
    limit: result,
    conditions: domain.conditions,
    ...(pointDomain === undefined ? {} : { pointDomain }),
    ...(message === undefined ? {} : { message }),
  };
}

/** Compute a series while retaining domain restrictions and the center's domain status. */
export function seriesWithDomain(
  input: Expr | DomainSimplificationResult,
  variable: string,
  point: Expr,
  order = 6,
): DomainSeriesResult {
  const domain = asDomainResult(input);
  return resultFromSeries(
    domain,
    domainPointStatus(domain, variable, point),
    variable,
    point,
    expression => series(expression, variable, point, order),
  );
}

export function taylorSeriesWithDomain(
  input: Expr | DomainSimplificationResult,
  variable: string,
  point: Expr,
  order = 6,
): DomainSeriesResult {
  const domain = asDomainResult(input);
  return resultFromSeries(
    domain,
    domainPointStatus(domain, variable, point),
    variable,
    point,
    expression => taylorSeries(expression, variable, point, order),
  );
}

export function laurentSeriesWithDomain(
  input: Expr | DomainSimplificationResult,
  variable: string,
  point: Expr,
  order = 6,
): DomainSeriesResult {
  const domain = asDomainResult(input);
  return resultFromSeries(
    domain,
    domainPointStatus(domain, variable, point),
    variable,
    point,
    expression => laurentSeries(expression, variable, point, order),
  );
}

/**
 * Analyze continuity of a domain-aware expression. If prior transformations
 * carried restrictions that the simplified expression cannot encode, the
 * classification is conservatively marked partial.
 */
export function analyzeContinuityWithDomain(
  input: Expr | DomainSimplificationResult,
  variable: string,
  point: Expr,
  options?: ContinuityAnalysisOptions,
): DomainContinuityResult {
  const carriedInput = "conditions" in input;
  const domain = asDomainResult(input);
  const pointDomain = domainPointStatus(domain, variable, point);
  if (!domain.expression || domain.status === "undefined" || domain.status === "unsupported") {
    return {
      status: domain.status,
      conditions: domain.conditions,
      pointDomain,
      ...(domain.message === undefined ? {} : { message: domain.message }),
    };
  }

  const analysisExpression = "conditions" in input ? domain.expression : input;
  const analysis = analyzeContinuity(
    analysisExpression,
    variable,
    point,
    options,
  );
  const effectivePointDomain = carriedInput ? pointDomain : analysis.pointDomain;
  const uncertain = domain.status === "partial" ||
    carriedInput && needsLocalDomainReview(domain, pointDomain, variable, point);
  if (!uncertain) {
    return {
      status: analysis.status,
      analysis,
      conditions: domain.conditions,
      pointDomain: effectivePointDomain,
      ...(domain.message === undefined ? {} : { message: domain.message }),
    };
  }

  const { pointValue, ...analysisWithoutPointValue } = analysis;
  void pointValue;
  const message = "Carried domain conditions limit the continuity classification at this point.";
  const partialAnalysis: ContinuityAnalysisResult = {
    ...analysisWithoutPointValue,
    status: "partial",
    classification: "undetermined",
    pointDomain: effectivePointDomain,
    leftDomain: "uncertain",
    rightDomain: "uncertain",
    message,
  };
  return {
    status: "partial",
    analysis: partialAnalysis,
    conditions: domain.conditions,
    pointDomain: effectivePointDomain,
    message,
  };
}

/**
 * Solve an equation while excluding exact roots that violate the input's real
 * domain conditions. Symbolic conditions that cannot be decided stay explicit.
 */
export function solveWithDomain(
  input: Expr | DomainSimplificationResult,
  variable: string,
): DomainEquationSolveResult {
  const domain = "conditions" in input
    ? input
    : simplifyWithDomain(input);
  if (!domain.expression || domain.status === "undefined") {
    return {
      status: domain.status,
      conditions: domain.conditions,
      solutions: [],
      excludedSolutions: [],
      undeterminedSolutions: [],
      ...(domain.message === undefined ? {} : { message: domain.message }),
    };
  }

  if (domain.status === "unsupported") {
    return {
      status: "unsupported",
      conditions: domain.conditions,
      solutions: [],
      excludedSolutions: [],
      undeterminedSolutions: [],
      ...(domain.message === undefined ? {} : { message: domain.message }),
    };
  }

  const equation = solve(domain.expression, variable);
  if (equation.method === "constant-coefficients") {
    return {
      status: "unsupported",
      equation,
      conditions: domain.conditions,
      solutions: [],
      excludedSolutions: [],
      undeterminedSolutions: equation.solutions,
      message: "Filtering solutions involving symbolic constants or parameters over the real domain is not supported.",
    };
  }
  if (equation.method === "quartic-formula") {
    return {
      status: "unsupported",
      equation,
      conditions: domain.conditions,
      solutions: [],
      excludedSolutions: [],
      undeterminedSolutions: equation.solutions,
      message: "Filtering quartic radical solutions over the real domain is not supported.",
    };
  }
  if (equation.status === "unsupported") {
    return {
      status: "unsupported",
      equation,
      conditions: domain.conditions,
      solutions: [],
      excludedSolutions: [],
      undeterminedSolutions: [],
      ...(equation.message === undefined ? {} : { message: equation.message }),
    };
  }
  if (equation.status === "infinite" && domain.conditions.length > 0) {
    return {
      status: "unsupported",
      equation,
      conditions: domain.conditions,
      solutions: [],
      excludedSolutions: [],
      undeterminedSolutions: equation.solutions,
      message: "Filtering infinite solution families against domain conditions is not supported.",
    };
  }
  if (equation.status === "all" || equation.status === "none") {
    const status = equation.status === "all" && domain.conditions.length > 0
      ? "partial"
      : domain.status;
    return {
      status,
      equation,
      conditions: domain.conditions,
      solutions: [],
      excludedSolutions: [],
      undeterminedSolutions: [],
      ...(equation.status === "all" && domain.conditions.length > 0
        ? { message: "The equation has infinitely many roots; the carried domain conditions describe exclusions." }
        : {}),
    };
  }

  const solutions: Expr[] = [];
  const excludedSolutions: Expr[] = [];
  const undeterminedSolutions: Expr[] = [];
  for (const candidate of equation.solutions) {
    let excluded = false;
    let undecided = false;
    for (const condition of domain.conditions) {
      const value = simplify(substitute(condition.expression, { [variable]: candidate }));
      if (!isNumeric(value)) {
        undecided = true;
        continue;
      }
      const [numerator] = numericParts(value);
      const holds = condition.relation === "nonzero"
        ? numerator !== 0n
        : condition.relation === "positive"
          ? numerator > 0n
          : numerator >= 0n;
      if (!holds) {
        excluded = true;
        break;
      }
    }
    if (excluded) excludedSolutions.push(candidate);
    else if (undecided) undeterminedSolutions.push(candidate);
    else solutions.push(candidate);
  }

  const status = domain.status === "partial" || equation.status === "partial" ||
      undeterminedSolutions.length > 0
    ? "partial"
    : "complete";
  return {
    status,
    equation,
    conditions: domain.conditions,
    solutions,
    excludedSolutions,
    undeterminedSolutions,
    ...(undeterminedSolutions.length > 0
      ? { message: "Some candidate roots could not be checked against symbolic domain conditions." }
      : equation.message === undefined ? {} : { message: equation.message }),
  };
}

/**
 * Solve a supported polynomial system while retaining and checking the real
 * domain conditions attached to either side of every equation.
 */
export function solvePolynomialSystemWithDomain(
  equations: readonly DomainPolynomialEquation[],
  variables: readonly string[],
): DomainPolynomialSystemSolveResult {
  const conditions = new Map<string, DomainCondition>();
  const polynomialEquations: PolynomialEquation[] = [];
  let unsupported = false;
  let partial = false;
  let undefinedDomain = false;

  const normalizeSide = (input: Expr | DomainSimplificationResult): Expr | undefined => {
    const domain = "conditions" in input ? input : simplifyWithDomain(input);
    if (domain.status === "undefined") undefinedDomain = true;
    if (domain.status === "unsupported") unsupported = true;
    if (domain.status === "partial") partial = true;
    for (const condition of domain.conditions) {
      conditions.set(
        `${condition.relation}:${structuralKey(condition.expression)}`,
        condition,
      );
    }
    return domain.expression;
  };

  for (const equation of equations) {
    const left = normalizeSide(equation.left);
    const right = normalizeSide(equation.right);
    if (!left || !right) continue;
    polynomialEquations.push({ left, right });
  }
  const carriedConditions = [...conditions.values()];
  const emptySolutions = {
    conditions: carriedConditions,
    solutions: [],
    excludedSolutions: [],
    undeterminedSolutions: [],
  } satisfies Pick<
    DomainPolynomialSystemSolveResult,
    "conditions" | "solutions" | "excludedSolutions" | "undeterminedSolutions"
  >;

  if (undefinedDomain) {
    return {
      ...emptySolutions,
      status: "undefined",
      message: "At least one equation side is undefined over the reals.",
    };
  }
  if (unsupported) {
    return {
      ...emptySolutions,
      status: "unsupported",
      message: "At least one equation side has unsupported real-domain conditions.",
    };
  }

  const system = solvePolynomialSystem(polynomialEquations, variables);
  if (system.status === "unsupported") {
    return {
      ...emptySolutions,
      status: "unsupported",
      system,
      ...(system.message === undefined ? {} : { message: system.message }),
    };
  }
  if (system.status === "none") {
    return {
      ...emptySolutions,
      status: partial ? "partial" : "complete",
      system,
    };
  }
  if (system.status === "infinite") {
    return {
      ...emptySolutions,
      status: partial || carriedConditions.length > 0 ? "partial" : "complete",
      system,
      ...(carriedConditions.length > 0
        ? { message: "The solution family is subject to the carried domain conditions." }
        : {}),
    };
  }

  const solutions: Readonly<Record<string, Expr>>[] = [];
  const excludedSolutions: Readonly<Record<string, Expr>>[] = [];
  const undeterminedSolutions: Readonly<Record<string, Expr>>[] = [];
  for (const solution of system.solutions) {
    let excluded = false;
    let undecided = false;
    for (const condition of carriedConditions) {
      const value = simplify(substitute(condition.expression, solution));
      if (!isNumeric(value)) {
        undecided = true;
        continue;
      }
      const [numerator] = numericParts(value);
      const holds = condition.relation === "nonzero"
        ? numerator !== 0n
        : condition.relation === "positive"
          ? numerator > 0n
          : numerator >= 0n;
      if (!holds) {
        excluded = true;
        break;
      }
    }
    if (excluded) excludedSolutions.push(solution);
    else if (undecided) undeterminedSolutions.push(solution);
    else solutions.push(solution);
  }

  return {
    status: partial || undeterminedSolutions.length > 0 ? "partial" : "complete",
    system,
    conditions: carriedConditions,
    solutions,
    excludedSolutions,
    undeterminedSolutions,
    ...(undeterminedSolutions.length > 0
      ? { message: "Some solution points could not be checked against symbolic domain conditions." }
      : {}),
  };
}
