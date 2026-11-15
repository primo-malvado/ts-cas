import {
  add, equals, fn, integer, isNumeric, isZero, mul, numericParts, pow, rational, symbol,
  type Expr, type NumericExpr,
} from "../core/expr.js";
import { polynomialCoefficient, polynomialDegree, polynomialFromExpr, polynomialToExpr, isUnivariatePolynomial } from "../algebra/polynomial.js";
import { expand } from "../algebra/expand.js";
import { simplifyRational } from "../algebra/rational.js";
import { simplify } from "../algebra/simplify.js";
import { substitute } from "../algebra/substitute.js";
import { differentiate } from "./differentiate.js";
import { laurentSeries } from "./series.js";

export type LimitPoint = Expr | "infinity" | "-infinity";
export type LimitDirection = "both" | "left" | "right";
export type LimitStatus = "finite" | "positive-infinity" | "negative-infinity" | "does-not-exist" | "unsupported";
export type LimitMethod = "direct-substitution" | "l-hopital" | "polynomial-degree" | "elementary-rule" | "local-behavior" | "asymptotic-dominance" | "taylor-series";

export interface LimitResult {
  readonly status: LimitStatus;
  /** Exact expression when the limit is finite. */
  readonly value?: Expr;
  readonly method: LimitMethod;
  /** Number of applications of L'Hôpital's rule. */
  readonly lHopitalSteps: number;
  readonly message?: string;
}

interface Quotient { readonly numerator: Expr; readonly denominator: Expr }
interface LocalTerm { readonly order: number; readonly coefficient: Expr }

const MAX_RECURSION = 32;
const MAX_HOPITAL = 12;
const MAX_LOCAL_ORDER = 20;

/** Rewrite reciprocal square-root compositions while preserving their real domain. */
export function normalizeNegativeRadicalPowers(expr: Expr): Expr {
  switch (expr.kind) {
    case "Integer":
    case "Rational":
    case "Symbol":
      return expr;
    case "Add":
      return add(...expr.terms.map(normalizeNegativeRadicalPowers));
    case "Mul":
      return mul(...expr.factors.map(normalizeNegativeRadicalPowers));
    case "Function":
      return fn(expr.name, ...expr.args.map(normalizeNegativeRadicalPowers));
    case "Pow": {
      const base = normalizeNegativeRadicalPowers(expr.base);
      const exponent = normalizeNegativeRadicalPowers(expr.exponent);
      if (!isNumeric(exponent) || numericSign(exponent) !== -1) return pow(base, exponent);
      const [numerator, denominator] = numericParts(exponent);
      if (base.kind === "Function" && base.name === "sqrt" && base.args.length === 1) {
        return pow(base.args[0]!, rational(numerator, denominator * 2n));
      }
      if (base.kind === "Pow" && isNumeric(base.exponent)) {
        const [innerNumerator, innerDenominator] = numericParts(base.exponent);
        if (innerNumerator === 1n && innerDenominator === 2n) {
          return pow(base.base, rational(numerator, denominator * 2n));
        }
      }
      return pow(base, exponent);
    }
  }
}

/**
 * Computes a supported symbolic limit. Finite points accept an exact expression;
 * infinite points are written "infinity" and "-infinity". For a singular finite
 * point, direction can be "left", "right" or "both" (the default).
 *
 * The implementation uses exact direct substitution, polynomial degree comparison,
 * elementary limit rules, local Taylor-order analysis for poles, indeterminate
 * product/sum transformations, and repeated L'Hôpital steps for supported
 * 0/0 and infinity/infinity quotients.
 */
export function limit(
  expr: Expr,
  variable: string,
  point: LimitPoint,
  direction: LimitDirection = "both",
): LimitResult {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) throw new TypeError(`Invalid limit variable: ${variable}`);
  if (direction !== "both" && direction !== "left" && direction !== "right") {
    throw new TypeError(`Invalid limit direction: ${String(direction)}`);
  }
  return limitInner(normalizeNegativeRadicalPowers(simplify(expr)), variable, point, direction, 0, 0);
}

function limitInner(
  expr: Expr,
  variable: string,
  point: LimitPoint,
  direction: LimitDirection,
  depth: number,
  hopitalSteps: number,
): LimitResult {
  if (depth > MAX_RECURSION) return unsupported("Limit evaluation exceeded the recursion safety limit.", hopitalSteps);
  if (!dependsOn(expr, variable)) {
    const constant = normalizeKnownValues(simplify(expr));
    if (containsUndefinedRealValue(constant)) return doesNotExist("The expression is outside its real domain.", hopitalSteps, "direct-substitution");
    return finite(constant, "direct-substitution", hopitalSteps);
  }
  // Preserve the real-domain and sign information of negative rational powers.
  // Splitting x^(-p/q) into a generic quotient too early loses the direction of divergence.
  if (expr.kind === "Pow" && isNumeric(expr.exponent) && numericSign(expr.exponent) === -1) {
    return limitPower(expr, variable, point, direction, depth, hopitalSteps);
  }
  if (point === "infinity" || point === "-infinity") {
    return limitAtInfinity(expr, variable, point, direction, depth, hopitalSteps);
  }

  // A reciprocal of a radical (for example 1/sqrt(x)) needs the signed power
  // limit, not the generic quotient fallback which can lose fractional orders.
  if (expr.kind === "Mul" && expr.factors.some(factor => {
    if (factor.kind !== "Pow" || !isNumeric(factor.exponent)) return false;
    const [n, d] = numericParts(factor.exponent);
    return n < 0n && (factor.base.kind === "Function" || d > 1n);
  })) {
    return limitProduct(expr.factors, variable, point, direction, depth, hopitalSteps);
  }

  // Functions need their own continuity/domain rules before raw substitution.
  if (expr.kind === "Function" && expr.args.length === 1) {
    return limitFunction(expr.name, expr.args[0]!, variable, point, direction, depth, hopitalSteps);
  }

  const quotient = splitQuotient(expr);
  if (quotient) {
    return limitQuotient(quotient, variable, point, direction, depth, hopitalSteps);
  }
  if (expr.kind === "Add") {
    return limitSum(expr.terms, expr, variable, point, direction, depth, hopitalSteps);
  }
  if (expr.kind === "Mul") {
    return limitProduct(expr.factors, variable, point, direction, depth, hopitalSteps);
  }
  if (expr.kind === "Pow") {
    return limitPower(expr, variable, point, direction, depth, hopitalSteps);
  }

  try {
    const value = normalizeKnownValues(simplify(substitute(expr, { [variable]: point })));
    if (containsUndefinedRealValue(value)) {
      return doesNotExist("Direct substitution reaches an expression outside its real domain.", hopitalSteps, "direct-substitution");
    }
    return finite(value, "direct-substitution", hopitalSteps);
  } catch (error) {
    return unsupported(`Direct substitution failed: ${error instanceof Error ? error.message : String(error)}`, hopitalSteps);
  }
}

/** Resolve sums by combining component limits, with exact rewrites for indeterminate differences. */
function limitSum(
  terms: readonly Expr[],
  original: Expr,
  variable: string,
  point: LimitPoint,
  direction: LimitDirection,
  depth: number,
  hopitalSteps: number,
): LimitResult {
  const results = terms.map(term => limitInner(term, variable, point, direction, depth + 1, hopitalSteps));
  const steps = Math.max(hopitalSteps, ...results.map(result => result.lHopitalSteps));

  if (results.every(result => result.status === "finite")) {
    const method: LimitMethod = steps > hopitalSteps
      ? "l-hopital"
      : point !== "infinity" && point !== "-infinity" ? "direct-substitution" : "elementary-rule";
    return finite(add(...results.map(result => result.value!)), method, steps);
  }
  const asymptoticSum = classifyAsymptoticSum(terms, variable, point, steps);
  if (asymptoticSum) return asymptoticSum;
  if (results.some(result => result.status === "unsupported")) {
    // A rational rewrite can often remove a removable infinity-minus-infinity form.
    const rewritten = rewriteRationalExpression(original);
    if (rewritten && !equals(rewritten, original)) {
      return limitInner(rewritten, variable, point, direction, depth + 1, steps);
    }
    return unsupported(results.find(result => result.status === "unsupported")?.message ?? "A sum term is unsupported.", steps);
  }
  if (results.some(result => result.status === "does-not-exist")) {
    return doesNotExist("At least one term has no real limit along the requested approach.", steps, "elementary-rule");
  }

  const positiveInfinite = results.some(result => result.status === "positive-infinity");
  const negativeInfinite = results.some(result => result.status === "negative-infinity");
  if (positiveInfinite && !negativeInfinite) return infinityResult(true, "elementary-rule", steps);
  if (negativeInfinite && !positiveInfinite) return infinityResult(false, "elementary-rule", steps);

  if (positiveInfinite && negativeInfinite) {
    const rewritten = rewriteRationalExpression(original);
    if (rewritten && !equals(rewritten, original)) {
      return limitInner(rewritten, variable, point, direction, depth + 1, steps);
    }
    const rationalized = rationalizeRadicalSum(terms);
    if (rationalized && !equals(rationalized, original)) {
      return limitInner(rationalized, variable, point, direction, depth + 1, steps);
    }
    const exponentialDifference = classifyExponentialDifference(terms, variable, point, direction, depth, steps);
    if (exponentialDifference) return exponentialDifference;
    return unsupported("Indeterminate infinity-minus-infinity form could not be reduced by an exact rational, radical, or exponential rewrite.", steps);
  }
  return unsupported("The limit of this sum could not be classified.", steps);
}

/** Resolve products, including standard 0*infinity forms where dominance is provable. */
function limitProduct(
  factors: readonly Expr[],
  variable: string,
  point: LimitPoint,
  direction: LimitDirection,
  depth: number,
  hopitalSteps: number,
): LimitResult {
  const results = factors.map(factor => limitInner(factor, variable, point, direction, depth + 1, hopitalSteps));
  const steps = Math.max(hopitalSteps, ...results.map(result => result.lHopitalSteps));

  const zeroIndices = results.flatMap((result, index) => result.status === "finite" && isZero(simplify(result.value!)) ? [index] : []);
  const infiniteIndices = results.flatMap((result, index) => isInfiniteStatus(result.status) ? [index] : []);
  const undefinedIndices = results.flatMap((result, index) => result.status === "does-not-exist" ? [index] : []);

  // Squeeze theorem: a vanishing factor times a bounded oscillatory sin/cos factor tends to zero.
  if (zeroIndices.length === 1 && infiniteIndices.length === 0 && undefinedIndices.length === 1) {
    const zeroIndex = zeroIndices[0]!;
    const oscillatoryIndex = undefinedIndices[0]!;
    if (factors.every((_, index) => index === zeroIndex || index === oscillatoryIndex || results[index]!.status === "finite")
      && isOscillatoryAtInfinity(factors[oscillatoryIndex]!, variable, point, direction, depth, steps)) {
      const finiteRest = results.every((result, index) => index === zeroIndex || index === oscillatoryIndex || result.status === "finite");
      if (finiteRest) return finite(integer(0), "elementary-rule", steps);
    }
  }

  if (results.some(result => result.status === "unsupported")) {
    return unsupported(results.find(result => result.status === "unsupported")?.message ?? "A product factor is unsupported.", steps);
  }
  if (undefinedIndices.length > 0) {
    return doesNotExist("At least one product factor has no real limit and no supported squeeze rule applies.", steps, "elementary-rule");
  }

  if (zeroIndices.length > 0 && infiniteIndices.length > 0) {
    if (zeroIndices.length === 1 && infiniteIndices.length === 1 && results.every((result, index) =>
      index === zeroIndices[0] || index === infiniteIndices[0] || result.status === "finite" && !isZero(simplify(result.value!)))) {
      const zeroIndex = zeroIndices[0]!;
      const infiniteIndex = infiniteIndices[0]!;
      const zeroFactor = factors[zeroIndex]!;
      const infiniteFactor = factors[infiniteIndex]!;
      const classified = classifyZeroTimesInfinity(
        zeroFactor, infiniteFactor,
        results[zeroIndex]!, results[infiniteIndex]!,
        variable, point, direction, depth, steps,
      );
      if (classified) {
        if (classified.status === "finite" && isZero(simplify(classified.value!))) return classified;
        if (isInfiniteStatus(classified.status)) {
          let positive = classified.status === "positive-infinity";
          for (let index = 0; index < factors.length; index++) {
            if (index === zeroIndex || index === infiniteIndex) continue;
            const other = results[index]!;
            if (other.status !== "finite") return unsupported("Could not classify the sign of the remaining product factors.", steps);
            const sign = numericSign(other.value!);
            if (sign === null || sign === 0) return unsupported("Could not classify the sign of the remaining product factors.", steps);
            if (sign < 0) positive = !positive;
          }
          return infinityResult(positive, classified.method, steps);
        }
        return classified;
      }
    }
    return unsupported("Indeterminate zero-times-infinity product is outside the implemented dominance rules.", steps);
  }

  if (zeroIndices.length > 0) {
    const method: LimitMethod = steps === hopitalSteps && point !== "infinity" && point !== "-infinity"
      ? "direct-substitution" : "elementary-rule";
    return finite(integer(0), method, steps);
  }
  if (infiniteIndices.length > 0) {
    let positive = true;
    for (let index = 0; index < results.length; index++) {
      const result = results[index]!;
      if (isInfiniteStatus(result.status)) {
        if (result.status === "negative-infinity") positive = !positive;
        continue;
      }
      if (result.status === "finite") {
        const sign = numericSign(result.value!);
        if (sign === null || sign === 0) return unsupported("Cannot determine the sign of a finite factor multiplying infinity.", steps);
        if (sign < 0) positive = !positive;
      }
    }
    return infinityResult(positive, "elementary-rule", steps);
  }

  const method: LimitMethod = steps === hopitalSteps && point !== "infinity" && point !== "-infinity"
    ? "direct-substitution" : "elementary-rule";
  return finite(mul(...results.map(result => result.value!)), method, steps);
}

function limitPower(
  expression: Extract<Expr, { kind: "Pow" }>,
  variable: string,
  point: LimitPoint,
  direction: LimitDirection,
  depth: number,
  hopitalSteps: number,
): LimitResult {
  if (!isNumeric(expression.exponent) || dependsOn(expression.exponent, variable)) {
    return unsupported("Limits of powers with variable or unsupported exponents are not implemented.", hopitalSteps);
  }
  const [numerator, denominator] = numericParts(expression.exponent);
  if (numerator < 0n) {
    // (sqrt(u))^(p/q) = u^(p/(2q)) on the square-root domain. Rewriting this
    // exact identity exposes the local sign/order for reciprocal radicals such as 1/sqrt(x).
    if (expression.base.kind === "Function" && expression.base.name === "sqrt" && expression.base.args.length === 1) {
      return limitInner(
        pow(expression.base.args[0]!, rational(numerator, denominator * 2n)),
        variable,
        point,
        direction,
        depth + 1,
        hopitalSteps,
      );
    }
    const positivePowerLimit = limitInner(
      pow(expression.base, rational(-numerator, denominator)),
      variable,
      point,
      direction,
      depth + 1,
      hopitalSteps,
    );
    if (positivePowerLimit.status === "unsupported" || positivePowerLimit.status === "does-not-exist") return positivePowerLimit;
    if (isInfiniteStatus(positivePowerLimit.status)) return finite(integer(0), "elementary-rule", positivePowerLimit.lHopitalSteps);
    if (positivePowerLimit.status !== "finite" || !positivePowerLimit.value) {
      return unsupported("Could not classify the reciprocal of a rational power limit.", positivePowerLimit.lHopitalSteps);
    }

    const positiveValue = normalizeKnownValues(simplify(positivePowerLimit.value));
    if (!isZero(positiveValue)) {
      const reciprocal = normalizeKnownValues(simplify(pow(positiveValue, integer(-1))));
      if (containsUndefinedRealValue(reciprocal)) {
        return doesNotExist("The negative rational power is outside its real domain.", positivePowerLimit.lHopitalSteps, "elementary-rule");
      }
      return finite(reciprocal, point === "infinity" || point === "-infinity" ? "elementary-rule" : "direct-substitution", positivePowerLimit.lHopitalSteps);
    }

    const signForSide = (side: "left" | "right"): -1 | 0 | 1 | null =>
      point === "infinity" || point === "-infinity"
        ? signAtInfinity(expression.base, variable, point)
        : signNearPoint(expression.base, variable, point, side);
    const divergenceForSign = (baseSign: -1 | 0 | 1 | null): boolean | null => {
      if (baseSign === null || baseSign === 0) return null;
      if (denominator % 2n === 0n && baseSign < 0) return null;
      return denominator % 2n === 1n && (-numerator) % 2n === 1n && baseSign < 0;
    };

    if (point === "infinity" || point === "-infinity") {
      const baseSign = signForSide("right");
      const divergenceNegative = divergenceForSign(baseSign);
      if (divergenceNegative === null) {
        return doesNotExist("The negative rational power is not real or its sign could not be certified near infinity.", positivePowerLimit.lHopitalSteps, "elementary-rule");
      }
      return infinityResult(!divergenceNegative, "elementary-rule", positivePowerLimit.lHopitalSteps);
    }

    if (direction === "left" || direction === "right") {
      const baseSign = signForSide(direction);
      const divergenceNegative = divergenceForSign(baseSign);
      if (divergenceNegative === null) {
        return doesNotExist("The negative rational power is not real on the requested side, or its local sign is unknown.", positivePowerLimit.lHopitalSteps, "elementary-rule");
      }
      return infinityResult(!divergenceNegative, "elementary-rule", positivePowerLimit.lHopitalSteps);
    }

    const leftSign = signForSide("left");
    const rightSign = signForSide("right");
    const leftNegative = divergenceForSign(leftSign);
    const rightNegative = divergenceForSign(rightSign);
    if (leftNegative === null || rightNegative === null) {
      return doesNotExist("The negative rational power is not real on both sides of the limit point.", positivePowerLimit.lHopitalSteps, "elementary-rule");
    }
    if (leftNegative !== rightNegative) {
      return doesNotExist("The negative rational power diverges with opposite signs from the left and right.", positivePowerLimit.lHopitalSteps, "elementary-rule");
    }
    return infinityResult(!leftNegative, "elementary-rule", positivePowerLimit.lHopitalSteps);
  }
  if (numerator === 0n) return finite(integer(1), "elementary-rule", hopitalSteps);

  const baseLimit = limitInner(expression.base, variable, point, direction, depth + 1, hopitalSteps);
  if (baseLimit.status === "unsupported" || baseLimit.status === "does-not-exist") return baseLimit;
  if (baseLimit.status === "finite") {
    const baseValue = normalizeKnownValues(simplify(baseLimit.value!));
    if (isZero(baseValue)) {
      if (denominator % 2n === 0n && point !== "infinity" && point !== "-infinity") {
        const leftSign = signNearPoint(expression.base, variable, point, "left");
        const rightSign = signNearPoint(expression.base, variable, point, "right");
        if ((direction === "left" && leftSign === -1)
          || (direction === "right" && rightSign === -1)
          || (direction === "both" && (leftSign === -1 || rightSign === -1))) {
          return doesNotExist("The rational power has no real values on one side of the limit point.", baseLimit.lHopitalSteps, "elementary-rule");
        }
        if ((direction === "left" && leftSign === null)
          || (direction === "right" && rightSign === null)
          || (direction === "both" && (leftSign === null || rightSign === null))) {
          return unsupported("Could not determine the real domain of the rational power near the limit point.", baseLimit.lHopitalSteps);
        }
      }
      return finite(integer(0), "elementary-rule", baseLimit.lHopitalSteps);
    }
    const baseSign = numericSign(baseValue);
    if (denominator % 2n === 0n && baseSign !== null && baseSign < 0) {
      return doesNotExist("An even-denominator rational power is not real for a negative base.", baseLimit.lHopitalSteps, "elementary-rule");
    }
    try {
      const value = normalizeKnownValues(simplify(pow(baseValue, expression.exponent)));
      if (containsUndefinedRealValue(value)) return doesNotExist("The power is outside its real domain.", baseLimit.lHopitalSteps, "elementary-rule");
      const method: LimitMethod = point !== "infinity" && point !== "-infinity"
        ? "direct-substitution" : "elementary-rule";
      return finite(value, method, baseLimit.lHopitalSteps);
    } catch {
      return doesNotExist("The power is outside its real domain.", baseLimit.lHopitalSteps, "elementary-rule");
    }
  }
  if (baseLimit.status === "negative-infinity" && denominator % 2n === 0n) {
    return doesNotExist("An even-denominator rational power is not real for a base tending to negative infinity.", baseLimit.lHopitalSteps, "elementary-rule");
  }
  const isEven = numerator % 2n === 0n;
  if (baseLimit.status === "positive-infinity" || denominator % 2n === 0n || isEven) {
    return infinityResult(true, "elementary-rule", baseLimit.lHopitalSteps);
  }
  return infinityResult(false, "elementary-rule", baseLimit.lHopitalSteps);
}

function classifyZeroTimesInfinity(
  zeroFactor: Expr,
  infiniteFactor: Expr,
  zeroLimit: LimitResult,
  infiniteLimit: LimitResult,
  variable: string,
  point: LimitPoint,
  direction: LimitDirection,
  depth: number,
  hopitalSteps: number,
): LimitResult | null {
  // Any positive algebraic order dominates a logarithmic divergence at a finite endpoint:
  // (x-a)^r log(x-a) -> 0 as x -> a+ for r > 0.
  if (point !== "infinity" && point !== "-infinity" && isLogarithmicExpression(infiniteFactor)) {
    const order = vanishingOrder(zeroFactor, variable, point);
    if (order !== null && order > 0) return finite(integer(0), "elementary-rule", hopitalSteps);
  }

  // Exponential decay dominates polynomial growth at infinity, and exponential growth
  // dominates a finite-order zero at a finite point.
  if (zeroFactor.kind === "Function" && zeroFactor.name === "exp" && zeroFactor.args.length === 1) {
    const argumentLimit = limitInner(zeroFactor.args[0]!, variable, point, direction, depth + 1, hopitalSteps);
    if (argumentLimit.status === "negative-infinity" && (point === "infinity" || point === "-infinity")
      && tryUnivariatePolynomial(infiniteFactor, variable)) {
      return finite(integer(0), "elementary-rule", hopitalSteps);
    }
  }

  if (infiniteFactor.kind === "Function" && infiniteFactor.name === "exp" && infiniteFactor.args.length === 1
    && point !== "infinity" && point !== "-infinity") {
    const argumentLimit = limitInner(infiniteFactor.args[0]!, variable, point, direction, depth + 1, hopitalSteps);
    if (argumentLimit.status === "positive-infinity") {
      const sideSign = signNearPoint(zeroFactor, variable, point, direction);
      if (sideSign === null) return null;
      if (sideSign === 0) return finite(integer(0), "elementary-rule", hopitalSteps);
      if (sideSign === 1 || sideSign === -1) {
        if (direction === "both") {
          const leftSign = signNearPoint(zeroFactor, variable, point, "left");
          const rightSign = signNearPoint(zeroFactor, variable, point, "right");
          if (leftSign !== null && rightSign !== null && leftSign !== rightSign) {
            return doesNotExist("The exponential dominates the zero factor with opposite signs on the two sides.", hopitalSteps, "local-behavior");
          }
        }
        return infinityResult(sideSign > 0, "local-behavior", hopitalSteps);
      }
    }
    if (argumentLimit.status === "negative-infinity") return finite(integer(0), "elementary-rule", hopitalSteps);
  }

  // A bounded trig factor can be squeezed by any factor tending to zero.
  if (isOscillatoryAtInfinity(infiniteFactor, variable, point, direction, depth, hopitalSteps)) {
    return finite(integer(0), "elementary-rule", hopitalSteps);
  }

  return null;
}

function isLogarithmicExpression(expr: Expr): boolean {
  if (expr.kind === "Function") return expr.name === "log" || expr.name === "ln";
  if (expr.kind === "Pow" && expr.exponent.kind === "Integer" && expr.exponent.value > 0n) {
    return isLogarithmicExpression(expr.base);
  }
  return false;
}

/** Returns a positive real power order when the expression vanishes algebraically at a finite point. */
function vanishingOrder(expr: Expr, variable: string, point: Expr): number | null {
  const local = leadingLocalTerm(expr, variable, point);
  if (local && local.order > 0) return local.order;
  if (expr.kind === "Function" && expr.name === "sqrt" && expr.args.length === 1) {
    const argumentOrder = vanishingOrder(expr.args[0]!, variable, point);
    return argumentOrder !== null && argumentOrder > 0 ? argumentOrder / 2 : null;
  }
  if (expr.kind === "Pow" && isNumeric(expr.exponent)) {
    const exponentSign = numericSign(expr.exponent);
    if (exponentSign === null || exponentSign <= 0) return null;
    const baseOrder = vanishingOrder(expr.base, variable, point);
    if (baseOrder !== null && baseOrder > 0) {
      const [numerator, denominator] = numericParts(expr.exponent);
      return baseOrder * Number(numerator) / Number(denominator);
    }
  }
  if (expr.kind === "Mul") {
    let total = 0;
    let sawOrder = false;
    for (const factor of expr.factors) {
      if (isNumeric(factor) && !isZero(factor)) continue;
      const order = vanishingOrder(factor, variable, point);
      if (order === null) return null;
      total += order;
      sawOrder = true;
    }
    return sawOrder ? total : null;
  }
  return null;
}

function signNearPoint(expr: Expr, variable: string, point: Expr, direction: LimitDirection): -1 | 0 | 1 | null {
  const local = leadingLocalTerm(expr, variable, point);
  if (!local) return numericSign(evaluateAt(expr, variable, point) ?? integer(0));
  const coefficientSign = numericSign(local.coefficient);
  if (coefficientSign === null || coefficientSign === 0) return coefficientSign;
  if (direction === "right") return coefficientSign;
  if (direction === "left") return local.order % 2 === 0 ? coefficientSign : coefficientSign === 1 ? -1 : 1;
  return local.order % 2 === 0 ? coefficientSign : null;
}

function isOscillatoryAtInfinity(
  expr: Expr,
  variable: string,
  point: LimitPoint,
  direction: LimitDirection,
  depth: number,
  hopitalSteps: number,
): boolean {
  if (expr.kind !== "Function" || (expr.name !== "sin" && expr.name !== "cos") || expr.args.length !== 1) return false;
  const argument = limitInner(expr.args[0]!, variable, point, direction, depth + 1, hopitalSteps);
  return isInfiniteStatus(argument.status);
}

function rewriteRationalExpression(expr: Expr): Expr | null {
  const result = simplifyRational(expr);
  if (!result.expression || result.status === "undefined" || result.status === "unsupported") return null;
  return result.expression;
}

/** Rationalize a two-term sum containing sqrt(A): sqrt(A)+B = (A-B^2)/(sqrt(A)-B). */
function rationalizeRadicalSum(terms: readonly Expr[]): Expr | null {
  if (terms.length !== 2) return null;
  for (let index = 0; index < terms.length; index++) {
    const signedRadical = splitSignedSquareRoot(terms[index]!);
    const other = terms[1 - index]!;
    if (!signedRadical) continue;
    const otherSquared = normalizeKnownValues(simplify(expand(pow(other, integer(2)))));
    const radicand = signedRadical.radicand;
    const numerator = signedRadical.sign > 0
      ? normalizeKnownValues(simplify(expand(add(radicand, mul(integer(-1), otherSquared)))))
      : normalizeKnownValues(simplify(expand(add(otherSquared, mul(integer(-1), radicand)))));
    const radical = signedRadical.radical;
    const denominator = signedRadical.sign > 0
      ? simplify(add(radical, mul(integer(-1), other)))
      : simplify(add(other, radical));
    if (isZero(numerator)) return integer(0);
    if (isZero(denominator)) continue;
    return simplify(mul(numerator, pow(denominator, integer(-1))));
  }
  return null;
}

function splitSignedSquareRoot(expr: Expr): { readonly sign: 1 | -1; readonly radicand: Expr; readonly radical: Expr } | null {
  const direct = squareRootArgument(expr);
  if (direct) return { sign: 1, radicand: direct, radical: expr };
  if (expr.kind !== "Mul") return null;
  const coefficientIndex = expr.factors.findIndex(isNumeric);
  if (coefficientIndex < 0) return null;
  const coefficient = expr.factors[coefficientIndex]!;
  const sign = numericSign(coefficient);
  if (sign !== -1) return null;
  const [n, d] = numericParts(coefficient as NumericExpr);
  if (n !== -d) return null;
  const remaining = expr.factors.filter((_, index) => index !== coefficientIndex);
  const base = remaining.length === 1 ? remaining[0]! : mul(...remaining);
  const radicand = squareRootArgument(base);
  return radicand ? { sign: -1, radicand, radical: base } : null;
}

function signedExponentialTerm(expr: Expr): { readonly sign: 1 | -1; readonly argument: Expr } | null {
  if (expr.kind === "Function" && expr.name === "exp" && expr.args.length === 1) {
    return { sign: 1, argument: expr.args[0]! };
  }
  if (expr.kind !== "Mul") return null;
  const coefficientIndex = expr.factors.findIndex(isNumeric);
  if (coefficientIndex < 0) return null;
  const coefficient = expr.factors[coefficientIndex]!;
  const [n, d] = numericParts(coefficient as NumericExpr);
  if (n !== d && n !== -d) return null;
  const remaining = expr.factors.filter((_, index) => index !== coefficientIndex);
  if (remaining.length !== 1 || remaining[0]!.kind !== "Function"
    || remaining[0]!.name !== "exp" || remaining[0]!.args.length !== 1) return null;
  return { sign: n > 0n ? 1 : -1, argument: remaining[0]!.args[0]! };
}

function classifyExponentialDifference(
  terms: readonly Expr[],
  variable: string,
  point: LimitPoint,
  direction: LimitDirection,
  depth: number,
  hopitalSteps: number,
): LimitResult | null {
  if (terms.length !== 2) return null;
  const left = signedExponentialTerm(terms[0]!);
  const right = signedExponentialTerm(terms[1]!);
  if (!left || !right || left.sign === right.sign) return null;
  const positiveTerm = left.sign > 0 ? left : right;
  const negativeTerm = left.sign < 0 ? left : right;
  const delta = simplify(add(positiveTerm.argument, mul(integer(-1), negativeTerm.argument)));
  if (isZero(delta)) return finite(integer(0), "elementary-rule", hopitalSteps);

  const deltaLimit = limitInner(delta, variable, point, direction, depth + 1, hopitalSteps);
  const steps = Math.max(hopitalSteps, deltaLimit.lHopitalSteps);
  if (deltaLimit.status === "finite") {
    const deltaSign = numericSign(deltaLimit.value!);
    if (deltaSign === null || deltaSign === 0) return null;
    const commonExponentLimit = limitInner(negativeTerm.argument, variable, point, direction, depth + 1, steps);
    if (commonExponentLimit.status === "positive-infinity") {
      return infinityResult(deltaSign > 0, "elementary-rule", Math.max(steps, commonExponentLimit.lHopitalSteps));
    }
    return null;
  }

  if (deltaLimit.status === "positive-infinity" || deltaLimit.status === "negative-infinity") {
    const positiveExponentLimit = limitInner(positiveTerm.argument, variable, point, direction, depth + 1, steps);
    const negativeExponentLimit = limitInner(negativeTerm.argument, variable, point, direction, depth + 1, steps);
    if (positiveExponentLimit.status === "positive-infinity" && negativeExponentLimit.status === "positive-infinity") {
      return infinityResult(deltaLimit.status === "positive-infinity", "elementary-rule", Math.max(steps, positiveExponentLimit.lHopitalSteps, negativeExponentLimit.lHopitalSteps));
    }
  }
  return null;
}

function squareRootArgument(expr: Expr): Expr | null {
  if (expr.kind === "Function" && expr.name === "sqrt" && expr.args.length === 1) return expr.args[0]!;
  if (expr.kind === "Pow" && isNumeric(expr.exponent)) {
    const [numerator, denominator] = numericParts(expr.exponent);
    if (numerator === 1n && denominator === 2n) return expr.base;
  }
  return null;
}

function limitQuotient(
  quotient: Quotient,
  variable: string,
  point: LimitPoint,
  direction: LimitDirection,
  depth: number,
  hopitalSteps: number,
): LimitResult {
  if (point === "infinity" || point === "-infinity") {
    const asymptoticQuotient = classifyAsymptoticQuotient(quotient, variable, point, hopitalSteps);
    if (asymptoticQuotient) return asymptoticQuotient;
  }
  if (equals(quotient.numerator, quotient.denominator)) {
    return finite(integer(1), "direct-substitution", hopitalSteps);
  }

  const numerator = limitInner(quotient.numerator, variable, point, direction, depth + 1, hopitalSteps);
  const denominator = limitInner(quotient.denominator, variable, point, direction, depth + 1, hopitalSteps);

  if (numerator.status === "unsupported" || denominator.status === "unsupported") {
    return unsupported(numerator.message ?? denominator.message ?? "Could not evaluate quotient components.", hopitalSteps);
  }
  if (numerator.status === "does-not-exist" || denominator.status === "does-not-exist") {
    return doesNotExist("At least one part of the quotient has no supported real limit.", hopitalSteps, "local-behavior");
  }

  const numInfinite = isInfiniteStatus(numerator.status);
  const denInfinite = isInfiniteStatus(denominator.status);
  const numZero = numerator.status === "finite" && isZero(simplify(numerator.value!));
  const denZero = denominator.status === "finite" && isZero(simplify(denominator.value!));

  if (numerator.status === "finite" && denominator.status === "finite") {
    if (!denZero) {
      return finite(simplify(mul(numerator.value!, pow(denominator.value!, integer(-1)))), "direct-substitution", hopitalSteps);
    }
    if (numZero) {
      const hopital = tryHopital(quotient, variable, point, direction, depth, hopitalSteps);
      if (hopital && hopital.status !== "unsupported") return hopital;
      if (point !== "infinity" && point !== "-infinity") {
        const bySeries = classifyQuotientBySeries(quotient, variable, point, direction, hopitalSteps);
        if (bySeries) return bySeries;
      }
      if (hopital) return hopital;
    }
    if (point === "infinity" || point === "-infinity") {
      const numeratorSign = numericSign(numerator.value!);
      const denominatorSign = signAtInfinity(quotient.denominator, variable, point);
      if (!numZero && numeratorSign !== null && denominatorSign !== null && denominatorSign !== 0) {
        return infinityResult((numeratorSign > 0) === (denominatorSign > 0), "elementary-rule", hopitalSteps);
      }
      return unsupported("Could not determine the quotient behavior at infinity after a zero denominator limit.", hopitalSteps);
    }
    return classifyQuotientPole(quotient, variable, point, direction, hopitalSteps);
  }

  if (numerator.status === "finite" && denInfinite) {
    return finite(integer(0), numerator.method === "l-hopital" ? "l-hopital" : "elementary-rule", hopitalSteps);
  }
  if (numInfinite && denominator.status === "finite") {
    if (denZero) return unsupported("The quotient has an infinite numerator and a denominator tending to zero; sign analysis is not supported for this form.", hopitalSteps);
    const denominatorSign = numericSign(normalizeKnownValues(denominator.value!));
    if (denominatorSign === null || denominatorSign === 0) return unsupported("Cannot determine the sign of the finite denominator.", hopitalSteps);
    const numeratorPositive = numerator.status === "positive-infinity";
    const positive = numeratorPositive === (denominatorSign > 0);
    return infinityResult(positive, "elementary-rule", hopitalSteps);
  }
  if (numInfinite && denInfinite) {
    const hopital = tryHopital(quotient, variable, point, direction, depth, hopitalSteps);
    if (hopital) return hopital;
    // Identical or symbolically equal leading behavior may not be reduced by
    // differentiation; do not fabricate a result in that case.
  }
  return unsupported("The quotient limit could not be classified by the implemented rules.", hopitalSteps);
}

function tryHopital(
  quotient: Quotient,
  variable: string,
  point: LimitPoint,
  direction: LimitDirection,
  depth: number,
  hopitalSteps: number,
): LimitResult | null {
  if (hopitalSteps >= MAX_HOPITAL) return unsupported("L'Hôpital's rule reached the maximum number of iterations.", hopitalSteps);
  try {
    const numeratorDerivative = simplify(differentiate(quotient.numerator, variable));
    const denominatorDerivative = simplify(differentiate(quotient.denominator, variable));
    if (isZero(denominatorDerivative)) return null;
    if (equals(numeratorDerivative, quotient.numerator) && equals(denominatorDerivative, quotient.denominator)) return null;
    const derivativeQuotient = simplify(mul(numeratorDerivative, pow(denominatorDerivative, integer(-1))));
    const result = limitInner(derivativeQuotient, variable, point, direction, depth + 1, hopitalSteps + 1);
    return {
      ...result,
      method: result.method === "taylor-series" ? "taylor-series" : "l-hopital",
      lHopitalSteps: Math.max(result.lHopitalSteps, hopitalSteps + 1),
    };
  } catch {
    return null;
  }
}

function classifyQuotientPole(
  quotient: Quotient,
  variable: string,
  point: Expr,
  direction: LimitDirection,
  hopitalSteps: number,
): LimitResult {
  const numeratorTerm = leadingLocalTerm(quotient.numerator, variable, point);
  const denominatorTerm = leadingLocalTerm(quotient.denominator, variable, point);
  if (!numeratorTerm || !denominatorTerm) {
    return unsupported("Could not determine the leading local behavior of a singular quotient.", hopitalSteps);
  }
  const orderDifference = denominatorTerm.order - numeratorTerm.order;
  const coefficient = normalizeKnownValues(simplify(mul(
    numeratorTerm.coefficient,
    pow(denominatorTerm.coefficient, integer(-1)),
  )));
  if (orderDifference <= 0) {
    if (orderDifference < 0) return finite(integer(0), "local-behavior", hopitalSteps);
    return finite(coefficient, "local-behavior", hopitalSteps);
  }
  const coefficientSign = numericSign(coefficient);
  if (coefficientSign === null || coefficientSign === 0) {
    return unsupported("The sign of the leading quotient coefficient is not known exactly.", hopitalSteps);
  }
  const rightPositive = coefficientSign > 0;
  const leftPositive = orderDifference % 2 === 0 ? rightPositive : !rightPositive;
  if (direction === "right") return infinityResult(rightPositive, "local-behavior", hopitalSteps);
  if (direction === "left") return infinityResult(leftPositive, "local-behavior", hopitalSteps);
  if (rightPositive === leftPositive) return infinityResult(rightPositive, "local-behavior", hopitalSteps);
  return doesNotExist("The left- and right-hand limits diverge with opposite signs.", hopitalSteps, "local-behavior");
}

function limitFunction(
  name: string,
  argument: Expr,
  variable: string,
  point: LimitPoint,
  direction: LimitDirection,
  depth: number,
  hopitalSteps: number,
): LimitResult {
  const argumentLimit = limitInner(argument, variable, point, direction, depth + 1, hopitalSteps);
  if (argumentLimit.status === "unsupported" || argumentLimit.status === "does-not-exist") {
    return { ...argumentLimit, message: argumentLimit.message ?? `The argument limit of ${name} could not be evaluated.` };
  }

  if (argumentLimit.status === "positive-infinity" || argumentLimit.status === "negative-infinity") {
    switch (name) {
      case "exp":
        return argumentLimit.status === "positive-infinity"
          ? infinityResult(true, "elementary-rule", hopitalSteps)
          : finite(integer(0), "elementary-rule", hopitalSteps);
      case "log":
      case "ln":
      case "sqrt":
        return argumentLimit.status === "positive-infinity"
          ? infinityResult(true, "elementary-rule", hopitalSteps)
          : doesNotExist(`The real-valued ${name} is not defined for arguments tending to negative infinity.`, hopitalSteps, "elementary-rule");
      case "abs":
        return infinityResult(true, "elementary-rule", hopitalSteps);
      case "sign":
        return finite(integer(argumentLimit.status === "positive-infinity" ? 1 : -1), "elementary-rule", hopitalSteps);
      case "atan":
        return finite(mul(integer(argumentLimit.status === "positive-infinity" ? 1 : -1), rational(1n, 2n), symbol("pi")), "elementary-rule", hopitalSteps);
      case "sin":
      case "cos":
      case "tan":
        return doesNotExist(`${name} of an argument tending to infinity has no two-sided real limit under the implemented rules.`, hopitalSteps, "elementary-rule");
      default:
        return unsupported(`Limit rule for '${name}' at infinity is not implemented.`, hopitalSteps);
    }
  }

  const value = normalizeKnownValues(simplify(argumentLimit.value!));
  if (name === "sign") {
    const sign = numericSign(value);
    if (sign !== null && sign !== 0) return finite(integer(sign), "elementary-rule", hopitalSteps);
    if (sign === 0) {
      if (point === "infinity" || point === "-infinity") return unsupported("Could not classify sign at infinity.", hopitalSteps);
      const local = leadingLocalTerm(argument, variable, point);
      if (!local) return unsupported("Could not determine the sign change near the limit point.", hopitalSteps);
      const coefficientSign = numericSign(local.coefficient);
      if (coefficientSign === null || coefficientSign === 0) return unsupported("Could not determine the sign of the leading local term.", hopitalSteps);
      const rightPositive = coefficientSign > 0;
      const leftPositive = local.order % 2 === 0 ? rightPositive : !rightPositive;
      if (direction === "right") return finite(integer(rightPositive ? 1 : -1), "elementary-rule", hopitalSteps);
      if (direction === "left") return finite(integer(leftPositive ? 1 : -1), "elementary-rule", hopitalSteps);
      return rightPositive === leftPositive
        ? finite(integer(rightPositive ? 1 : -1), "elementary-rule", hopitalSteps)
        : doesNotExist("The sign function has different one-sided limits.", hopitalSteps, "elementary-rule");
    }
  }
  if (name === "log" || name === "ln") {
    const sign = numericSign(value);
    if (sign !== null && sign < 0) return doesNotExist(`${name} is not real for a negative argument.`, hopitalSteps, "elementary-rule");
    if (sign === 0) {
      if (argument.kind === "Function" && argument.name === "abs") {
        return infinityResult(false, "elementary-rule", hopitalSteps);
      }
      if (point === "infinity" || point === "-infinity") {
        const approachSign = signAtInfinity(argument, variable, point);
        if (approachSign === null || approachSign === 0) return unsupported(`Cannot determine how the argument of ${name} approaches zero at infinity.`, hopitalSteps);
        return approachSign > 0
          ? infinityResult(false, "elementary-rule", hopitalSteps)
          : doesNotExist(`${name} is not real for a negative argument near infinity.`, hopitalSteps, "elementary-rule");
      }
      const local = leadingLocalTerm(argument, variable, point);
      if (!local) return unsupported(`Cannot determine which side of zero the argument of ${name} approaches from.`, hopitalSteps);
      const coeffSign = numericSign(local.coefficient);
      if (coeffSign === null || coeffSign === 0) return unsupported(`Cannot determine the sign of the argument of ${name} near the limit point.`, hopitalSteps);
      const rightPositive = coeffSign > 0;
      const leftPositive = local.order % 2 === 0 ? rightPositive : !rightPositive;
      if (direction === "right") return rightPositive ? infinityResult(false, "elementary-rule", hopitalSteps) : doesNotExist(`${name} is not real on the right of the limit point.`, hopitalSteps, "elementary-rule");
      if (direction === "left") return leftPositive ? infinityResult(false, "elementary-rule", hopitalSteps) : doesNotExist(`${name} is not real on the left of the limit point.`, hopitalSteps, "elementary-rule");
      if (rightPositive && leftPositive) return infinityResult(false, "elementary-rule", hopitalSteps);
      return doesNotExist(`${name}'s real domain does not include a full neighbourhood of the limit point.`, hopitalSteps, "elementary-rule");
    }
    return finite(normalizeKnownValues(fn(name, value)), "elementary-rule", hopitalSteps);
  }
  if (name === "sqrt") {
    const sign = numericSign(value);
    if (sign !== null && sign < 0) return doesNotExist("The real square root is not defined for a negative argument.", hopitalSteps, "elementary-rule");
    if (sign === 0) {
      if (argument.kind === "Function" && argument.name === "abs") return finite(integer(0), "elementary-rule", hopitalSteps);
      if (point === "infinity" || point === "-infinity") {
        const approachSign = signAtInfinity(argument, variable, point);
        if (approachSign === null || approachSign === 0) return unsupported("Cannot determine the sign of the square-root argument near infinity.", hopitalSteps);
        return approachSign > 0
          ? finite(integer(0), "elementary-rule", hopitalSteps)
          : doesNotExist("The square-root argument is negative near infinity.", hopitalSteps, "elementary-rule");
      }
      const local = leadingLocalTerm(argument, variable, point);
      if (!local) return finite(integer(0), "elementary-rule", hopitalSteps);
      const coeffSign = numericSign(local.coefficient);
      if (coeffSign === null || coeffSign === 0) return unsupported("Cannot determine the sign of the square-root argument near the limit point.", hopitalSteps);
      const rightPositive = coeffSign > 0;
      const leftPositive = local.order % 2 === 0 ? rightPositive : !rightPositive;
      if (direction === "right") return rightPositive ? finite(integer(0), "elementary-rule", hopitalSteps) : doesNotExist("The square-root argument is negative on the right of the limit point.", hopitalSteps, "elementary-rule");
      if (direction === "left") return leftPositive ? finite(integer(0), "elementary-rule", hopitalSteps) : doesNotExist("The square-root argument is negative on the left of the limit point.", hopitalSteps, "elementary-rule");
      return rightPositive && leftPositive
        ? finite(integer(0), "elementary-rule", hopitalSteps)
        : doesNotExist("The real square-root argument is negative on one side of the limit point.", hopitalSteps, "elementary-rule");
    }
  }
  return finite(normalizeKnownValues(fn(name, value)), "elementary-rule", hopitalSteps);
}

function limitAtInfinity(
  expr: Expr,
  variable: string,
  point: "infinity" | "-infinity",
  direction: LimitDirection,
  depth: number,
  hopitalSteps: number,
): LimitResult {
  const quotient = splitQuotient(expr);
  const numerator = quotient?.numerator ?? expr;
  const denominator = quotient?.denominator ?? integer(1);
  const numeratorPolynomial = tryUnivariatePolynomial(numerator, variable);
  const denominatorPolynomial = tryUnivariatePolynomial(denominator, variable);
  if (numeratorPolynomial && denominatorPolynomial) {
    const numeratorDegree = polynomialDegree(numeratorPolynomial, variable);
    const denominatorDegree = polynomialDegree(denominatorPolynomial, variable);
    if (denominatorDegree < 0) return doesNotExist("The denominator is identically zero.", hopitalSteps, "polynomial-degree");
    if (numeratorDegree < 0 || numeratorDegree < denominatorDegree) {
      return finite(integer(0), "polynomial-degree", hopitalSteps);
    }
    const numeratorLeading = polynomialToExpr(polynomialCoefficient(numeratorPolynomial, variable, numeratorDegree));
    const denominatorLeading = polynomialToExpr(polynomialCoefficient(denominatorPolynomial, variable, denominatorDegree));
    const leadingRatio = normalizeKnownValues(simplify(mul(numeratorLeading, pow(denominatorLeading, integer(-1)))));
    if (numeratorDegree === denominatorDegree) return finite(leadingRatio, "polynomial-degree", hopitalSteps);
    const sign = numericSign(leadingRatio);
    if (sign === null || sign === 0) return unsupported("Cannot determine the leading coefficient sign for an infinite polynomial limit.", hopitalSteps);
    const parityFactor = point === "-infinity" && (numeratorDegree - denominatorDegree) % 2 === 1 ? -1 : 1;
    return infinityResult(sign * parityFactor > 0, "polynomial-degree", hopitalSteps);
  }

  if (quotient) {
    const asymptoticQuotient = classifyAsymptoticQuotient(quotient, variable, point, hopitalSteps);
    if (asymptoticQuotient) return asymptoticQuotient;
    return limitQuotient(quotient, variable, point, direction, depth + 1, hopitalSteps);
  }

  if (expr.kind === "Function" && expr.args.length === 1) {
    return limitFunction(expr.name, expr.args[0]!, variable, point, direction, depth + 1, hopitalSteps);
  }
  if (expr.kind === "Add") {
    return limitSum(expr.terms, expr, variable, point, direction, depth + 1, hopitalSteps);
  }
  if (expr.kind === "Mul" || expr.kind === "Pow") {
    const asymptoticExpression = classifyAsymptoticExpression(expr, variable, point, hopitalSteps);
    if (asymptoticExpression) return asymptoticExpression;
  }
  if (expr.kind === "Mul") {
    return limitProduct(expr.factors, variable, point, direction, depth + 1, hopitalSteps);
  }
  if (expr.kind === "Pow") {
    return limitPower(expr, variable, point, direction, depth + 1, hopitalSteps);
  }
  return unsupported("Limit at infinity is supported for univariate rational functions, selected sums/products, and elementary functions.", hopitalSteps);
}

interface PolynomialTail {
  readonly degree: number;
  readonly leading: Expr;
  /** Sign of the polynomial for the requested direction at infinity. */
  readonly sign: -1 | 0 | 1;
  readonly magnitude: Expr;
}

interface AsymptoticSignature {
  /** Polynomial exponent inside a product of exponentials, with constant terms removed. */
  readonly exponentialArgument: Expr | null;
  /** Power of |x| in the algebraic part. */
  readonly polynomialOrder: number;
  /** Power of log(|x|) in the slowly varying part. */
  readonly logarithmOrder: number;
  /** Positive leading magnitude, excluding the sign and exponential argument. */
  readonly magnitude: Expr;
  /** Eventual sign of the expression, or null when it cannot be proved. */
  readonly sign: -1 | 0 | 1 | null;
  /** True for bounded oscillatory expressions such as sin(x). */
  readonly oscillatory: boolean;
}

/**
 * Extracts the exact leading term of a univariate polynomial at +/- infinity.
 * A symbolic leading coefficient is intentionally rejected: without assumptions
 * about its sign, assigning an infinite-limit sign would be unsafe.
 */
function polynomialTail(expr: Expr, variable: string, point: "infinity" | "-infinity"): PolynomialTail | null {
  const polynomial = tryUnivariatePolynomial(expr, variable);
  if (!polynomial) return null;
  const degree = polynomialDegree(polynomial, variable);
  if (degree < 0) return { degree: -1, leading: integer(0), sign: 0, magnitude: integer(0) };
  const leading = normalizeKnownValues(polynomialToExpr(polynomialCoefficient(polynomial, variable, degree)));
  if (!isNumeric(leading)) return null;
  const [n, d] = numericParts(leading);
  if (n === 0n) return null;
  let sign: -1 | 1 = n < 0n ? -1 : 1;
  if (point === "-infinity" && degree % 2 === 1) sign = sign === 1 ? -1 : 1;
  return {
    degree,
    leading,
    sign,
    magnitude: rational(n < 0n ? -n : n, d),
  };
}

function signatureFromPolynomial(expr: Expr, variable: string, point: "infinity" | "-infinity"): AsymptoticSignature | null {
  const tail = polynomialTail(expr, variable, point);
  if (!tail) return null;
  return {
    exponentialArgument: null,
    polynomialOrder: Math.max(0, tail.degree),
    logarithmOrder: 0,
    magnitude: tail.magnitude,
    sign: tail.sign,
    oscillatory: false,
  };
}

function asymptoticSignature(
  expr: Expr,
  variable: string,
  point: "infinity" | "-infinity",
  depth = 0,
): AsymptoticSignature | null {
  if (depth > 24) return null;

  const polynomial = tryUnivariatePolynomial(expr, variable);
  if (polynomial) return signatureFromPolynomial(expr, variable, point);

  if (expr.kind === "Mul") {
    let polynomialOrder = 0;
    let logarithmOrder = 0;
    let magnitude: Expr = integer(1);
    let sign: -1 | 0 | 1 | null = 1;
    let oscillatory = false;
    const exponentialArguments: Expr[] = [];
    for (const factor of expr.factors) {
      const part = asymptoticSignature(factor, variable, point, depth + 1);
      if (!part) return null;
      polynomialOrder += part.polynomialOrder;
      logarithmOrder += part.logarithmOrder;
      magnitude = simplify(mul(magnitude, part.magnitude));
      if (sign === null || part.sign === null) sign = null;
      else if (sign === 0 || part.sign === 0) sign = 0;
      else sign = sign * part.sign as -1 | 1;
      oscillatory ||= part.oscillatory;
      if (part.exponentialArgument) exponentialArguments.push(part.exponentialArgument);
    }
    if (oscillatory && (polynomialOrder !== 0 || logarithmOrder !== 0 || exponentialArguments.length > 0)) return null;
    const exponentialArgument = exponentialArguments.length > 0
      ? simplify(expand(add(...exponentialArguments)))
      : null;
    return normalizeExponentialSignature({
      exponentialArgument, polynomialOrder, logarithmOrder, magnitude, sign, oscillatory,
    }, variable);
  }

  if (expr.kind === "Pow" && isNumeric(expr.exponent)) {
    const base = asymptoticSignature(expr.base, variable, point, depth + 1);
    if (!base || base.sign === null) return null;
    const [numerator, denominator] = numericParts(expr.exponent);
    if (base.sign === 0 && numerator < 0n) return null;
    if (base.sign < 0 && denominator % 2n === 0n) return null;
    let sign: -1 | 0 | 1 = base.sign;
    if (base.sign < 0 && (numerator < 0n ? -numerator : numerator) % 2n === 0n) sign = 1;
    if (base.sign === 0 && numerator > 0n) sign = 0;
    const exp = Number(numerator) / Number(denominator);
    const exponentialArgument = base.exponentialArgument
      ? simplify(mul(expr.exponent, base.exponentialArgument))
      : null;
    return normalizeExponentialSignature({
      exponentialArgument,
      polynomialOrder: base.polynomialOrder * exp,
      logarithmOrder: base.logarithmOrder * exp,
      magnitude: simplify(pow(base.magnitude, expr.exponent)),
      sign,
      oscillatory: base.oscillatory,
    }, variable);
  }

  if (expr.kind === "Function" && expr.args.length === 1) {
    const argument = expr.args[0]!;
    if (expr.name === "exp") {
      const tail = polynomialTail(argument, variable, point);
      if (!tail) return null;
      if (tail.degree <= 0) {
        const constant = tail.degree < 0 ? integer(0) : tail.leading;
        return {
          exponentialArgument: null, polynomialOrder: 0, logarithmOrder: 0,
          magnitude: normalizeKnownValues(fn("exp", constant)), sign: 1, oscillatory: false,
        };
      }
      return normalizeExponentialSignature({
        exponentialArgument: argument,
        polynomialOrder: 0,
        logarithmOrder: 0,
        magnitude: integer(1),
        sign: 1,
        oscillatory: false,
      }, variable);
    }
    if (expr.name === "log" || expr.name === "ln") {
      const argumentSignature = asymptoticSignature(argument, variable, point, depth + 1);
      if (!argumentSignature || argumentSignature.oscillatory) return null;
      if (argumentSignature.exponentialArgument) {
        const exponentTail = polynomialTail(argumentSignature.exponentialArgument, variable, point);
        if (!exponentTail || exponentTail.degree <= 0 || exponentTail.sign === 0) return null;
        // log(exp(P)*subexponential factors) has the same dominant polynomial term P.
        return {
          exponentialArgument: null,
          polynomialOrder: exponentTail.degree,
          logarithmOrder: 0,
          magnitude: exponentTail.magnitude,
          sign: exponentTail.sign,
          oscillatory: false,
        };
      }
      if (argumentSignature.logarithmOrder !== 0 || argumentSignature.sign === null || argumentSignature.sign <= 0) return null;
      if (argumentSignature.polynomialOrder === 0) return null;
      const order = argumentSignature.polynomialOrder;
      const logarithmMagnitude = rationalFromPositiveNumber(Math.abs(order));
      if (!logarithmMagnitude) return null;
      return {
        exponentialArgument: null,
        polynomialOrder: 0,
        logarithmOrder: 1,
        magnitude: logarithmMagnitude,
        sign: order > 0 ? 1 : -1,
        oscillatory: false,
      };
    }
    if (expr.name === "sqrt") {
      const argumentSignature = asymptoticSignature(argument, variable, point, depth + 1);
      if (!argumentSignature || argumentSignature.sign === null || argumentSignature.sign < 0 || argumentSignature.oscillatory) return null;
      const squareRootMagnitude = isNumeric(argumentSignature.magnitude)
        ? exactNumericSquareRoot(argumentSignature.magnitude) ?? simplify(pow(argumentSignature.magnitude, rational(1n, 2n)))
        : simplify(pow(argumentSignature.magnitude, rational(1n, 2n)));
      return normalizeExponentialSignature({
        exponentialArgument: argumentSignature.exponentialArgument
          ? simplify(mul(rational(1n, 2n), argumentSignature.exponentialArgument)) : null,
        polynomialOrder: argumentSignature.polynomialOrder / 2,
        logarithmOrder: argumentSignature.logarithmOrder / 2,
        magnitude: squareRootMagnitude,
        sign: argumentSignature.sign === 0 ? 0 : 1,
        oscillatory: false,
      }, variable);
    }
    if (expr.name === "abs") {
      const argumentSignature = asymptoticSignature(argument, variable, point, depth + 1);
      if (!argumentSignature) return null;
      return { ...argumentSignature, sign: argumentSignature.sign === 0 ? 0 : 1 };
    }
    if (expr.name === "sin" || expr.name === "cos") {
      return {
        exponentialArgument: null, polynomialOrder: 0, logarithmOrder: 0,
        magnitude: integer(1), sign: null, oscillatory: true,
      };
    }
    return null;
  }

  return null;
}

function normalizeExponentialSignature(signature: AsymptoticSignature, variable: string): AsymptoticSignature {
  if (!signature.exponentialArgument) return signature;
  const polynomial = tryUnivariatePolynomial(signature.exponentialArgument, variable);
  if (!polynomial) return signature;
  const degree = polynomialDegree(polynomial, variable);
  if (degree <= 0) {
    const constant = degree < 0 ? integer(0) : polynomialToExpr(polynomialCoefficient(polynomial, variable, 0));
    return {
      ...signature,
      exponentialArgument: null,
      magnitude: simplify(mul(signature.magnitude, fn("exp", constant))),
    };
  }
  const constant = polynomialToExpr(polynomialCoefficient(polynomial, variable, 0));
  const nonConstant = simplify(expand(add(signature.exponentialArgument, mul(integer(-1), constant))));
  if (isZero(constant)) return { ...signature, exponentialArgument: nonConstant };
  return {
    ...signature,
    exponentialArgument: nonConstant,
    magnitude: simplify(mul(signature.magnitude, fn("exp", constant))),
  };
}

function rationalFromPositiveNumber(value: number): Expr | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (Number.isInteger(value)) return integer(value);
  // Recover common exact rational orders (e.g. 1/2 or 1/3) rather than
  // encoding a floating-point approximation into a symbolic result.
  const maxDenominator = 10_000;
  for (let denominator = 2; denominator <= maxDenominator; denominator++) {
    const numerator = Math.round(value * denominator);
    if (numerator <= 0) continue;
    if (Math.abs(numerator / denominator - value) <= 1e-12) {
      return rational(BigInt(numerator), BigInt(denominator));
    }
  }
  return null;
}

function classifyAsymptoticExpression(
  expr: Expr,
  variable: string,
  point: "infinity" | "-infinity",
  hopitalSteps: number,
): LimitResult | null {
  const signature = asymptoticSignature(expr, variable, point);
  if (!signature || signature.oscillatory) return null;
  if (signature.exponentialArgument) {
    const tail = polynomialTail(signature.exponentialArgument, variable, point);
    if (!tail || tail.degree <= 0 || tail.sign === 0) return null;
    if (tail.sign < 0) return finite(integer(0), "asymptotic-dominance", hopitalSteps);
    if (signature.sign === null || signature.sign === 0) return null;
    return infinityResult(signature.sign > 0, "asymptotic-dominance", hopitalSteps);
  }
  if (signature.polynomialOrder > 0 || (signature.polynomialOrder === 0 && signature.logarithmOrder > 0)) {
    if (signature.sign === null || signature.sign === 0) return null;
    return infinityResult(signature.sign > 0, "asymptotic-dominance", hopitalSteps);
  }
  if (signature.polynomialOrder < 0 || (signature.polynomialOrder === 0 && signature.logarithmOrder < 0)) {
    return finite(integer(0), "asymptotic-dominance", hopitalSteps);
  }
  return null;
}

function classifyAsymptoticQuotient(
  quotient: Quotient,
  variable: string,
  point: "infinity" | "-infinity",
  hopitalSteps: number,
): LimitResult | null {
  const numerator = asymptoticSignature(quotient.numerator, variable, point);
  const denominator = asymptoticSignature(quotient.denominator, variable, point);
  if (!numerator || !denominator || numerator.oscillatory || denominator.oscillatory
    || numerator.sign === null || denominator.sign === null || denominator.sign === 0) return null;

  let exponentialFactor: Expr = integer(1);
  const exponentDifference = simplify(add(
    numerator.exponentialArgument ?? integer(0),
    mul(integer(-1), denominator.exponentialArgument ?? integer(0)),
  ));
  const exponentTail = polynomialTail(exponentDifference, variable, point);
  if (!exponentTail) return null;
  if (exponentTail.degree > 0) {
    if (exponentTail.sign > 0) return infinityResult(numerator.sign * denominator.sign > 0, "asymptotic-dominance", hopitalSteps);
    if (exponentTail.sign < 0) return finite(integer(0), "asymptotic-dominance", hopitalSteps);
    return null;
  }
  if (exponentTail.degree === 0 && !isZero(exponentTail.leading)) {
    exponentialFactor = fn("exp", exponentTail.leading);
  }

  const polynomialDifference = numerator.polynomialOrder - denominator.polynomialOrder;
  if (polynomialDifference > 1e-10) {
    return infinityResult(numerator.sign * denominator.sign > 0, "asymptotic-dominance", hopitalSteps);
  }
  if (polynomialDifference < -1e-10) return finite(integer(0), "asymptotic-dominance", hopitalSteps);

  const logarithmDifference = numerator.logarithmOrder - denominator.logarithmOrder;
  if (logarithmDifference > 1e-10) return infinityResult(numerator.sign * denominator.sign > 0, "asymptotic-dominance", hopitalSteps);
  if (logarithmDifference < -1e-10) return finite(integer(0), "asymptotic-dominance", hopitalSteps);

  const sign = numerator.sign * denominator.sign;
  const value = simplify(mul(
    integer(sign),
    numerator.magnitude,
    pow(denominator.magnitude, integer(-1)),
    exponentialFactor,
  ));
  return finite(value, "asymptotic-dominance", hopitalSteps);
}

function classifyAsymptoticSum(
  terms: readonly Expr[],
  variable: string,
  point: LimitPoint,
  hopitalSteps: number,
): LimitResult | null {
  if (point !== "infinity" && point !== "-infinity") return null;
  const signatures = terms.map(term => asymptoticSignature(term, variable, point));
  if (signatures.some(signature => signature === null)) return null;

  const active = signatures.filter((signature): signature is AsymptoticSignature =>
    signature !== null && asymptoticDivergenceSign(signature, variable, point) !== null,
  );
  if (active.length === 0) return null;
  const signs = active.map(signature => asymptoticDivergenceSign(signature, variable, point)!);
  if (signs.every(sign => sign === signs[0])) {
    return infinityResult(signs[0]! > 0, "asymptotic-dominance", hopitalSteps);
  }

  let dominant = [active[0]!];
  for (const candidate of active.slice(1)) {
    const comparison = compareAsymptoticGrowth(candidate, dominant[0]!, variable, point);
    if (comparison === null) return null;
    if (comparison > 0) dominant = [candidate];
    else if (comparison === 0) dominant.push(candidate);
  }
  if (dominant.length === 1) {
    const sign = asymptoticDivergenceSign(dominant[0]!, variable, point);
    return sign === null ? null : infinityResult(sign > 0, "asymptotic-dominance", hopitalSteps);
  }

  const firstExponential = dominant[0]!.exponentialArgument;
  if (dominant.some(signature => !sameExponentialScale(signature.exponentialArgument, firstExponential))) return null;
  const coefficientTerms = dominant.map(signature => {
    if (signature.sign === null) return null;
    return signature.sign < 0 ? mul(integer(-1), signature.magnitude) : signature.magnitude;
  });
  if (coefficientTerms.some(term => term === null)) return null;
  const combined = normalizeKnownValues(simplify(add(...coefficientTerms as Expr[])));
  const sign = numericSign(combined);
  if (sign === null || sign === 0) return null;
  return infinityResult(sign > 0, "asymptotic-dominance", hopitalSteps);
}

function asymptoticDivergenceSign(
  signature: AsymptoticSignature,
  variable: string,
  point: LimitPoint,
): -1 | 0 | 1 | null {
  if (signature.oscillatory || signature.sign === null || signature.sign === 0) return null;
  if (signature.exponentialArgument) {
    if (point !== "infinity" && point !== "-infinity") return null;
    const tail = polynomialTail(signature.exponentialArgument, variable, point);
    if (!tail || tail.degree <= 0 || tail.sign <= 0) return null;
    return signature.sign;
  }
  if (signature.polynomialOrder > 0 || (signature.polynomialOrder === 0 && signature.logarithmOrder > 0)) {
    return signature.sign;
  }
  return null;
}

function compareAsymptoticGrowth(
  left: AsymptoticSignature,
  right: AsymptoticSignature,
  variable: string,
  point: "infinity" | "-infinity",
): -1 | 0 | 1 | null {
  const leftExp = left.exponentialArgument;
  const rightExp = right.exponentialArgument;
  const leftTail = leftExp ? polynomialTail(leftExp, variable, point) : null;
  const rightTail = rightExp ? polynomialTail(rightExp, variable, point) : null;
  const leftExponential = !!leftTail && leftTail.degree > 0 && leftTail.sign > 0;
  const rightExponential = !!rightTail && rightTail.degree > 0 && rightTail.sign > 0;

  if (leftExponential !== rightExponential) return leftExponential ? 1 : -1;
  if (leftExponential && rightExponential) {
    const delta = simplify(add(leftExp!, mul(integer(-1), rightExp!)));
    const tail = polynomialTail(delta, variable, point);
    if (!tail) return null;
    if (tail.degree > 0 && tail.sign !== 0) return tail.sign;
    if (tail.degree === 0 && !isZero(tail.leading)) return null;
  }
  const polynomialDifference = left.polynomialOrder - right.polynomialOrder;
  if (polynomialDifference > 1e-10) return 1;
  if (polynomialDifference < -1e-10) return -1;
  const logarithmDifference = left.logarithmOrder - right.logarithmOrder;
  if (logarithmDifference > 1e-10) return 1;
  if (logarithmDifference < -1e-10) return -1;
  return 0;
}

function sameExponentialScale(left: Expr | null, right: Expr | null): boolean {
  if (left === null || right === null) return left === right;
  return equals(simplify(left), simplify(right));
}

function splitQuotient(expr: Expr): Quotient | null {
  const factors = expr.kind === "Mul" ? [...expr.factors] : [expr];
  const numeratorFactors: Expr[] = [];
  const denominatorFactors: Expr[] = [];
  let foundDenominator = false;
  for (const factor of factors) {
    if (factor.kind === "Pow" && isNumeric(factor.exponent)) {
      const [n, d] = numericParts(factor.exponent);
      if (n < 0n) {
        const positiveExponent = rational(-n, d);
        denominatorFactors.push(pow(factor.base, positiveExponent));
        foundDenominator = true;
        continue;
      }
    }
    numeratorFactors.push(factor);
  }
  if (!foundDenominator) return null;
  return {
    numerator: simplify(mul(...numeratorFactors)),
    denominator: simplify(mul(...denominatorFactors)),
  };
}

function classifyQuotientBySeries(
  quotient: Quotient,
  variable: string,
  point: Expr,
  direction: LimitDirection,
  hopitalSteps: number,
): LimitResult | null {
  try {
    const numerator = laurentSeries(quotient.numerator, variable, point, MAX_LOCAL_ORDER);
    const denominator = laurentSeries(quotient.denominator, variable, point, MAX_LOCAL_ORDER);
    if (numerator.leadingExponent === null || denominator.leadingExponent === null
      || !numerator.leadingCoefficient || !denominator.leadingCoefficient) return null;

    const exponent = numerator.leadingExponent - denominator.leadingExponent;
    const leadingCoefficient = normalizeKnownValues(simplify(mul(
      numerator.leadingCoefficient,
      pow(denominator.leadingCoefficient, integer(-1)),
    )));
    if (exponent > 0) return finite(integer(0), "taylor-series", hopitalSteps);
    if (exponent === 0) return finite(leadingCoefficient, "taylor-series", hopitalSteps);

    const coefficientSign = numericSign(leadingCoefficient);
    if (coefficientSign === null || coefficientSign === 0) return null;
    const rightPositive = coefficientSign > 0;
    const leftPositive = Math.abs(exponent) % 2 === 0 ? rightPositive : !rightPositive;
    if (direction === "right") return infinityResult(rightPositive, "taylor-series", hopitalSteps);
    if (direction === "left") return infinityResult(leftPositive, "taylor-series", hopitalSteps);
    if (rightPositive === leftPositive) return infinityResult(rightPositive, "taylor-series", hopitalSteps);
    return doesNotExist("The leading Laurent terms diverge with opposite signs from the left and right.", hopitalSteps, "taylor-series");
  } catch {
    return null;
  }
}

function leadingLocalTerm(expr: Expr, variable: string, point: Expr): LocalTerm | null {
  try {
    const expansion = laurentSeries(expr, variable, point, MAX_LOCAL_ORDER);
    if (expansion.leadingExponent !== null && expansion.leadingCoefficient) {
      return { order: expansion.leadingExponent, coefficient: expansion.leadingCoefficient };
    }
  } catch {
    // Preserve the derivative-based local-order fallback for expressions that
    // are outside the Taylor/Laurent engine's current function set.
  }
  let derivative = expr;
  let factorial = 1n;
  for (let order = 0; order <= MAX_LOCAL_ORDER; order++) {
    const value = evaluateAt(derivative, variable, point);
    if (value && !isZero(value)) {
      return { order, coefficient: simplify(mul(value, rational(1n, factorial))) };
    }
    if (order === MAX_LOCAL_ORDER) break;
    try {
      const next = simplify(differentiate(derivative, variable));
      if (equals(next, derivative) || isZero(next)) break;
      derivative = next;
    } catch {
      break;
    }
    factorial *= BigInt(order + 1);
  }
  return null;
}

function evaluateAt(expr: Expr, variable: string, point: Expr): Expr | null {
  try {
    return normalizeKnownValues(simplify(substitute(expr, { [variable]: point })));
  } catch {
    return null;
  }
}

function signAtInfinity(expr: Expr, variable: string, point: "infinity" | "-infinity"): -1 | 0 | 1 | null {
  const quotient = splitQuotient(expr);
  const numerator = tryUnivariatePolynomial(quotient?.numerator ?? expr, variable);
  const denominator = tryUnivariatePolynomial(quotient?.denominator ?? integer(1), variable);
  if (!numerator || !denominator) return null;
  const numeratorDegree = polynomialDegree(numerator, variable);
  const denominatorDegree = polynomialDegree(denominator, variable);
  if (denominatorDegree < 0) return null;
  if (numeratorDegree < 0) return 0;
  if (numeratorDegree < denominatorDegree) {
    const nLead = polynomialToExpr(polynomialCoefficient(numerator, variable, numeratorDegree));
    const dLead = polynomialToExpr(polynomialCoefficient(denominator, variable, denominatorDegree));
    const ratioSign = numericSign(simplify(mul(nLead, pow(dLead, integer(-1)))));
    if (ratioSign === null || ratioSign === 0) return ratioSign;
    return point === "-infinity" && (denominatorDegree - numeratorDegree) % 2 === 1
      ? (ratioSign === 1 ? -1 : 1)
      : ratioSign;
  }
  return null;
}

function tryUnivariatePolynomial(expr: Expr, variable: string) {
  try {
    const polynomial = polynomialFromExpr(expr);
    return isUnivariatePolynomial(polynomial, variable) ? polynomial : null;
  } catch {
    return null;
  }
}

function normalizeKnownValues(expr: Expr): Expr {
  switch (expr.kind) {
    case "Integer":
    case "Rational":
    case "Symbol":
      return expr;
    case "Add":
      return simplify(add(...expr.terms.map(normalizeKnownValues)));
    case "Mul":
      return simplify(mul(...expr.factors.map(normalizeKnownValues)));
    case "Pow": {
      const base = normalizeKnownValues(expr.base);
      const exponent = normalizeKnownValues(expr.exponent);
      if (base.kind === "Integer" && base.value === 0n && isNumeric(exponent) && numericSign(exponent) === -1) return pow(base, exponent);
      if (base.kind === "Function" && base.name === "sqrt" && exponent.kind === "Integer" && exponent.value === 2n) {
        return normalizeKnownValues(base.args[0]!);
      }
      return simplify(pow(base, exponent));
    }
    case "Function": {
      const args = expr.args.map(normalizeKnownValues);
      const argument = args[0];
      if (args.length === 1 && argument && isNumeric(argument)) {
        if (argument.kind === "Integer" && argument.value === 0n) {
          if (expr.name === "sin" || expr.name === "tan" || expr.name === "atan" || expr.name === "abs") return integer(0);
          if (expr.name === "cos" || expr.name === "exp") return integer(1);
          if (expr.name === "sqrt") return integer(0);
        }
        if ((expr.name === "log" || expr.name === "ln") && argument.kind === "Integer" && argument.value === 1n) return integer(0);
        if (expr.name === "abs") {
          const sign = numericSign(argument);
          if (sign !== null) return sign < 0 ? simplify(mul(integer(-1), argument)) : argument;
        }
        if (expr.name === "sqrt") {
          const root = exactNumericSquareRoot(argument);
          if (root) return root;
        }
        if (expr.name === "sign") {
          const sign = numericSign(argument);
          if (sign !== null) return integer(sign);
        }
      }
      return fn(expr.name, ...args);
    }
  }
}

function exactNumericSquareRoot(expr: NumericExpr): Expr | null {
  const [n, d] = numericParts(expr);
  if (n < 0n) return null;
  const nr = integerSquareRoot(n);
  const dr = integerSquareRoot(d);
  if (nr * nr === n && dr * dr === d) return rational(nr, dr);
  return null;
}

function integerSquareRoot(value: bigint): bigint {
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + value / x) >> 1n;
  }
  return x;
}

function containsUndefinedRealValue(expr: Expr): boolean {
  switch (expr.kind) {
    case "Integer":
    case "Rational":
    case "Symbol": return false;
    case "Add": return expr.terms.some(containsUndefinedRealValue);
    case "Mul": return expr.factors.some(containsUndefinedRealValue);
    case "Pow": {
      if (isNumeric(expr.exponent) && numericSign(expr.exponent) === -1 && expr.base.kind === "Integer" && expr.base.value === 0n) return true;
      if (expr.base.kind === "Integer" && expr.base.value < 0n && expr.exponent.kind === "Rational" && expr.exponent.denominator % 2n === 0n) return true;
      return containsUndefinedRealValue(expr.base) || containsUndefinedRealValue(expr.exponent);
    }
    case "Function": {
      if (expr.args.length === 1 && (expr.name === "log" || expr.name === "ln")) {
        const sign = numericSign(expr.args[0]!);
        if (sign !== null && sign <= 0) return true;
      }
      if (expr.args.length === 1 && expr.name === "sqrt") {
        const sign = numericSign(expr.args[0]!);
        if (sign !== null && sign < 0) return true;
      }
      return expr.args.some(containsUndefinedRealValue);
    }
  }
}

function evaluateNumeric(expr: Expr): NumericExpr | null {
  const normalized = normalizeKnownValues(expr);
  return isNumeric(normalized) ? normalized : null;
}

function numericSign(expr: Expr): -1 | 0 | 1 | null {
  const value = evaluateNumeric(expr);
  if (!value) return null;
  const [n] = numericParts(value);
  return n < 0n ? -1 : n > 0n ? 1 : 0;
}

function isInfiniteStatus(status: LimitStatus): status is "positive-infinity" | "negative-infinity" {
  return status === "positive-infinity" || status === "negative-infinity";
}

function dependsOn(expr: Expr, variable: string): boolean {
  switch (expr.kind) {
    case "Integer":
    case "Rational": return false;
    case "Symbol": return expr.name === variable;
    case "Add": return expr.terms.some(term => dependsOn(term, variable));
    case "Mul": return expr.factors.some(factor => dependsOn(factor, variable));
    case "Pow": return dependsOn(expr.base, variable) || dependsOn(expr.exponent, variable);
    case "Function": return expr.args.some(arg => dependsOn(arg, variable));
  }
}

function finite(value: Expr, method: LimitMethod, lHopitalSteps: number): LimitResult {
  return { status: "finite", value: normalizeKnownValues(simplify(value)), method, lHopitalSteps };
}

function infinityResult(positive: boolean, method: LimitMethod, lHopitalSteps: number): LimitResult {
  return { status: positive ? "positive-infinity" : "negative-infinity", method, lHopitalSteps };
}

function doesNotExist(message: string, lHopitalSteps: number, method: LimitMethod): LimitResult {
  return { status: "does-not-exist", method, lHopitalSteps, message };
}

function unsupported(message: string, lHopitalSteps = 0): LimitResult {
  return { status: "unsupported", method: "direct-substitution", lHopitalSteps, message };
}
