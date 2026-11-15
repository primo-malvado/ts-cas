import {
  add, equals, fn, integer, isNumeric, isZero, mul, numericAdd, numericDiv, numericMul, numericParts,
  pow, rational, structuralKey, symbol, type Expr, type NumericExpr,
} from "../core/expr.js";
import {
  isUnivariatePolynomial, polynomialAdd, polynomialCoefficient, polynomialConstant, polynomialDegree,
  polynomialDivide, polynomialFromExpr, polynomialMultiply, polynomialPow, polynomialSubtract,
  polynomialToExpr, polynomialVariable, polynomialZero, type Polynomial,
} from "../algebra/polynomial.js";
import { expand } from "../algebra/expand.js";
import { factorPolynomial } from "../algebra/factor.js";
import { simplify } from "../algebra/simplify.js";
import { differentiate } from "./differentiate.js";

/** Error thrown when no supported elementary antiderivative is recognized. */
export class IntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationError";
  }
}

export type IntegrationRule =
  | "integrate-independent-expression"
  | "integrate-polynomial"
  | "u-substitution"
  | "rational-partial-fractions"
  | "sum-rule"
  | "integration-by-parts"
  | "constant-multiple"
  | "power-rule"
  | "elementary-chain-rule";

export interface IntegrationStep {
  readonly id: number;
  readonly parentId: number | null;
  readonly rule: IntegrationRule;
  readonly input: Expr;
  readonly result: Expr;
}

export interface IntegrationExplanation {
  readonly variable: string;
  readonly antiderivative: Expr;
  readonly steps: readonly IntegrationStep[];
}

export interface IntegrationVerificationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

interface IntegrationTraceState {
  readonly steps: IntegrationStep[];
  nextId: number;
}

/**
 * Computes a supported symbolic indefinite integral with respect to `variable`.
 * The integration constant is intentionally omitted, as is conventional in CAS APIs.
 *
 * Supported cases include exact multivariate polynomials, sums, constant multiples,
 * powers and elementary functions with affine arguments, u-substitution for recognizable
 * compositions, integration by parts, and rational functions whose denominator splits into
 * linear factors over the rationals. Unsupported integrals fail explicitly rather than guessing.
 */
export function integrate(expr: Expr, variable: string): Expr {
  validateIntegrationVariable(variable);
  return simplify(integrateInner(expr, variable));
}

/**
 * Integrate an expression and identify the top-level rule selected by the
 * current implementation. The trace is an explanation, not a proof object.
 */
export function integrateWithSteps(expr: Expr, variable: string): IntegrationExplanation {
  validateIntegrationVariable(variable);
  const trace: IntegrationTraceState = { steps: [], nextId: 0 };
  const antiderivative = simplify(integrateInner(expr, variable, trace));
  const steps = trace.steps
    .map(step => step.id === 0 ? { ...step, result: antiderivative } : step)
    .sort((left, right) => left.id - right.id);
  return {
    variable,
    antiderivative,
    steps,
  };
}

/** Replay the trace and check each step by differentiating its claimed result. */
export function verifyIntegrationExplanation(
  expression: Expr,
  explanation: IntegrationExplanation,
  variable: string,
): IntegrationVerificationResult {
  try {
    if (explanation.variable !== variable || explanation.steps.length === 0) {
      return { valid: false, errors: ["Integration explanation is missing its variable or steps."] };
    }

    const ids = new Set<number>();
    let root: IntegrationStep | undefined;
    for (const step of explanation.steps) {
      if (!Number.isSafeInteger(step.id) || ids.has(step.id)) {
        return { valid: false, errors: ["Integration trace contains invalid or duplicate step IDs."] };
      }
      ids.add(step.id);
      if (step.parentId === null) {
        if (root) return { valid: false, errors: ["Integration trace has multiple root steps."] };
        root = step;
      }
    }
    if (!root || root.id !== 0 ||
        explanation.steps.some(step => step.parentId !== null && !ids.has(step.parentId))) {
      return { valid: false, errors: ["Integration trace has an invalid parent-child structure."] };
    }
    if (structuralKey(root.input) !== structuralKey(expression)) {
      return { valid: false, errors: ["Integration trace is not bound to the expected integrand."] };
    }

    const replay = integrateWithSteps(expression, variable);
    if (structuralKey(replay.antiderivative) !== structuralKey(explanation.antiderivative) ||
        replay.steps.length !== explanation.steps.length) {
      return { valid: false, errors: ["Integration explanation does not match a replay."] };
    }
    for (let index = 0; index < replay.steps.length; index++) {
      const actual = explanation.steps[index]!;
      const expected = replay.steps[index]!;
      if (actual.id !== expected.id || actual.parentId !== expected.parentId ||
          actual.rule !== expected.rule ||
          structuralKey(actual.input) !== structuralKey(expected.input) ||
          structuralKey(actual.result) !== structuralKey(expected.result)) {
        return { valid: false, errors: [`Integration step ${index} does not match a replay.`] };
      }
      const residual = simplify(expand(add(
        differentiate(actual.result, variable),
        mul(integer(-1), actual.input),
      )));
      if (!isZero(residual)) {
        return { valid: false, errors: [`Integration step ${actual.id} fails the derivative check.`] };
      }
    }
    return { valid: true, errors: [] };
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : "Could not verify integration explanation."],
    };
  }
}

function validateIntegrationVariable(variable: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) {
    throw new TypeError(`Invalid integration variable: ${variable}`);
  }
}

function integrateInner(
  expr: Expr,
  variable: string,
  trace?: IntegrationTraceState,
  parentId: number | null = null,
): Expr {
  const id = trace ? trace.nextId++ : -1;
  const record = (rule: IntegrationRule, result: Expr): Expr => {
    trace?.steps.push({ id, parentId, rule, input: expr, result });
    return result;
  };
  // Any expression independent of x integrates to expression*x, including functions
  // of other symbols such as sin(y).
  if (!dependsOn(expr, variable)) {
    return record("integrate-independent-expression", simplify(mul(expr, symbol(variable))));
  }

  // Try exact polynomial integration first. The polynomial representation naturally
  // handles multivariate coefficients such as y*x^3 + 2*x.
  const polynomial = tryPolynomial(expr);
  if (polynomial) return record("integrate-polynomial", integratePolynomial(polynomial, variable));

  // Try u-substitution before direct rules, so compositions such as sin(x^2)*2*x
  // can be integrated even though the inner argument is not affine.
  const substituted = tryUSubstitution(expr, variable);
  if (substituted) return record("u-substitution", substituted);

  // Rational functions with a denominator that splits into rational linear factors
  // can be integrated via polynomial division and exact partial fractions.
  const rationalPrimitive = tryRationalIntegration(expr, variable);
  if (rationalPrimitive) return record("rational-partial-fractions", rationalPrimitive);

  switch (expr.kind) {
    case "Integer":
    case "Rational":
    case "Symbol":
      // Numeric and symbol-only cases are either handled by the independent-variable
      // path or the polynomial path above.
      return record("integrate-independent-expression", simplify(mul(expr, symbol(variable))));

    case "Add":
      return record("sum-rule", simplify(add(...expr.terms.map(term =>
        integrateInner(term, variable, trace, id)))));

    case "Mul": {
      const logByParts = tryPolynomialTimesLog(expr, variable, trace, id);
      if (logByParts) return record("integration-by-parts", logByParts);
      const byParts = tryIntegrationByParts(expr, variable, trace, id);
      if (byParts) return record("integration-by-parts", byParts);
      const constantFactors = expr.factors.filter(factor => !dependsOn(factor, variable));
      const variableFactors = expr.factors.filter(factor => dependsOn(factor, variable));
      if (variableFactors.length === 1) {
        return record("constant-multiple", simplify(mul(
          ...constantFactors,
          integrateInner(variableFactors[0]!, variable, trace, id),
        )));
      }
      throw unsupported(expr, variable);
    }

    case "Pow": {
      if (!isNumeric(expr.exponent)) throw unsupported(expr, variable);
      const affine = affineParts(expr.base, variable);
      if (!affine || isZero(affine.slope)) throw unsupported(expr, variable);
      return record("power-rule", integratePowerOfAffine(expr.base, expr.exponent, affine.slope));
    }

    case "Function": {
      if (expr.args.length !== 1) throw unsupported(expr, variable);
      const argument = expr.args[0]!;
      const affine = affineParts(argument, variable);
      if (!affine || isZero(affine.slope)) throw unsupported(expr, variable);
      const slopeInverse = pow(affine.slope, integer(-1));
      switch (expr.name) {
        case "sin":
          return record("elementary-chain-rule", simplify(mul(integer(-1), fn("cos", argument), slopeInverse)));
        case "cos":
          return record("elementary-chain-rule", simplify(mul(fn("sin", argument), slopeInverse)));
        case "tan":
          return record("elementary-chain-rule", simplify(mul(integer(-1), fn("log", fn("abs", fn("cos", argument))), slopeInverse)));
        case "exp":
          return record("elementary-chain-rule", simplify(mul(fn("exp", argument), slopeInverse)));
        case "log":
        case "ln":
          return record("elementary-chain-rule", simplify(mul(
            add(mul(argument, fn(expr.name, argument)), mul(integer(-1), argument)),
            slopeInverse,
          )));
        case "sqrt":
          return record("power-rule", integratePowerOfAffine(argument, rational(1n, 2n), affine.slope));
        case "abs":
          return record("elementary-chain-rule", simplify(mul(argument, fn("abs", argument), rational(1n, 2n), slopeInverse)));
        default:
          throw unsupported(expr, variable);
      }
    }
  }
}

function integratePolynomial(polynomial: Polynomial, variable: string): Expr {
  if (polynomial.terms.size === 0) return integer(0);
  const degree = polynomialDegree(polynomial, variable);
  const x = symbol(variable);
  const terms: Expr[] = [];
  for (let exponent = 0; exponent <= degree; exponent++) {
    const coefficientPolynomial = polynomialCoefficient(polynomial, variable, exponent);
    if (coefficientPolynomial.terms.size === 0) continue;
    const coefficient = polynomialToExpr(coefficientPolynomial);
    const nextExponent = exponent + 1;
    terms.push(mul(
      coefficient,
      rational(1n, BigInt(nextExponent)),
      pow(x, integer(BigInt(nextExponent))),
    ));
  }
  return simplify(add(...terms));
}

function integratePowerOfAffine(base: Expr, exponent: Expr, slope: Expr): Expr {
  const slopeInverse = pow(slope, integer(-1));
  const nextExponent = simplify(add(exponent, integer(1)));
  if (isZero(nextExponent)) {
    // Over the reals, the logarithm of the absolute value is the appropriate primitive
    // on each interval that does not contain a zero of the affine base.
    return simplify(mul(fn("log", fn("abs", base)), slopeInverse));
  }
  return simplify(mul(
    pow(base, nextExponent),
    pow(mul(slope, nextExponent), integer(-1)),
  ));
}

/**
 * Recognize integrands of the form c*f(g(x))*g'(x), where c is independent of x.
 * The outer primitive is evaluated symbolically and then composed with g(x).
 */
function tryUSubstitution(expr: Expr, variable: string): Expr | null {
  const factors = expr.kind === "Mul" ? [...expr.factors] : [expr];
  for (let index = 0; index < factors.length; index++) {
    const candidate = factors[index]!;
    let inner: Expr;
    let primitiveInInner: (u: Expr) => Expr;

    if (candidate.kind === "Function" && candidate.args.length === 1) {
      inner = candidate.args[0]!;
      const functionPrimitive = buildFunctionPrimitive(candidate.name);
      if (!functionPrimitive) continue;
      primitiveInInner = functionPrimitive;
    } else if (candidate.kind === "Pow" && isNumeric(candidate.exponent)) {
      inner = candidate.base;
      const exponent = candidate.exponent;
      primitiveInInner = (u) => {
        const nextExponent = simplify(add(exponent, integer(1)));
        if (isZero(nextExponent)) return fn("log", fn("abs", u));
        return mul(pow(u, nextExponent), pow(nextExponent, integer(-1)));
      };
    } else {
      continue;
    }

    if (!dependsOn(inner, variable)) continue;
    let innerDerivative: Expr;
    try {
      innerDerivative = simplify(differentiate(inner, variable));
    } catch {
      continue;
    }
    if (isZero(innerDerivative)) continue;

    const remainingFactors = factors.filter((_, factorIndex) => factorIndex !== index);
    const remainder = simplify(mul(...remainingFactors));
    const scale = proportionalConstant(remainder, innerDerivative, variable);
    if (scale === null) continue;

    // For a rational-power primitive, the exponent -1 case was handled above. For
    // elementary functions, the scale remains outside the composed primitive.
    const primitive = primitiveInInner(inner);
    return simplify(mul(scale, primitive));
  }
  return null;
}

function buildFunctionPrimitive(name: string): ((u: Expr) => Expr) | null {
  switch (name) {
    case "sin": return u => mul(integer(-1), fn("cos", u));
    case "cos": return u => fn("sin", u);
    case "tan": return u => mul(integer(-1), fn("log", fn("abs", fn("cos", u))));
    case "exp": return u => fn("exp", u);
    case "log":
    case "ln": return u => add(mul(u, fn(name, u)), mul(integer(-1), u));
    case "sqrt": return u => mul(rational(2n, 3n), pow(u, rational(3n, 2n)));
    case "abs": return u => mul(rational(1n, 2n), u, fn("abs", u));
    default: return null;
  }
}

/**
 * Return a rational c when numerator = c*denominator as polynomials in `variable`.
 * Exact structural equality is the cheap common path; polynomial comparison also
 * handles scaled derivatives such as x versus 2*x or 4*x+2 versus 2*x+1.
 */
function proportionalConstant(numerator: Expr, denominator: Expr, variable: string): NumericExpr | null {
  const n = simplify(numerator);
  const d = simplify(denominator);
  if (equals(n, d)) return integer(1);

  const numeratorPolynomial = tryPolynomial(n);
  const denominatorPolynomial = tryPolynomial(d);
  if (!numeratorPolynomial || !denominatorPolynomial) return null;
  const nDegree = polynomialDegree(numeratorPolynomial, variable);
  const dDegree = polynomialDegree(denominatorPolynomial, variable);
  if (nDegree !== dDegree || nDegree < 0) return null;

  const nLead = leadingNumericCoefficient(numeratorPolynomial, variable, nDegree);
  const dLead = leadingNumericCoefficient(denominatorPolynomial, variable, dDegree);
  if (!nLead || !dLead) return null;
  const ratio = numericDiv(nLead, dLead);
  if (!isNumeric(ratio)) return null;

  const scaledDenominator = polynomialMultiply(
    denominatorPolynomial,
    polynomialConstant(ratio),
  );
  const difference = polynomialSubtract(numeratorPolynomial, scaledDenominator);
  return difference.terms.size === 0 ? ratio : null;
}

function leadingNumericCoefficient(poly: Polynomial, variable: string, degree: number): NumericExpr | null {
  const terms = [...poly.terms.values()].filter(term =>
    (term.monomial.powers.get(variable) ?? 0) === degree
  );
  if (terms.length !== 1) return null;
  const [term] = terms;
  if (!term || [...term.monomial.powers.keys()].some(name => name !== variable)) return null;
  return term.coefficient;
}

/**
 * Integrate P(x)*log(a*x+b) by parts. The remaining integral P_int*a/(a*x+b)
 * is rational and is delegated to the exact rational-integral engine.
 */
function tryPolynomialTimesLog(
  expr: Expr,
  variable: string,
  trace?: IntegrationTraceState,
  parentId: number | null = null,
): Expr | null {
  if (expr.kind !== "Mul") return null;
  for (let index = 0; index < expr.factors.length; index++) {
    const candidate = expr.factors[index]!;
    if (candidate.kind !== "Function" || !["log", "ln"].includes(candidate.name) || candidate.args.length !== 1) continue;
    const argument = candidate.args[0]!;
    const affine = affineParts(argument, variable);
    if (!affine || isZero(affine.slope)) continue;

    const polynomialExpression = simplify(mul(...expr.factors.filter((_, factorIndex) => factorIndex !== index)));
    const polynomial = tryPolynomial(polynomialExpression);
    if (!polynomial || !isUnivariatePolynomial(polynomial, variable) || polynomialDegree(polynomial, variable) < 0) continue;

    // Split sums before applying integration by parts. This lets the simplifier
    // cancel each rational remainder term independently, e.g. for (x^2+1)*log(x).
    if (polynomial.terms.size > 1) {
      const termPrimitives: Expr[] = [];
      for (const [key, term] of polynomial.terms) {
        const singleTerm: Polynomial = { kind: "Polynomial", terms: new Map([[key, term]]) };
        termPrimitives.push(integrateInner(
          simplify(mul(polynomialToExpr(singleTerm), candidate)),
          variable,
          trace,
          parentId,
        ));
      }
      return simplify(add(...termPrimitives));
    }

    const polynomialPrimitive = integratePolynomial(polynomial, variable);
    const remainingIntegrand = simplify(mul(polynomialPrimitive, affine.slope, pow(argument, integer(-1))));
    const remainingPolynomial = tryPolynomial(remainingIntegrand);
    const remainingPrimitive = remainingPolynomial && isUnivariatePolynomial(remainingPolynomial, variable)
      ? integratePolynomial(remainingPolynomial, variable)
      : tryRationalIntegration(remainingIntegrand, variable);
    if (!remainingPrimitive) continue;

    // Rational integration can express log(|a*x+b|) with a scaled affine
    // argument, e.g. log(|x+1/2|), while the original product uses log(2*x+1).
    // These differ only by a constant. Since the coefficient of such a log in
    // an antiderivative of the rational remainder is independent of `variable`,
    // canonicalize it to the original affine argument so subsequent symbolic
    // differentiation can cancel the rational terms structurally.
    const normalizedRemainingPrimitive = normalizeEquivalentAffineLogs(
      remainingPrimitive,
      argument,
      variable,
      candidate.name,
    );
    return simplify(add(
      mul(polynomialPrimitive, fn(candidate.name, argument)),
      mul(integer(-1), normalizedRemainingPrimitive),
    ));
  }
  return null;
}

/** Integration by parts for P(x)*F(x), with polynomial P and known primitive of F. */
function tryIntegrationByParts(
  expr: Expr,
  variable: string,
  trace?: IntegrationTraceState,
  parentId: number | null = null,
): Expr | null {
  if (expr.kind !== "Mul") return null;
  for (let index = 0; index < expr.factors.length; index++) {
    const polynomialFactor = expr.factors[index]!;
    const polynomial = tryPolynomial(polynomialFactor);
    if (!polynomial || polynomialDegree(polynomial, variable) <= 0) continue;

    const remaining = expr.factors.filter((_, factorIndex) => factorIndex !== index);
    if (remaining.length === 0) continue;
    const otherFactor = simplify(mul(...remaining));

    const attemptTrace = trace
      ? { steps: [] as IntegrationStep[], nextId: trace.nextId }
      : undefined;
    let otherPrimitive: Expr;
    try {
      otherPrimitive = integrateInner(otherFactor, variable, attemptTrace, parentId);
    } catch {
      continue;
    }
    // Avoid a non-reducing cycle such as integration by parts on x*log(x):
    // the primitive of log(x) already contains x as an algebraic factor.
    if (hasExplicitVariableFactorOutsideFunctions(otherPrimitive, variable)) continue;

    let derivativeOfPolynomial: Expr;
    try {
      derivativeOfPolynomial = simplify(differentiate(polynomialFactor, variable));
    } catch {
      continue;
    }
    if (isZero(derivativeOfPolynomial)) continue;

    let remainderPrimitive: Expr;
    try {
      remainderPrimitive = integrateInner(
        simplify(mul(derivativeOfPolynomial, otherPrimitive)),
        variable,
        attemptTrace,
        parentId,
      );
    } catch {
      continue;
    }
    const negativeRemainderTerms = remainderPrimitive.kind === "Add"
      ? remainderPrimitive.terms.map(term => mul(integer(-1), term))
      : [mul(integer(-1), remainderPrimitive)];
    if (trace && attemptTrace) {
      trace.steps.push(...attemptTrace.steps);
      trace.nextId = attemptTrace.nextId;
    }
    return simplify(add(
      mul(polynomialFactor, otherPrimitive),
      ...negativeRemainderTerms,
    ));
  }
  return null;
}

/** Detect an explicit algebraic factor x outside function arguments. */
function hasExplicitVariableFactorOutsideFunctions(expr: Expr, variable: string): boolean {
  switch (expr.kind) {
    case "Integer":
    case "Rational":
      return false;
    case "Symbol":
      return expr.name === variable;
    case "Function":
      // Variables under sin(x), exp(x), log(x), etc. are arguments, not product factors.
      return false;
    case "Add":
      return expr.terms.some(term => hasExplicitVariableFactorOutsideFunctions(term, variable));
    case "Mul":
      return expr.factors.some(factor => hasExplicitVariableFactorOutsideFunctions(factor, variable));
    case "Pow":
      return expr.exponent.kind === "Integer" && expr.exponent.value > 0n
        && hasExplicitVariableFactorOutsideFunctions(expr.base, variable);
  }
}

interface PolynomialFraction {
  readonly numerator: Polynomial;
  readonly denominator: Polynomial;
}

/** Convert a rational expression into exact univariate numerator/denominator polynomials. */
function polynomialFractionFromExpr(expr: Expr, variable: string): PolynomialFraction | null {
  const one = () => polynomialConstant(1);
  const fraction = (numerator: Polynomial, denominator: Polynomial): PolynomialFraction => ({ numerator, denominator });
  switch (expr.kind) {
    case "Integer":
    case "Rational":
      return fraction(polynomialConstant(expr), one());
    case "Symbol":
      if (expr.name !== variable) return null;
      return fraction(polynomialFromExpr(expr), one());
    case "Function":
      return null;
    case "Add": {
      let result: PolynomialFraction = fraction(polynomialZero(), one());
      for (const term of expr.terms) {
        const part = polynomialFractionFromExpr(term, variable);
        if (!part) return null;
        result = fraction(
          polynomialAdd(
            polynomialMultiply(result.numerator, part.denominator),
            polynomialMultiply(part.numerator, result.denominator),
          ),
          polynomialMultiply(result.denominator, part.denominator),
        );
      }
      return result;
    }
    case "Mul": {
      let numerator = one();
      let denominator = one();
      for (const factor of expr.factors) {
        const part = polynomialFractionFromExpr(factor, variable);
        if (!part) return null;
        numerator = polynomialMultiply(numerator, part.numerator);
        denominator = polynomialMultiply(denominator, part.denominator);
      }
      return fraction(numerator, denominator);
    }
    case "Pow": {
      if (expr.exponent.kind !== "Integer") return null;
      const exponent = expr.exponent.value;
      if (exponent > 12n || exponent < -12n) return null;
      const base = polynomialFractionFromExpr(expr.base, variable);
      if (!base) return null;
      if (exponent === 0n) {
        if (base.numerator.terms.size === 0) return null;
        return fraction(one(), one());
      }
      const magnitude = Number(exponent < 0n ? -exponent : exponent);
      if (exponent > 0n) {
        return fraction(polynomialPow(base.numerator, magnitude), polynomialPow(base.denominator, magnitude));
      }
      if (base.numerator.terms.size === 0) return null;
      return fraction(polynomialPow(base.denominator, magnitude), polynomialPow(base.numerator, magnitude));
    }
  }
}

/**
 * Integrate a rational function by long division and exact partial fractions.
 * Denominators may split into rational linear factors and monic irreducible
 * quadratics with negative discriminant. Higher-degree irreducible factors remain
 * explicitly unsupported.
 */
function tryRationalIntegration(expr: Expr, variable: string): Expr | null {
  const fraction = polynomialFractionFromExpr(expr, variable);
  if (!fraction || !isUnivariatePolynomial(fraction.numerator, variable)
    || !isUnivariatePolynomial(fraction.denominator, variable)) return null;
  if (fraction.denominator.terms.size === 0) throw new IntegrationError("Division by the zero polynomial is undefined.");

  const denominatorDegree = polynomialDegree(fraction.denominator, variable);
  if (denominatorDegree <= 0) return null;

  const division = polynomialDivide(fraction.numerator, fraction.denominator);
  let result: Expr = division.quotient.terms.size > 0
    ? integratePolynomial(division.quotient, variable)
    : integer(0);
  if (division.remainder.terms.size === 0) return simplify(result);

  const factorization = factorPolynomial(fraction.denominator, variable);
  const reconstructed = factorization.factors.reduce(
    (product, item) => polynomialMultiply(product, polynomialPow(item.factor, item.multiplicity)),
    polynomialConstant(factorization.content),
  );
  if (polynomialSubtract(reconstructed, fraction.denominator).terms.size !== 0) return null;

  type FactorComponent = {
    readonly factor: Polynomial;
    readonly multiplicity: number;
    readonly degree: 1 | 2;
    readonly expression: Expr;
  };
  const components: FactorComponent[] = [];
  for (const item of factorization.factors) {
    const degree = polynomialDegree(item.factor, variable);
    const expression = polynomialToExpr(item.factor);
    if (degree === 1 && isMonicLinearFactor(item.factor, variable)) {
      components.push({ factor: item.factor, multiplicity: item.multiplicity, degree: 1, expression });
    } else if (degree === 2 && isMonicIrreducibleQuadratic(item.factor, variable)) {
      components.push({ factor: item.factor, multiplicity: item.multiplicity, degree: 2, expression });
    } else {
      return null;
    }
  }
  const totalMultiplicity = components.reduce((sum, item) => sum + item.degree * item.multiplicity, 0);
  if (totalMultiplicity !== denominatorDegree || totalMultiplicity === 0) return null;

  type FractionBasis = {
    readonly componentIndex: number;
    readonly factorExpression: Expr;
    readonly power: number;
    readonly numeratorPower: number;
    readonly polynomial: Polynomial;
  };
  const basis: FractionBasis[] = [];
  components.forEach((item, componentIndex) => {
    for (let powerIndex = 1; powerIndex <= item.multiplicity; powerIndex++) {
      const divisor = polynomialPow(item.factor, powerIndex);
      const divided = polynomialDivide(fraction.denominator, divisor);
      if (divided.remainder.terms.size !== 0) return;
      for (let numeratorPower = 0; numeratorPower < item.degree; numeratorPower++) {
        const numerator = numeratorPower === 0
          ? polynomialConstant(1)
          : polynomialVariable(variable);
        const numeratorPowerPoly = numeratorPower === 0
          ? numerator
          : polynomialPow(numerator, numeratorPower);
        basis.push({
          componentIndex,
          factorExpression: item.expression,
          power: powerIndex,
          numeratorPower,
          polynomial: polynomialMultiply(numeratorPowerPoly, divided.quotient),
        });
      }
    }
  });
  if (basis.length !== denominatorDegree) return null;

  const size = denominatorDegree;
  const matrix: NumericExpr[][] = [];
  for (let exponent = 0; exponent < size; exponent++) {
    const row: NumericExpr[] = basis.map(item => coefficientAt(item.polynomial, variable, exponent));
    row.push(coefficientAt(division.remainder, variable, exponent));
    matrix.push(row);
  }
  const coefficients = solveExactNumericSystem(matrix, size);
  if (!coefficients) return null;

  // Gather numerator coefficients by factor power. Linear factors use a constant
  // numerator; quadratics use A*x+B, which is integrated via q'/q and 1/q^n.
  const grouped = new Map<string, { componentIndex: number; power: number; numerator: NumericExpr[] }>();
  basis.forEach((item, index) => {
    const key = `${item.componentIndex}:${item.power}`;
    let group = grouped.get(key);
    if (!group) {
      group = {
        componentIndex: item.componentIndex,
        power: item.power,
        numerator: Array.from({ length: components[item.componentIndex]!.degree }, () => integer(0)),
      };
      grouped.set(key, group);
    }
    group.numerator[item.numeratorPower] = coefficients[index]!;
  });

  for (const group of grouped.values()) {
    const component = components[group.componentIndex]!;
    if (component.degree === 1) {
      const coefficient = group.numerator[0]!;
      if (isZero(coefficient)) continue;
      if (group.power === 1) {
        result = add(result, mul(coefficient, fn("log", fn("abs", component.expression))));
      } else {
        const nextExponent = 1 - group.power;
        result = add(result, mul(
          coefficient,
          rational(1n, BigInt(nextExponent)),
          pow(component.expression, integer(nextExponent)),
        ));
      }
    } else {
      result = add(result, integrateQuadraticPartialFraction(
        component.expression,
        variable,
        group.numerator[1]!,
        group.numerator[0]!,
        group.power,
      ));
    }
  }
  return simplify(result);
}

/** Validate a monic quadratic with rational coefficients and negative discriminant. */
function isMonicIrreducibleQuadratic(poly: Polynomial, variable: string): boolean {
  if (polynomialDegree(poly, variable) !== 2) return false;
  const leading = coefficientAt(poly, variable, 2);
  if (!numericEquals(leading, integer(1))) return false;
  const linear = coefficientAt(poly, variable, 1);
  const constant = coefficientAt(poly, variable, 0);
  const discriminant = numericAdd(
    numericMul(linear, linear) as NumericExpr,
    negateNumeric(numericMul(integer(4), constant) as NumericExpr),
  ) as NumericExpr;
  return numericParts(discriminant)[0] < 0n;
}

function numericEquals(a: NumericExpr, b: NumericExpr): boolean {
  const [an, ad] = numericParts(a);
  const [bn, bd] = numericParts(b);
  return an * bd === bn * ad;
}

/** Integrate (A*x+B)/q(x)^n for a monic irreducible real quadratic q. */
function integrateQuadraticPartialFraction(
  quadratic: Expr,
  variable: string,
  coefficientX: NumericExpr,
  coefficientConstant: NumericExpr,
  powerIndex: number,
): Expr {
  const xLinear = coefficientAt(tryPolynomial(quadratic)!, variable, 1);
  const alpha = asExactNumeric(numericDiv(coefficientX, integer(2)));
  const beta = asExactNumeric(numericAdd(
    coefficientConstant,
    negateNumeric(asExactNumeric(numericDiv(numericMul(coefficientX, xLinear) as NumericExpr, integer(2)))),
  ));
  let result: Expr = integer(0);

  if (!isZero(alpha)) {
    if (powerIndex === 1) {
      result = add(result, mul(alpha, fn("log", fn("abs", quadratic))));
    } else {
      result = add(result, mul(
        alpha,
        rational(1n, BigInt(1 - powerIndex)),
        pow(quadratic, integer(1 - powerIndex)),
      ));
    }
  }
  if (!isZero(beta)) {
    result = add(result, mul(beta, integralReciprocalQuadratic(quadratic, variable, powerIndex)));
  }
  return simplify(result);
}

/** Compute integral dx/q(x)^n by completing the square and using the standard recurrence. */
function integralReciprocalQuadratic(quadratic: Expr, variable: string, powerIndex: number): Expr {
  const poly = tryPolynomial(quadratic);
  if (!poly) throw new IntegrationError("Unsupported quadratic denominator.");
  const p = coefficientAt(poly, variable, 1);
  const c = coefficientAt(poly, variable, 0);
  const pSquaredOverFour = asExactNumeric(numericDiv(numericMul(p, p) as NumericExpr, integer(4)));
  const aSquared = asExactNumeric(numericAdd(c, negateNumeric(pSquaredOverFour)));
  if (numericParts(aSquared)[0] <= 0n) throw new IntegrationError("Quadratic denominator must have negative discriminant.");

  const center = rational(numericParts(p)[0], numericParts(p)[1] * 2n);
  const shifted = simplify(add(symbol(variable), center));
  const rootA = squareRootOfPositiveRational(aSquared);
  const inverseA = pow(rootA, integer(-1));
  let integral: Expr = simplify(mul(inverseA, fn("atan", mul(shifted, inverseA))));
  for (let n = 2; n <= powerIndex; n++) {
    const leadingTerm = mul(
      shifted,
      rational(1n, BigInt(2 * (n - 1))),
      pow(aSquared, integer(-1)),
      pow(quadratic, integer(1 - n)),
    );
    const recurrenceScale = rational(BigInt(2 * n - 3), BigInt(2 * (n - 1)));
    integral = simplify(add(leadingTerm, mul(recurrenceScale, pow(aSquared, integer(-1)), integral)));
  }
  return integral;
}

function squareRootOfPositiveRational(value: NumericExpr): Expr {
  const [numerator, denominator] = numericParts(value);
  const numeratorRoot = integerSquareRoot(numerator);
  const denominatorRoot = integerSquareRoot(denominator);
  if (numeratorRoot !== null && denominatorRoot !== null) {
    return rational(numeratorRoot, denominatorRoot);
  }
  return fn("sqrt", value);
}

function integerSquareRoot(value: bigint): bigint | null {
  if (value < 0n) return null;
  if (value < 2n) return value;
  let low = 1n;
  let high = value;
  while (low <= high) {
    const mid = (low + high) >> 1n;
    const square = mid * mid;
    if (square === value) return mid;
    if (square < value) low = mid + 1n;
    else high = mid - 1n;
  }
  return null;
}

/** True only for a monic factor x-r with rational r. */
function isMonicLinearFactor(poly: Polynomial, variable: string): boolean {
  const leading = coefficientAt(poly, variable, 1);
  const constant = coefficientAt(poly, variable, 0);
  return numericParts(leading)[0] === numericParts(leading)[1]
    && isNumeric(constant);
}

function coefficientAt(poly: Polynomial, variable: string, exponent: number): NumericExpr {
  const coefficient = polynomialToExpr(polynomialCoefficient(poly, variable, exponent));
  if (!isNumeric(coefficient)) throw new TypeError("Expected an exact rational polynomial coefficient.");
  return coefficient;
}

function asExactNumeric(expr: Expr): NumericExpr {
  if (!isNumeric(expr)) throw new TypeError("Expected an exact rational value.");
  return expr;
}

function negateNumeric(value: NumericExpr): NumericExpr {
  const [numerator, denominator] = numericParts(value);
  return asExactNumeric(rational(-numerator, denominator));
}

/** Solve a square exact-rational system by Gauss-Jordan elimination. */
function solveExactNumericSystem(matrixInput: NumericExpr[][], size: number): NumericExpr[] | null {
  const matrix = matrixInput.map(row => [...row]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    while (pivot < size && isZero(matrix[pivot]![column]!)) pivot++;
    if (pivot === size) return null;
    if (pivot !== column) [matrix[pivot], matrix[column]] = [matrix[column]!, matrix[pivot]!];

    const pivotValue = matrix[column]![column]!;
    for (let j = column; j <= size; j++) {
      matrix[column]![j] = asExactNumeric(numericDiv(matrix[column]![j]!, pivotValue));
    }
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const multiplier = matrix[row]![column]!;
      if (isZero(multiplier)) continue;
      for (let j = column; j <= size; j++) {
        const subtract = asExactNumeric(numericMul(multiplier, matrix[column]![j]!));
        matrix[row]![j] = asExactNumeric(numericAdd(matrix[row]![j]!, negateNumeric(subtract)));
      }
    }
  }
  return matrix.map((row, index) => row[size]!);
}

function tryPolynomial(expr: Expr): Polynomial | null {
  try {
    return polynomialFromExpr(expr);
  } catch {
    return null;
  }
}

interface AffineParts {
  readonly slope: Expr;
  readonly intercept: Expr;
}

/** Returns a*x+b when the input is a polynomial of degree at most one in `variable`. */
function affineParts(expr: Expr, variable: string): AffineParts | null {
  const polynomial = tryPolynomial(expr);
  if (!polynomial) return null;
  if (polynomialDegree(polynomial, variable) > 1) return null;
  const slope = simplify(polynomialToExpr(polynomialCoefficient(polynomial, variable, 1)));
  const intercept = simplify(polynomialToExpr(polynomialCoefficient(polynomial, variable, 0)));
  return { slope, intercept };
}

/**
 * Rewrites log(|a*x+b|) to log(|c*x+d|) when both affine arguments have the
 * same zero. The change is a variable-independent additive constant, which is
 * immaterial for an indefinite primitive. Only exact affine identities are used.
 */
function normalizeEquivalentAffineLogs(
  expr: Expr,
  targetArgument: Expr,
  variable: string,
  targetLogName: string,
): Expr {
  switch (expr.kind) {
    case "Integer":
    case "Rational":
    case "Symbol":
      return expr;
    case "Add":
      return simplify(add(...expr.terms.map(term => normalizeEquivalentAffineLogs(term, targetArgument, variable, targetLogName))));
    case "Mul":
      return simplify(mul(...expr.factors.map(factor => normalizeEquivalentAffineLogs(factor, targetArgument, variable, targetLogName))));
    case "Pow":
      return simplify(pow(
        normalizeEquivalentAffineLogs(expr.base, targetArgument, variable, targetLogName),
        normalizeEquivalentAffineLogs(expr.exponent, targetArgument, variable, targetLogName),
      ));
    case "Function": {
      if ((expr.name === "log" || expr.name === "ln") && expr.args.length === 1) {
        const inner = expr.args[0]!;
        if (inner.kind === "Function" && inner.name === "abs" && inner.args.length === 1) {
          const oldArgument = inner.args[0]!;
          const oldAffine = affineParts(oldArgument, variable);
          const targetAffine = affineParts(targetArgument, variable);
          if (oldAffine && targetAffine && !isZero(oldAffine.slope) && !isZero(targetAffine.slope)) {
            const crossDifference = simplify(add(
              mul(oldAffine.slope, targetAffine.intercept),
              mul(integer(-1), targetAffine.slope, oldAffine.intercept),
            ));
            const crossPolynomial = tryPolynomial(crossDifference);
            if (isZero(crossDifference) || crossPolynomial?.terms.size === 0) {
              // The original integrand contains log(targetArgument), so its real
              // domain already requires targetArgument > 0. On that domain,
              // log(abs(oldArgument)) and log(targetArgument) differ only by a
              // constant whenever their affine arguments are proportional.
              return fn(targetLogName, targetArgument);
            }
          }
        }
      }
      return fn(expr.name, ...expr.args.map(arg => normalizeEquivalentAffineLogs(arg, targetArgument, variable, targetLogName)));
    }
  }
}

function dependsOn(expr: Expr, variable: string): boolean {
  switch (expr.kind) {
    case "Integer":
    case "Rational":
      return false;
    case "Symbol":
      return expr.name === variable;
    case "Add":
      return expr.terms.some(term => dependsOn(term, variable));
    case "Mul":
      return expr.factors.some(factor => dependsOn(factor, variable));
    case "Pow":
      return dependsOn(expr.base, variable) || dependsOn(expr.exponent, variable);
    case "Function":
      return expr.args.some(argument => dependsOn(argument, variable));
  }
}

function unsupported(expr: Expr, variable: string): IntegrationError {
  return new IntegrationError(
    `No supported elementary antiderivative found for the expression with respect to '${variable}'.`,
  );
}
