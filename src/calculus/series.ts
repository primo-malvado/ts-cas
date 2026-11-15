import {
  add, fn, integer, isNumeric, isZero, mul, numericParts, pow, rational,
  type Expr,
} from "../core/expr.js";
import { simplify } from "../algebra/simplify.js";
import { toString } from "../core/printer.js";

export type SeriesKind = "taylor" | "laurent";

export interface SeriesResult {
  readonly variable: string;
  readonly point: Expr;
  /** Highest exponent retained in the truncated expansion. */
  readonly order: number;
  /** "laurent" when at least one negative exponent is present. */
  readonly kind: SeriesKind;
  /** Sparse map from integer exponents to exact symbolic coefficients. Missing keys mean zero. */
  readonly coefficients: Readonly<Record<string, Expr>>;
  readonly leadingExponent: number | null;
  readonly leadingCoefficient?: Expr;
  /** Reconstructed truncation written using (variable - point). */
  readonly expression: Expr;
  /** Formal truncation remainder. For a Laurent expansion, negative powers may precede it. */
  readonly remainder: string;
}

export class SeriesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeriesError";
  }
}

const MAX_PUBLIC_ORDER = 20;
const MAX_INTERNAL_ORDER = 80;
const MAX_RECURSION = 48;

type SparseSeries = Map<number, Expr>;

/**
 * Compute a truncated Taylor or Laurent expansion around x = point.
 * Coefficients remain exact symbolic expressions wherever the AST supports them.
 * The implementation is deliberately conservative for essential singularities
 * (for example exp(1/x)) and fractional powers at a zero of their base.
 */
export function series(expr: Expr, variable: string, point: Expr, order = 6): SeriesResult {
  validateRequest(variable, point, order);
  const source = clean(expr);
  const internal = expandSeries(source, variable, point, order, 0);
  return buildResult(internal, variable, point, order);
}

/** Compute a Taylor expansion and reject the result if a negative power occurs. */
export function taylorSeries(expr: Expr, variable: string, point: Expr, order = 6): SeriesResult {
  const result = series(expr, variable, point, order);
  if (result.kind === "laurent") {
    throw new SeriesError("The local expansion contains negative powers; use laurentSeries() instead.");
  }
  return result;
}

/** Compute a Laurent expansion; regular Taylor expansions are valid Laurent expansions too. */
export function laurentSeries(expr: Expr, variable: string, point: Expr, order = 6): SeriesResult {
  return series(expr, variable, point, order);
}

function validateRequest(variable: string, point: Expr, order: number): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) throw new TypeError(`Invalid series variable: ${variable}`);
  if (dependsOn(point, variable)) throw new SeriesError("The expansion point must not depend on the expansion variable.");
  if (!Number.isInteger(order) || order < 0 || order > MAX_PUBLIC_ORDER) {
    throw new RangeError(`Series order must be an integer between 0 and ${MAX_PUBLIC_ORDER}.`);
  }
}

function expandSeries(expr: Expr, variable: string, point: Expr, order: number, depth: number): SparseSeries {
  if (depth > MAX_RECURSION) throw new SeriesError("Series expansion exceeded the recursion safety limit.");
  if (order > MAX_INTERNAL_ORDER) throw new SeriesError("The requested internal expansion order is too large.");
  const source = clean(expr);
  switch (source.kind) {
    case "Integer":
    case "Rational":
      return order >= 0 && !isZero(source) ? new Map([[0, source]]) : new Map();
    case "Symbol":
      if (source.name !== variable) return order >= 0 ? new Map([[0, source]]) : new Map();
      {
        const result: SparseSeries = new Map();
        const center = clean(point);
        if (order >= 0 && !isZero(center)) result.set(0, center);
        if (order >= 1) result.set(1, integer(1));
        return result;
      }
    case "Add": {
      let result: SparseSeries = new Map();
      for (const term of source.terms) result = addSeries(result, expandSeries(term, variable, point, order, depth + 1), order);
      return result;
    }
    case "Mul": {
      if (source.factors.some(isZero)) return new Map();
      const initial = source.factors.map(factor => expandSeries(factor, variable, point, order, depth + 1));
      for (let i = 0; i < initial.length; i++) {
        if (valuation(initial[i]!) === null && order < MAX_PUBLIC_ORDER) {
          initial[i] = expandSeries(source.factors[i]!, variable, point, MAX_PUBLIC_ORDER, depth + 1);
        }
      }
      const valuations = initial.map(valuation);
      if (valuations.some(v => v === null)) throw new SeriesError("Could not identify a factor's leading local power within the supported local order.");
      const knownValuations = valuations as number[];
      let result: SparseSeries = new Map([[0, integer(1)]]);
      for (let i = 0; i < source.factors.length; i++) {
        const otherValuation = knownValuations.reduce((sum, v, j) => sum + (i === j ? 0 : v), 0);
        const neededOrder = order - otherValuation;
        let current = initial[i]!;
        if (neededOrder > order) current = expandSeries(source.factors[i]!, variable, point, neededOrder, depth + 1);
        const remainingValuation = knownValuations.slice(i + 1).reduce((sum, value) => sum + value, 0);
        const intermediateOrder = order - remainingValuation;
        result = multiplySeries(result, current, intermediateOrder);
      }
      return truncateSeries(result, order);
    }
    case "Pow": {
      if (source.exponent.kind === "Integer") {
        const exponent = source.exponent.value;
        if (exponent === 0n) return order >= 0 ? new Map([[0, integer(1)]]) : new Map();
        if (exponent > 0n) {
          if (exponent > 100n) throw new SeriesError("Power is too large for a local expansion.");
          const count = Number(exponent);
          let base = expandSeries(source.base, variable, point, order, depth + 1);
          const v = valuation(base);
          if (v === null) {
            // No coefficient through the requested order means this positive
            // power contributes nothing to the requested truncation.
            return new Map();
          }
          const neededOrder = order - (count - 1) * v;
          if (neededOrder > order) base = expandSeries(source.base, variable, point, neededOrder, depth + 1);
          let result: SparseSeries = new Map([[0, integer(1)]]);
          for (let i = 0; i < count; i++) result = multiplySeries(result, base, order);
          return result;
        }
        if (exponent < -100n) throw new SeriesError("Negative power is too large for a local expansion.");
        const count = Number(-exponent);
        let base = expandSeries(source.base, variable, point, order, depth + 1);
        let v = valuation(base);
        if (v === null && order < MAX_PUBLIC_ORDER) {
          base = expandSeries(source.base, variable, point, MAX_PUBLIC_ORDER, depth + 1);
          v = valuation(base);
        }
        if (v === null) throw new SeriesError("Cannot invert a series whose leading local coefficient is unknown within the supported order.");
        const inversePowerOrder = order + (count - 1) * v;
        const neededBaseOrder = inversePowerOrder + 2 * v;
        if (neededBaseOrder > order) base = expandSeries(source.base, variable, point, neededBaseOrder, depth + 1);
        let result = inverseSeries(base, inversePowerOrder);
        for (let i = 1; i < count; i++) result = multiplySeries(result, inverseSeries(base, inversePowerOrder), order);
        return truncateSeries(result, order);
      }
      if (isNumeric(source.exponent)) {
        const base = expandSeries(source.base, variable, point, order, depth + 1);
        if ([...base.keys()].some(exponent => exponent < 0)) {
          throw new SeriesError("A rational power of a pole may require fractional exponents and is not represented by an ordinary Laurent series.");
        }
        const center = coefficient(base, 0);
        if (isZero(center)) {
          throw new SeriesError("A non-integer rational power at a zero of its base is not a Laurent series with integer exponents.");
        }
        const [powerNumerator, powerDenominator] = numericParts(source.exponent);
        const centerSign = numericSign(center);
        if (centerSign !== null && centerSign < 0 && powerDenominator % 2n === 0n && powerNumerator % 2n !== 0n) {
          throw new SeriesError("This rational power is not real at a negative base value.");
        }
        return binomialPowerSeries(base, center, source.exponent, order);
      }
      throw new SeriesError("Only integer or exact rational exponents are supported by local series expansion.");
    }
    case "Function":
      if (source.args.length !== 1) throw new SeriesError(`Function ${source.name} is not supported in a local series.`);
      return expandFunction(source.name, expandSeries(source.args[0]!, variable, point, order, depth + 1), order);
  }
}

function expandFunction(name: string, argument: SparseSeries, order: number): SparseSeries {
  if ([...argument.keys()].some(exponent => exponent < 0)) {
    throw new SeriesError(`The function ${name} of a pole is not represented by an ordinary Laurent series.`);
  }
  const g0 = coefficient(argument, 0);
  switch (name) {
    case "exp":
      return exponentialSeries(argument, clean(fn("exp", g0)), order);
    case "sin":
    case "cos": {
      const pair = sineCosineSeries(argument, clean(fn("sin", g0)), clean(fn("cos", g0)), order);
      return name === "sin" ? pair.sin : pair.cos;
    }
    case "tan": {
      const pair = sineCosineSeries(argument, clean(fn("sin", g0)), clean(fn("cos", g0)), order);
      return multiplySeries(pair.sin, inverseSeries(pair.cos, order), order);
    }
    case "log":
    case "ln": {
      if (isZero(g0)) throw new SeriesError("A logarithm whose argument vanishes at the expansion point has a logarithmic term, not a Taylor/Laurent series.");
      const logCenterSign = numericSign(g0);
      if (logCenterSign !== null && logCenterSign < 0) throw new SeriesError("The real logarithm is undefined at a negative expansion-point value.");
      const derivative = differentiateSeries(argument, order - 1);
      const reciprocal = inverseSeries(argument, order - 1);
      const slope = multiplySeries(derivative, reciprocal, order - 1);
      const output: SparseSeries = new Map();
      if (order >= 0) output.set(0, clean(fn(name, g0)));
      for (const [exponent, value] of slope) {
        if (exponent < 0) throw new SeriesError("Logarithmic expansion produced a non-integrable negative power.");
        const target = exponent + 1;
        if (target <= order) output.set(target, clean(mul(value, rational(1n, BigInt(target)))));
      }
      return dropZeroCoefficients(output);
    }
    case "atan": {
      const derivative = differentiateSeries(argument, order - 1);
      const denominator = addSeries(new Map([[0, integer(1)]]), multiplySeries(argument, argument, order - 1), order - 1);
      const slope = multiplySeries(derivative, inverseSeries(denominator, order - 1), order - 1);
      const output: SparseSeries = new Map();
      if (order >= 0) output.set(0, clean(fn("atan", g0)));
      for (const [exponent, value] of slope) {
        if (exponent < 0) throw new SeriesError("Arctangent expansion produced a non-integrable negative power.");
        const target = exponent + 1;
        if (target <= order) output.set(target, clean(mul(value, rational(1n, BigInt(target)))));
      }
      return dropZeroCoefficients(output);
    }
    case "sqrt": {
      if (isZero(g0)) throw new SeriesError("sqrt at a zero of its argument generally has fractional powers; use a Puiseux expansion, not a Taylor/Laurent series.");
      const rootCenterSign = numericSign(g0);
      if (rootCenterSign !== null && rootCenterSign < 0) throw new SeriesError("The real square root is undefined at a negative expansion-point value.");
      return binomialPowerSeries(argument, g0, rational(1n, 2n), order);
    }
    case "abs":
    case "sign": {
      const sign = numericSign(g0);
      if (sign === null || sign === 0) throw new SeriesError(`${name} requires a provable nonzero real value at the expansion point.`);
      if (name === "sign") return new Map([[0, integer(sign)]]);
      return sign > 0 ? argument : scaleSeries(argument, integer(-1), order);
    }
    default:
      throw new SeriesError(`Function ${name} is not supported by the local series engine.`);
  }
}

function exponentialSeries(argument: SparseSeries, initial: Expr, order: number): SparseSeries {
  const result: SparseSeries = new Map();
  if (order >= 0) result.set(0, initial);
  for (let n = 1; n <= order; n++) {
    let sum: Expr = integer(0);
    for (let i = 1; i <= n; i++) {
      sum = add(sum, mul(integer(i), coefficient(argument, i), coefficient(result, n - i)));
    }
    const value = clean(mul(sum, rational(1n, BigInt(n))));
    if (!isZero(value)) result.set(n, value);
  }
  return dropZeroCoefficients(result);
}

function sineCosineSeries(
  argument: SparseSeries,
  initialSin: Expr,
  initialCos: Expr,
  order: number,
): { sin: SparseSeries; cos: SparseSeries } {
  const sinSeries: SparseSeries = new Map();
  const cosSeries: SparseSeries = new Map();
  if (order >= 0) {
    if (!isZero(initialSin)) sinSeries.set(0, initialSin);
    if (!isZero(initialCos)) cosSeries.set(0, initialCos);
  }
  for (let n = 1; n <= order; n++) {
    let sinSum: Expr = integer(0);
    let cosSum: Expr = integer(0);
    for (let i = 1; i <= n; i++) {
      sinSum = add(sinSum, mul(integer(i), coefficient(argument, i), coefficient(cosSeries, n - i)));
      cosSum = add(cosSum, mul(integer(-i), coefficient(argument, i), coefficient(sinSeries, n - i)));
    }
    const sinValue = clean(mul(sinSum, rational(1n, BigInt(n))));
    const cosValue = clean(mul(cosSum, rational(1n, BigInt(n))));
    if (!isZero(sinValue)) sinSeries.set(n, sinValue);
    if (!isZero(cosValue)) cosSeries.set(n, cosValue);
  }
  return { sin: dropZeroCoefficients(sinSeries), cos: dropZeroCoefficients(cosSeries) };
}

function binomialPowerSeries(base: SparseSeries, center: Expr, exponent: Expr, order: number): SparseSeries {
  const delta = new Map(base);
  delta.delete(0);
  const relative = scaleSeries(delta, pow(center, integer(-1)), order);
  const output: SparseSeries = new Map();
  const constant = clean(pow(center, exponent));
  if (order >= 0 && !isZero(constant)) output.set(0, constant);
  let current: SparseSeries = new Map([[0, integer(1)]]);
  let binomial: Expr = integer(1);
  const maxTerms = Math.max(1, order + 2);
  for (let k = 1; k <= maxTerms; k++) {
    current = multiplySeries(current, relative, order);
    binomial = clean(mul(binomial, add(exponent, integer(-(k - 1))), rational(1n, BigInt(k))));
    const contribution = scaleSeries(current, clean(mul(constant, binomial)), order);
    for (const [e, c] of contribution) output.set(e, clean(add(coefficient(output, e), c)));
  }
  return dropZeroCoefficients(output);
}

function differentiateSeries(input: SparseSeries, order: number): SparseSeries {
  const output: SparseSeries = new Map();
  for (const [exponent, value] of input) {
    if (exponent === 0) continue;
    const target = exponent - 1;
    if (target <= order) output.set(target, clean(mul(integer(exponent), value)));
  }
  return dropZeroCoefficients(output);
}

function inverseSeries(input: SparseSeries, order: number): SparseSeries {
  if (order < -MAX_INTERNAL_ORDER) throw new SeriesError("Inverse-series order is outside the supported range.");
  const v = valuation(input);
  if (v === null) throw new SeriesError("Cannot invert a zero series.");
  const lead = coefficient(input, v);
  if (isZero(lead)) throw new SeriesError("Cannot invert a series with zero leading coefficient.");
  const lastIndex = order + v;
  if (lastIndex < 0) return new Map();
  if (lastIndex > MAX_INTERNAL_ORDER) throw new SeriesError("Inverse series exceeds the internal expansion limit.");
  const normalized: Expr[] = [];
  for (let i = 0; i <= lastIndex; i++) normalized.push(clean(mul(coefficient(input, v + i), pow(lead, integer(-1)))));
  const inverseCoefficients: Expr[] = [clean(pow(normalized[0]!, integer(-1)))];
  for (let n = 1; n <= lastIndex; n++) {
    let sum: Expr = integer(0);
    for (let i = 1; i <= n; i++) sum = add(sum, mul(normalized[i]!, inverseCoefficients[n - i]!));
    inverseCoefficients.push(clean(mul(integer(-1), sum, pow(normalized[0]!, integer(-1)))));
  }
  const output: SparseSeries = new Map();
  for (let j = 0; j <= lastIndex; j++) {
    const exponent = -v + j;
    const value = clean(mul(inverseCoefficients[j]!, pow(lead, integer(-1))));
    if (exponent <= order && !isZero(value)) output.set(exponent, value);
  }
  return output;
}

function addSeries(left: SparseSeries, right: SparseSeries, order: number): SparseSeries {
  const output = new Map(left);
  for (const [exponent, value] of right) {
    if (exponent > order) continue;
    output.set(exponent, clean(add(coefficient(output, exponent), value)));
  }
  return truncateSeries(dropZeroCoefficients(output), order);
}

function multiplySeries(left: SparseSeries, right: SparseSeries, order: number): SparseSeries {
  const output: SparseSeries = new Map();
  for (const [leftExponent, leftValue] of left) {
    for (const [rightExponent, rightValue] of right) {
      const exponent = leftExponent + rightExponent;
      if (exponent > order) continue;
      const contribution = clean(mul(leftValue, rightValue));
      output.set(exponent, clean(add(coefficient(output, exponent), contribution)));
    }
  }
  return dropZeroCoefficients(output);
}

function scaleSeries(input: SparseSeries, scale: Expr, order: number): SparseSeries {
  const output: SparseSeries = new Map();
  for (const [exponent, value] of input) {
    if (exponent <= order) {
      const product = clean(mul(scale, value));
      if (!isZero(product)) output.set(exponent, product);
    }
  }
  return output;
}

function truncateSeries(input: SparseSeries, order: number): SparseSeries {
  return dropZeroCoefficients(new Map([...input].filter(([exponent]) => exponent <= order)));
}

function dropZeroCoefficients(input: SparseSeries): SparseSeries {
  const output: SparseSeries = new Map();
  for (const [exponent, value] of input) {
    const normalized = clean(value);
    if (!isZero(normalized)) output.set(exponent, normalized);
  }
  return new Map([...output].sort(([a], [b]) => a - b));
}

function coefficient(input: SparseSeries, exponent: number): Expr {
  return input.get(exponent) ?? integer(0);
}

function valuation(input: SparseSeries): number | null {
  const nonzero = [...input].filter(([, value]) => !isZero(clean(value))).map(([exponent]) => exponent);
  return nonzero.length ? Math.min(...nonzero) : null;
}

function buildResult(input: SparseSeries, variable: string, point: Expr, order: number): SeriesResult {
  const normalized = truncateSeries(dropZeroCoefficients(input), order);
  const minExponent = valuation(normalized);
  const coefficients: Record<string, Expr> = {};
  for (const [exponent, value] of normalized) coefficients[String(exponent)] = value;
  const delta = clean(add({ kind: "Symbol", name: variable }, mul(integer(-1), point)));
  const terms: Expr[] = [];
  for (const [exponent, value] of normalized) {
    terms.push(exponent === 0 ? value : mul(value, pow(delta, integer(exponent))));
  }
  const approximation = clean(add(...terms));
  return {
    variable,
    point,
    order,
    kind: minExponent !== null && minExponent < 0 ? "laurent" : "taylor",
    coefficients,
    leadingExponent: minExponent,
    ...(minExponent === null ? {} : { leadingCoefficient: coefficient(normalized, minExponent) }),
    expression: approximation,
    remainder: `O(${isZero(point) ? variable : `(${variable} - ${toString(point)})`}^${order + 1})`,
  };
}

function clean(expr: Expr): Expr {
  const simplified = simplify(expr);
  switch (simplified.kind) {
    case "Integer":
    case "Rational":
    case "Symbol":
      return simplified;
    case "Add":
      return add(...simplified.terms.map(clean));
    case "Mul":
      return mul(...simplified.factors.map(clean));
    case "Pow": {
      const base = clean(simplified.base);
      const exponent = clean(simplified.exponent);
      if (isNumeric(base) && isNumeric(exponent)) {
        const [powerNumerator, powerDenominator] = numericParts(exponent);
        if (powerDenominator === 2n && powerNumerator % 2n !== 0n) {
          const root = exactSquareRoot(base);
          if (root) return simplify(pow(root, integer(powerNumerator)));
        }
      }
      return simplify(pow(base, exponent));
    }
    case "Function": {
      const argument = simplified.args.length === 1 ? clean(simplified.args[0]!) : undefined;
      if (argument !== undefined) {
        if (isZero(argument)) {
          if (simplified.name === "sin" || simplified.name === "tan" || simplified.name === "atan") return integer(0);
          if (simplified.name === "cos" || simplified.name === "exp") return integer(1);
          if (simplified.name === "sqrt" || simplified.name === "abs") return integer(0);
          if (simplified.name === "log" || simplified.name === "ln") return fn(simplified.name, argument);
        }
        if ((simplified.name === "log" || simplified.name === "ln") && argument.kind === "Integer" && argument.value === 1n) return integer(0);
        if (simplified.name === "sqrt" && isNumeric(argument)) {
          const exact = exactSquareRoot(argument);
          if (exact) return exact;
        }
        return fn(simplified.name, argument);
      }
      return fn(simplified.name, ...simplified.args.map(clean));
    }
  }
}

function exactSquareRoot(value: import("../core/expr.js").NumericExpr): Expr | null {
  const [numerator, denominator] = numericParts(value);
  if (numerator < 0n) return null;
  const n = integerSqrt(numerator), d = integerSqrt(denominator);
  if (n * n !== numerator || d * d !== denominator) return null;
  return rational(n, d);
}

function integerSqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n, y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}

function numericSign(expr: Expr): -1 | 0 | 1 | null {
  if (expr.kind === "Integer") return expr.value < 0n ? -1 : expr.value > 0n ? 1 : 0;
  if (expr.kind === "Rational") return expr.numerator < 0n ? -1 : expr.numerator > 0n ? 1 : 0;
  return null;
}

function dependsOn(expr: Expr, variable: string): boolean {
  switch (expr.kind) {
    case "Integer":
    case "Rational": return false;
    case "Symbol": return expr.name === variable;
    case "Add": return expr.terms.some(term => dependsOn(term, variable));
    case "Mul": return expr.factors.some(factor => dependsOn(factor, variable));
    case "Pow": return dependsOn(expr.base, variable) || dependsOn(expr.exponent, variable);
    case "Function": return expr.args.some(argument => dependsOn(argument, variable));
  }
}
