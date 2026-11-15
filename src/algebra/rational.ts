import {
  integer, isNumeric, mul, numericDiv, numericMul, numericParts, pow, rational,
  structuralKey, type Expr, type NumericExpr,
} from "../core/expr.js";
import {
  polynomialAdd, polynomialConstant, polynomialDivide, polynomialFromExpr,
  polynomialMultiply, polynomialPow, polynomialSubtract, polynomialToExpr,
  polynomialZero, type Polynomial, type PolynomialTerm,
} from "./polynomial.js";
import { factor, factorPolynomial } from "./factor.js";

export type RationalSimplificationStatus = "simplified" | "partial" | "unsupported" | "undefined";

/** Each expression in `restrictions` must be non-zero for the original expression to be defined. */
export interface RationalSimplificationResult {
  readonly status: RationalSimplificationStatus;
  /** Simplified rational expression. Absent only when the expression is unsupported or undefined. */
  readonly expression?: Expr;
  /** Simplified numerator and denominator, after exact cancellation and normalization. */
  readonly numerator?: Expr;
  readonly denominator?: Expr;
  /** Factorized numerator and denominator before common-factor cancellation. */
  readonly factoredNumerator?: Expr;
  readonly factoredDenominator?: Expr;
  /** Common factor that was canceled, possibly itself a product or power. */
  readonly canceledFactors: readonly Expr[];
  /** Original-domain conditions; every listed expression must be different from zero. */
  readonly restrictions: readonly Expr[];
  readonly message?: string;
}

interface RationalParts {
  numerator: Polynomial;
  denominator: Polynomial;
  restrictions: Expr[];
}

function isZeroPolynomial(poly: Polynomial): boolean {
  return poly.terms.size === 0;
}

function numericConstant(poly: Polynomial): NumericExpr | null {
  if (poly.terms.size === 0) return integer(0);
  if (poly.terms.size !== 1) return null;
  const term = [...poly.terms.values()][0]!;
  return term.monomial.powers.size === 0 ? term.coefficient : null;
}

function inverseNumeric(value: NumericExpr): NumericExpr {
  const [n, d] = numericParts(value);
  if (n === 0n) throw new RangeError("Cannot invert zero.");
  return rational(d, n) as NumericExpr;
}

function scalePolynomial(poly: Polynomial, value: NumericExpr): Polynomial {
  return polynomialMultiply(poly, polynomialConstant(value));
}

function polynomialVariableSet(poly: Polynomial): Set<string> {
  const names = new Set<string>();
  for (const term of poly.terms.values()) {
    for (const name of term.monomial.powers.keys()) names.add(name);
  }
  return names;
}

function soleVariable(a: Polynomial, b: Polynomial): string | null | false {
  const names = new Set([...polynomialVariableSet(a), ...polynomialVariableSet(b)]);
  if (names.size > 1) return false;
  return names.size === 0 ? null : [...names][0]!;
}

function leadingCoefficient(poly: Polynomial, variable: string | null): NumericExpr {
  let best: PolynomialTerm | undefined;
  let bestDegree = -1;
  for (const term of poly.terms.values()) {
    const degree = variable === null ? 0 : (term.monomial.powers.get(variable) ?? 0);
    if (degree > bestDegree) {
      best = term;
      bestDegree = degree;
    }
  }
  if (!best) return integer(0);
  return best.coefficient;
}

function monic(poly: Polynomial, variable: string | null): Polynomial {
  if (isZeroPolynomial(poly)) return poly;
  return scalePolynomial(poly, inverseNumeric(leadingCoefficient(poly, variable)));
}

function univariateGcd(a: Polynomial, b: Polynomial, variable: string | null): Polynomial {
  let left = a;
  let right = b;
  while (!isZeroPolynomial(right)) {
    const division = polynomialDivide(left, right);
    left = right;
    right = division.remainder;
  }
  return monic(left, variable);
}

function monomialKey(powers: ReadonlyMap<string, number>): string {
  return [...powers]
    .filter(([, exponent]) => exponent !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, exponent]) => `${name.length}:${name}^${exponent}`)
    .join("*") || "1";
}

function monomialPolynomial(powers: ReadonlyMap<string, number>): Polynomial {
  const clean = new Map([...powers].filter(([, exponent]) => exponent > 0).sort(([a], [b]) => a.localeCompare(b)));
  return {
    kind: "Polynomial",
    terms: new Map([[monomialKey(clean), { monomial: { powers: clean }, coefficient: integer(1) }]]),
  };
}

function commonMonomial(a: Polynomial, b: Polynomial): Polynomial {
  if (isZeroPolynomial(a) || isZeroPolynomial(b)) return polynomialConstant(1);
  const names = new Set([...polynomialVariableSet(a), ...polynomialVariableSet(b)]);
  const powers = new Map<string, number>();
  for (const name of names) {
    const minIn = (poly: Polynomial): number => Math.min(...[...poly.terms.values()].map(term => term.monomial.powers.get(name) ?? 0));
    const exponent = Math.min(minIn(a), minIn(b));
    if (exponent > 0) powers.set(name, exponent);
  }
  return monomialPolynomial(powers);
}

function divideByMonomial(poly: Polynomial, monomial: Polynomial): Polynomial {
  if (monomial.terms.size !== 1) throw new TypeError("Expected a monomial divisor.");
  const divisor = [...monomial.terms.values()][0]!;
  const terms: PolynomialTerm[] = [];
  for (const term of poly.terms.values()) {
    const powers = new Map(term.monomial.powers);
    for (const [name, exponent] of divisor.monomial.powers) {
      const current = powers.get(name) ?? 0;
      if (current < exponent) throw new Error("Monomial does not divide polynomial exactly.");
      const remaining = current - exponent;
      if (remaining === 0) powers.delete(name);
      else powers.set(name, remaining);
    }
    const coefficient = numericDiv(term.coefficient, divisor.coefficient);
    if (!isNumeric(coefficient)) throw new Error("Expected an exact rational coefficient.");
    const orderedPowers = new Map([...powers].sort(([a], [b]) => a.localeCompare(b)));
    terms.push({ monomial: { powers: orderedPowers }, coefficient });
  }
  return {
    kind: "Polynomial",
    terms: new Map(terms.map(term => [monomialKey(term.monomial.powers), term])),
  };
}

function proportionalQuotient(a: Polynomial, b: Polynomial): NumericExpr | null {
  if (a.terms.size === 0 || b.terms.size === 0 || a.terms.size !== b.terms.size) return null;
  const left = [...a.terms.values()];
  const rightByMonomial = new Map([...b.terms.values()].map(term => [monomialKey(term.monomial.powers), term]));
  const first = left[0]!;
  const matchingFirst = rightByMonomial.get(monomialKey(first.monomial.powers));
  if (!matchingFirst) return null;
  // ratio is the exact scalar q for which a = q*b.
  const ratio = numericDiv(first.coefficient, matchingFirst.coefficient);
  if (!isNumeric(ratio)) return null;
  for (const term of left) {
    const other = rightByMonomial.get(monomialKey(term.monomial.powers));
    if (!other) return null;
    const expected = numericMulSafe(other.coefficient, ratio);
    if (!expected) return null;
    const [an, ad] = numericParts(expected);
    const [bn, bd] = numericParts(term.coefficient);
    if (an * bd !== bn * ad) return null;
  }
  return ratio;
}

function numericMulSafe(a: NumericExpr, b: NumericExpr): NumericExpr | null {
  const product = numericMul(a, b);
  return isNumeric(product) ? product : null;
}

function monomialDegreeIn(poly: Polynomial, variable: string): number {
  return Math.max(0, ...[...poly.terms.values()].map(term => term.monomial.powers.get(variable) ?? 0));
}

function leadingTermMultivariate(poly: Polynomial): PolynomialTerm | null {
  if (poly.terms.size === 0) return null;
  const compare = (a: PolynomialTerm, b: PolynomialTerm): number => {
    const names = [...new Set([...a.monomial.powers.keys(), ...b.monomial.powers.keys()])].sort();
    for (const name of names) {
      // Match the lexicographic monomial order used by polynomial.ts.
      const difference = (b.monomial.powers.get(name) ?? 0) - (a.monomial.powers.get(name) ?? 0);
      if (difference !== 0) return difference;
    }
    return 0;
  };
  return [...poly.terms.values()].sort(compare)[0]!;
}

function exactDivideMultivariate(dividend: Polynomial, divisor: Polynomial): Polynomial {
  if (isZeroPolynomial(divisor)) throw new RangeError("Polynomial division by zero.");
  let remainder = dividend;
  let quotient = polynomialZero();
  let iterations = 0;
  while (!isZeroPolynomial(remainder)) {
    if (++iterations > 10000) throw new RangeError("Multivariate polynomial division exceeded its safety limit.");
    const remainderLead = leadingTermMultivariate(remainder)!;
    const divisorLead = leadingTermMultivariate(divisor)!;
    const powers = new Map(remainderLead.monomial.powers);
    for (const [name, exponent] of divisorLead.monomial.powers) {
      const current = powers.get(name) ?? 0;
      if (current < exponent) {
        throw new Error("Polynomial does not divide exactly under the selected monomial order.");
      }
      if (current === exponent) powers.delete(name);
      else powers.set(name, current - exponent);
    }
    const coefficient = numericDiv(remainderLead.coefficient, divisorLead.coefficient);
    if (!isNumeric(coefficient)) throw new TypeError("Expected an exact rational coefficient.");
    const termPowers = new Map([...powers].filter(([, exponent]) => exponent > 0).sort(([a], [b]) => a.localeCompare(b)));
    const term: Polynomial = {
      kind: "Polynomial",
      terms: new Map([[monomialKey(termPowers), { monomial: { powers: termPowers }, coefficient }]]),
    };
    quotient = polynomialAdd(quotient, term);
    remainder = polynomialSubtract(remainder, polynomialMultiply(term, divisor));
  }
  return quotient;
}

function exactDivide(a: Polynomial, b: Polynomial): Polynomial {
  const variable = soleVariable(a, b);
  if (variable !== false) {
    const division = polynomialDivide(a, b);
    if (!isZeroPolynomial(division.remainder)) throw new Error("Internal error: common factor did not divide exactly.");
    return division.quotient;
  }
  return exactDivideMultivariate(a, b);
}

interface KroneckerContext {
  readonly variables: readonly string[];
  readonly radices: readonly number[];
  readonly degreeLimits: readonly number[];
}

const KRONECKER_VARIABLE = "__ts_cas_k";

function createKroneckerContext(a: Polynomial, b: Polynomial): KroneckerContext | null {
  const variables = [...new Set([...polynomialVariableSet(a), ...polynomialVariableSet(b)])].sort();
  if (variables.length < 2 || variables.length > 8) return null;
  const radices = variables.map(name => Math.max(monomialDegreeIn(a, name), monomialDegreeIn(b, name)) + 1);
  const degreeLimits = variables.map(name => Math.min(monomialDegreeIn(a, name), monomialDegreeIn(b, name)));
  let product = 1;
  for (const radix of radices) {
    product *= radix;
    if (!Number.isSafeInteger(product) || product > Number.MAX_SAFE_INTEGER / 4) return null;
  }
  return { variables, radices, degreeLimits };
}

function encodeKronecker(poly: Polynomial, context: KroneckerContext): Polynomial | null {
  const weights: number[] = [];
  let weight = 1;
  for (const radix of context.radices) {
    weights.push(weight);
    weight *= radix;
    if (!Number.isSafeInteger(weight)) return null;
  }
  const terms = new Map<string, PolynomialTerm>();
  for (const term of poly.terms.values()) {
    let exponent = 0;
    context.variables.forEach((name, index) => {
      exponent += (term.monomial.powers.get(name) ?? 0) * weights[index]!;
    });
    if (!Number.isSafeInteger(exponent) || exponent < 0) return null;
    const powers = new Map<string, number>();
    if (exponent > 0) powers.set(KRONECKER_VARIABLE, exponent);
    const key = monomialKey(powers);
    if (terms.has(key)) return null; // Would indicate an encoding collision.
    terms.set(key, { monomial: { powers }, coefficient: term.coefficient });
  }
  return { kind: "Polynomial", terms };
}

function decodeKronecker(poly: Polynomial, shift: number, context: KroneckerContext): Polynomial | null {
  const terms: PolynomialTerm[] = [];
  for (const term of poly.terms.values()) {
    const encodedExponent = term.monomial.powers.get(KRONECKER_VARIABLE) ?? 0;
    let remaining = encodedExponent - shift;
    if (!Number.isSafeInteger(remaining) || remaining < 0) return null;
    const powers = new Map<string, number>();
    for (let index = 0; index < context.variables.length; index++) {
      const radix = context.radices[index]!;
      const digit = remaining % radix;
      remaining = Math.floor(remaining / radix);
      if (digit > context.degreeLimits[index]!) return null;
      if (digit > 0) powers.set(context.variables[index]!, digit);
    }
    if (remaining !== 0) return null;
    const orderedPowers = new Map([...powers].sort(([a], [b]) => a.localeCompare(b)));
    terms.push({ monomial: { powers: orderedPowers }, coefficient: term.coefficient });
  }
  const combined = new Map<string, PolynomialTerm>();
  for (const term of terms) {
    const key = monomialKey(term.monomial.powers);
    const previous = combined.get(key);
    if (previous) {
      const coefficient = numericParts(previous.coefficient);
      const next = numericParts(term.coefficient);
      const sum = rational(coefficient[0] * next[1] + next[0] * coefficient[1], coefficient[1] * next[1]);
      if (!isNumeric(sum)) return null;
      if (numericParts(sum)[0] === 0n) combined.delete(key);
      else combined.set(key, { monomial: term.monomial, coefficient: sum });
    } else {
      combined.set(key, term);
    }
  }
  return { kind: "Polynomial", terms: combined };
}

function isUnitPolynomial(poly: Polynomial): boolean {
  return poly.terms.size === 1 && [...poly.terms.values()][0]!.monomial.powers.size === 0;
}

function polynomialTotalDegree(poly: Polynomial): number {
  return Math.max(-1, ...[...poly.terms.values()].map(term =>
    [...term.monomial.powers.values()].reduce((sum, exponent) => sum + exponent, 0)));
}

function minimumEncodedExponent(poly: Polynomial): number {
  return Math.min(...[...poly.terms.values()].map(term => term.monomial.powers.get(KRONECKER_VARIABLE) ?? 0));
}

function multivariateGcdByKronecker(a: Polynomial, b: Polynomial): { gcd: Polynomial; complete: boolean } | null {
  const context = createKroneckerContext(a, b);
  if (!context) return null;
  const encodedA = encodeKronecker(a, context);
  const encodedB = encodeKronecker(b, context);
  if (!encodedA || !encodedB) return null;
  const encodedGcd = univariateGcd(encodedA, encodedB, KRONECKER_VARIABLE);
  if (isZeroPolynomial(encodedGcd)) return null;
  // A pure power of the Kronecker variable can be an encoding artifact. Any
  // genuine common monomial has already been removed from a and b.
  if (encodedGcd.terms.size === 1) {
    const only = [...encodedGcd.terms.values()][0]!;
    if (only.monomial.powers.size === 0 || only.monomial.powers.has(KRONECKER_VARIABLE)) {
      return { gcd: polynomialConstant(1), complete: true };
    }
  }

  let bestFull: { gcd: Polynomial; score: number } | null = null;
  const maxShift = minimumEncodedExponent(encodedGcd);
  for (let shift = 0; shift <= maxShift; shift++) {
    const candidate = decodeKronecker(encodedGcd, shift, context);
    if (!candidate || candidate.terms.size === 0 || isUnitPolynomial(candidate)) continue;
    try {
      exactDivideMultivariate(a, candidate);
      exactDivideMultivariate(b, candidate);
      const score = polynomialTotalDegree(candidate);
      if (!bestFull || score > bestFull.score) bestFull = { gcd: candidate, score };
    } catch {
      // Try another shift; encoded gcds can contain artifacts from substitution.
    }
  }
  if (bestFull) return { gcd: bestFull.gcd, complete: true };

  // When the complete encoded gcd is not itself a valid multivariate divisor,
  // try its rational-root factorization to recover verifiable common factors.
  // This is a useful lower bound, but is marked partial because factorPolynomial
  // does not prove irreducibility of every remaining univariate factor.
  const factorization = factorPolynomial(encodedGcd, KRONECKER_VARIABLE);
  const factors = factorization.factors;
  const combinationCount = factors.reduce((count, item) => count * (item.multiplicity + 1), 1);
  let bestPartial: { gcd: Polynomial; score: number } | null = null;
  if (combinationCount <= 4096) {
    const divisors: Polynomial[] = [polynomialConstant(1)];
    for (const item of factors) {
      const next: Polynomial[] = [];
      for (const existing of divisors) {
        let power = polynomialConstant(1);
        for (let exponent = 0; exponent <= item.multiplicity; exponent++) {
          next.push(polynomialMultiply(existing, power));
          power = polynomialMultiply(power, item.factor);
        }
      }
      divisors.splice(0, divisors.length, ...next);
    }
    for (const divisor of divisors) {
      if (isUnitPolynomial(divisor) || isZeroPolynomial(divisor)) continue;
      const maxCandidateShift = minimumEncodedExponent(divisor);
      for (let shift = 0; shift <= maxCandidateShift; shift++) {
        const candidate = decodeKronecker(divisor, shift, context);
        if (!candidate || candidate.terms.size === 0 || isUnitPolynomial(candidate)) continue;
        try {
          exactDivideMultivariate(a, candidate);
          exactDivideMultivariate(b, candidate);
          const score = polynomialTotalDegree(candidate);
          if (!bestPartial || score > bestPartial.score) bestPartial = { gcd: candidate, score };
        } catch {
          // The decoded divisor is not a common multivariate factor.
        }
      }
    }
  }
  return bestPartial ? { gcd: bestPartial.gcd, complete: false } : { gcd: polynomialConstant(1), complete: false };
}

function gcdForPolynomials(a: Polynomial, b: Polynomial): { gcd: Polynomial; complete: boolean } {
  const variable = soleVariable(a, b);
  if (variable !== false) return { gcd: univariateGcd(a, b, variable), complete: true };
  if (isZeroPolynomial(a)) return { gcd: monic(b, null), complete: true };
  if (isZeroPolynomial(b)) return { gcd: monic(a, null), complete: true };

  const common = commonMonomial(a, b);
  const reducedA = exactDivide(a, common);
  const reducedB = exactDivide(b, common);
  const proportional = proportionalQuotient(reducedA, reducedB);
  if (proportional !== null) {
    const normalized = scalePolynomial(reducedB, inverseNumeric(leadingCoefficient(reducedB, null)));
    return { gcd: polynomialMultiply(common, normalized), complete: true };
  }

  const reducedAConstant = numericConstant(reducedA) !== null;
  const reducedBConstant = numericConstant(reducedB) !== null;
  if (reducedAConstant || reducedBConstant || (reducedA.terms.size <= 1 && reducedB.terms.size <= 1)) {
    return { gcd: common, complete: true };
  }

  const multi = multivariateGcdByKronecker(reducedA, reducedB);
  if (!multi) return { gcd: common, complete: false };
  return { gcd: polynomialMultiply(common, multi.gcd), complete: multi.complete };
}

function factorLeaves(expr: Expr): Expr[] {
  if (expr.kind === "Mul") return expr.factors.flatMap(factorLeaves);
  if (expr.kind === "Pow" && expr.exponent.kind === "Integer" && expr.exponent.value > 0n) {
    return factorLeaves(expr.base);
  }
  return isNumeric(expr) ? [] : [expr];
}

function deduplicateExpressions(expressions: readonly Expr[]): Expr[] {
  const seen = new Set<string>();
  const output: Expr[] = [];
  for (const expression of expressions) {
    const key = structuralKey(expression);
    if (!seen.has(key)) {
      seen.add(key);
      output.push(expression);
    }
  }
  return output;
}

function domainRestrictions(poly: Polynomial): Expr[] {
  if (isZeroPolynomial(poly)) throw new RangeError("The original expression divides by zero identically.");
  if (numericConstant(poly) !== null) return [];
  const expression = polynomialToExpr(poly);
  try {
    const factored = factor(expression);
    const leaves = factorLeaves(factored);
    return leaves.length > 0 ? leaves : [expression];
  } catch {
    return [expression];
  }
}

function collectOriginalRestrictions(expr: Expr): Expr[] {
  switch (expr.kind) {
    case "Integer":
    case "Rational":
    case "Symbol":
      return [];
    case "Function":
      return expr.args.flatMap(collectOriginalRestrictions);
    case "Add":
      return expr.terms.flatMap(collectOriginalRestrictions);
    case "Mul":
      return expr.factors.flatMap(collectOriginalRestrictions);
    case "Pow": {
      const nested = collectOriginalRestrictions(expr.base);
      if (expr.exponent.kind !== "Integer" || expr.exponent.value >= 0n) {
        return [...nested, ...collectOriginalRestrictions(expr.exponent)];
      }
      try {
        const baseParts = rationalize(expr.base);
        return [...nested, ...domainRestrictions(baseParts.numerator)];
      } catch {
        // Retain a meaningful condition even when the denominator is not a
        // polynomial, e.g. 1/sin(x) requires sin(x) != 0.
        return [...nested, expr.base];
      }
    }
  }
}

function rationalize(expr: Expr): RationalParts {
  switch (expr.kind) {
    case "Integer":
    case "Rational":
    case "Symbol":
      return { numerator: polynomialFromExpr(expr), denominator: polynomialConstant(1), restrictions: [] };
    case "Function":
      throw new TypeError(`Rational simplification does not support the function '${expr.name}'.`);
    case "Add": {
      let current: RationalParts = {
        numerator: polynomialZero(), denominator: polynomialConstant(1), restrictions: [],
      };
      for (const term of expr.terms) {
        const next = rationalize(term);
        current = {
          numerator: polynomialAdd(
            polynomialMultiply(current.numerator, next.denominator),
            polynomialMultiply(next.numerator, current.denominator),
          ),
          denominator: polynomialMultiply(current.denominator, next.denominator),
          restrictions: [...current.restrictions, ...next.restrictions],
        };
      }
      return current;
    }
    case "Mul": {
      let numerator = polynomialConstant(1);
      let denominator = polynomialConstant(1);
      const restrictions: Expr[] = [];
      for (const factorExpr of expr.factors) {
        const part = rationalize(factorExpr);
        numerator = polynomialMultiply(numerator, part.numerator);
        denominator = polynomialMultiply(denominator, part.denominator);
        restrictions.push(...part.restrictions);
      }
      return { numerator, denominator, restrictions };
    }
    case "Pow": {
      if (expr.exponent.kind !== "Integer") {
        throw new TypeError("Rational simplification only supports integer powers.");
      }
      const exponent = expr.exponent.value;
      if (exponent > 1000n || exponent < -1000n) {
        throw new RangeError("Rational power magnitude exceeds the supported limit (1000).");
      }
      const base = rationalize(expr.base);
      if (exponent === 0n) return { numerator: polynomialConstant(1), denominator: polynomialConstant(1), restrictions: base.restrictions };
      const magnitude = Number(exponent < 0n ? -exponent : exponent);
      if (exponent > 0n) {
        return {
          numerator: polynomialPow(base.numerator, magnitude),
          denominator: polynomialPow(base.denominator, magnitude),
          restrictions: base.restrictions,
        };
      }
      const restrictions = [...base.restrictions, ...domainRestrictions(base.numerator)];
      return {
        numerator: polynomialPow(base.denominator, magnitude),
        denominator: polynomialPow(base.numerator, magnitude),
        restrictions,
      };
    }
  }
}

function normalizedFraction(numerator: Polynomial, denominator: Polynomial): { numerator: Polynomial; denominator: Polynomial } {
  if (isZeroPolynomial(denominator)) throw new RangeError("The original expression divides by zero identically.");
  const constantDenominator = numericConstant(denominator);
  if (constantDenominator !== null) {
    return { numerator: scalePolynomial(numerator, inverseNumeric(constantDenominator)), denominator: polynomialConstant(1) };
  }
  const variable = soleVariable(numerator, denominator);
  if (variable !== false) {
    const lead = leadingCoefficient(denominator, variable);
    const inverse = inverseNumeric(lead);
    return { numerator: scalePolynomial(numerator, inverse), denominator: scalePolynomial(denominator, inverse) };
  }
  const lead = leadingCoefficient(denominator, null);
  const inverse = inverseNumeric(lead);
  return { numerator: scalePolynomial(numerator, inverse), denominator: scalePolynomial(denominator, inverse) };
}

function expressionFromFraction(numerator: Polynomial, denominator: Polynomial): Expr {
  const numeratorExpr = polynomialToExpr(numerator);
  const denominatorExpr = polynomialToExpr(denominator);
  const denominatorValue = numericConstant(denominator);
  if (denominatorValue !== null && numericParts(denominatorValue)[0] === numericParts(denominatorValue)[1]) {
    return numeratorExpr;
  }
  return mul(numeratorExpr, pow(denominatorExpr, integer(-1)));
}

/**
 * Simplify an exact rational expression by combining polynomial fractions,
 * factoring numerator and denominator, cancelling common factors, and keeping
 * every non-zero condition inherited from the original expression.
 *
 * The polynomial gcd is complete for univariate expressions. For multivariate
 * expressions, Kronecker substitution is combined with exact multivariate
 * division to verify decoded candidates; uncertain cases are reported as `partial`.
 */
export function simplifyRational(expr: Expr): RationalSimplificationResult {
  const originalRestrictions = deduplicateExpressions(collectOriginalRestrictions(expr));
  let parts: RationalParts;
  try {
    parts = rationalize(expr);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status: RationalSimplificationStatus = /divide[s]? by zero|zero identically|zero denominator/i.test(message)
      ? "undefined"
      : "unsupported";
    return { status, canceledFactors: [], restrictions: originalRestrictions, message };
  }

  if (isZeroPolynomial(parts.denominator)) {
    return { status: "undefined", canceledFactors: [], restrictions: [], message: "The expression has an identically zero denominator." };
  }
  const factoredNumerator = factor(polynomialToExpr(parts.numerator));
  const factoredDenominator = factor(polynomialToExpr(parts.denominator));
  const restrictions = deduplicateExpressions([...parts.restrictions, ...originalRestrictions]);

  if (isZeroPolynomial(parts.numerator)) {
    return {
      status: "simplified",
      expression: integer(0),
      numerator: integer(0),
      denominator: integer(1),
      factoredNumerator,
      factoredDenominator,
      canceledFactors: [],
      restrictions,
    };
  }

  const gcdInfo = gcdForPolynomials(parts.numerator, parts.denominator);
  const gcdPoly = gcdInfo.gcd;
  const isUnitGcd = gcdPoly.terms.size === 1
    && [...gcdPoly.terms.values()][0]!.monomial.powers.size === 0;
  let numerator = parts.numerator;
  let denominator = parts.denominator;
  const canceledFactors: Expr[] = [];

  if (!isUnitGcd) {
    try {
      numerator = exactDivide(numerator, gcdPoly);
      denominator = exactDivide(denominator, gcdPoly);
      canceledFactors.push(factor(polynomialToExpr(gcdPoly)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: "partial",
        expression: expressionFromFraction(parts.numerator, parts.denominator),
        numerator: polynomialToExpr(parts.numerator),
        denominator: polynomialToExpr(parts.denominator),
        factoredNumerator,
        factoredDenominator,
        canceledFactors: [],
        restrictions,
        message: `Could not safely cancel the detected common factor: ${message}`,
      };
    }
  }

  const normalized = normalizedFraction(numerator, denominator);
  numerator = normalized.numerator;
  denominator = normalized.denominator;
  const expression = expressionFromFraction(numerator, denominator);
  const status: RationalSimplificationStatus = gcdInfo.complete ? "simplified" : "partial";
  const message = status === "partial"
    ? "Multivariate simplification is partial: the detected common factor was verified, but a complete multivariate gcd could not be established."
    : undefined;

  return {
    status,
    expression,
    numerator: polynomialToExpr(numerator),
    denominator: polynomialToExpr(denominator),
    factoredNumerator,
    factoredDenominator,
    canceledFactors,
    restrictions,
    ...(message ? { message } : {}),
  };
}
