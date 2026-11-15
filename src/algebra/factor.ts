import {
  integer, isNumeric, numericParts, rational, type NumericExpr,
} from "../core/expr.js";
import {
  polynomialAdd, polynomialConstant, polynomialDivide, polynomialFromExpr,
  polynomialMultiply, polynomialNegate, polynomialPow, polynomialSubtract, polynomialToExpr,
  polynomialZero, type Polynomial, type PolynomialTerm,
} from "./polynomial.js";
import { mul, pow, structuralKey, symbol, type Expr } from "../core/expr.js";

export interface PolynomialFactor {
  readonly factor: Polynomial;
  readonly multiplicity: number;
}

export interface Factorization {
  /** Constant scalar multiplying all factors. */
  readonly content: NumericExpr;
  readonly factors: readonly PolynomialFactor[];
}

export type FactorizationStepRule =
  | "convert-to-polynomial"
  | "factor-univariate-over-rationals"
  | "factor-multivariate-patterns"
  | "reconstruct-factorization";

export interface FactorizationStep {
  readonly rule: FactorizationStepRule;
  readonly input: Expr;
  readonly output: Expr;
  readonly content?: NumericExpr;
  readonly factors?: readonly { readonly expression: Expr; readonly multiplicity: number }[];
}

export interface FactorizationExplanation {
  readonly expression: Expr;
  readonly factorization: Factorization;
  readonly steps: readonly FactorizationStep[];
}

export interface FactorizationVerificationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/** Greatest common divisor for integers, always non-negative. */
function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function lcm(a: bigint, b: bigint): bigint {
  return a === 0n || b === 0n ? 0n : (a / gcd(a, b)) * b;
}

function abs(n: bigint): bigint { return n < 0n ? -n : n; }

function divisors(n: bigint): bigint[] {
  n = abs(n);
  if (n === 0n) return [0n];
  const result: bigint[] = [];
  // Avoid pathological run-time on huge coefficients.
  if (n > 100000000n) return [];
  for (let i = 1n; i * i <= n; i++) {
    if (n % i === 0n) {
      result.push(i);
      if (i * i !== n) result.push(n / i);
    }
  }
  return result.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

function numericFromPolynomialConstant(poly: Polynomial): NumericExpr | null {
  if (poly.terms.size === 0) return integer(0);
  if (poly.terms.size !== 1) return null;
  const term = [...poly.terms.values()][0]!;
  if (term.monomial.powers.size !== 0) return null;
  return term.coefficient;
}

function coeffAt(poly: Polynomial, variable: string, exponent: number): NumericExpr | null {
  const terms: PolynomialTerm[] = [];
  for (const term of poly.terms.values()) {
    if ((term.monomial.powers.get(variable) ?? 0) !== exponent) continue;
    const powers = new Map(term.monomial.powers);
    powers.delete(variable);
    if (powers.size !== 0) return null;
    terms.push({ monomial: { powers }, coefficient: term.coefficient });
  }
  if (terms.length === 0) return integer(0);
  // A valid univariate polynomial has at most one term per exponent.
  return terms[0]!.coefficient;
}

function rationalRootCandidates(poly: Polynomial, variable: string): NumericExpr[] {
  const degree = Math.max(0, ...[...poly.terms.values()].map(t => t.monomial.powers.get(variable) ?? 0));
  const coefficients: NumericExpr[] = [];
  for (let i = 0; i <= degree; i++) {
    const c = coeffAt(poly, variable, i);
    if (!c) return [];
    coefficients.push(c);
  }
  const leading = coefficients[degree]!;
  const constant = coefficients[0]!;
  if (leading.kind === "Integer" && leading.value === 0n) return [];
  if (leading.kind === "Rational" && leading.numerator === 0n) return [];
  const denominatorLcm = coefficients.reduce((acc, c) => lcm(acc, numericParts(c)[1]), 1n);
  const ints = coefficients.map(c => {
    const [n, d] = numericParts(c);
    return n * (denominatorLcm / d);
  });
  const pDivs = divisors(ints[0]!);
  const qDivs = divisors(ints[ints.length - 1]!);
  if (pDivs.length === 0 || qDivs.length === 0) return [];
  const candidates = new Map<string, NumericExpr>();
  for (const p of pDivs) {
    for (const q of qDivs) {
      if (q === 0n) continue;
      for (const sign of [1n, -1n]) {
        const root = rational(sign * p, q) as NumericExpr;
        const key = root.kind === "Integer" ? `${root.value}/1` : `${root.numerator}/${root.denominator}`;
        candidates.set(key, root);
      }
    }
  }
  // The constant term being zero gives the root 0.
  if (constant.kind === "Integer" ? constant.value === 0n : constant.numerator === 0n) {
    candidates.set("0/1", integer(0));
  }
  return [...candidates.values()];
}

function linearFactor(variable: string, root: NumericExpr): Polynomial {
  // x - root
  return polynomialAdd(
    polynomialFromExpr(symbol(variable)),
    polynomialNegate(polynomialConstant(root))
  );
}

function findRationalRoot(poly: Polynomial, variable: string): NumericExpr | null {
  for (const root of rationalRootCandidates(poly, variable)) {
    const division = polynomialDivide(poly, linearFactor(variable, root));
    if (division.remainder.terms.size === 0) return root;
  }
  return null;
}


function numericEqual(a: NumericExpr, b: NumericExpr): boolean {
  const [an, ad] = numericParts(a);
  const [bn, bd] = numericParts(b);
  return an * bd === bn * ad;
}

function numericProduct(a: NumericExpr, b: NumericExpr): NumericExpr {
  const [an, ad] = numericParts(a);
  const [bn, bd] = numericParts(b);
  return rational(an * bn, ad * bd) as NumericExpr;
}

function numericInverse(value: NumericExpr): NumericExpr {
  const [n, d] = numericParts(value);
  if (n === 0n) throw new RangeError("Cannot invert zero.");
  return rational(d, n) as NumericExpr;
}

function scalePolynomial(poly: Polynomial, coefficient: NumericExpr): Polynomial {
  return polynomialMultiply(poly, polynomialConstant(coefficient));
}

function monomialKey(powers: ReadonlyMap<string, number>): string {
  return [...powers]
    .filter(([, exponent]) => exponent > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, exponent]) => `${name.length}:${name}^${exponent}`)
    .join("*") || "1";
}

function monomialPolynomial(powers: ReadonlyMap<string, number>): Polynomial {
  const clean = new Map([...powers]
    .filter(([, exponent]) => exponent > 0)
    .sort(([a], [b]) => a.localeCompare(b)));
  return {
    kind: "Polynomial",
    terms: new Map([[monomialKey(clean), {
      monomial: { powers: clean }, coefficient: integer(1),
    }]]),
  };
}

function monomialFactor(poly: Polynomial): Polynomial {
  if (poly.terms.size === 0) return polynomialConstant(1);
  const terms = [...poly.terms.values()];
  const variables = new Set(terms.flatMap(term => [...term.monomial.powers.keys()]));
  const powers = new Map<string, number>();
  for (const name of variables) {
    const exponent = Math.min(...terms.map(term => term.monomial.powers.get(name) ?? 0));
    if (exponent > 0) powers.set(name, exponent);
  }
  return monomialPolynomial(powers);
}

function isUnitPolynomial(poly: Polynomial): boolean {
  if (poly.terms.size !== 1) return false;
  const term = [...poly.terms.values()][0]!;
  return term.monomial.powers.size === 0 && numericEqual(term.coefficient, integer(1));
}

function divideByMonomial(poly: Polynomial, monomial: Polynomial): Polynomial {
  if (monomial.terms.size !== 1) throw new TypeError("Expected a monomial divisor.");
  const divisor = [...monomial.terms.values()][0]!;
  let result = polynomialZero();
  for (const term of poly.terms.values()) {
    const powers = new Map(term.monomial.powers);
    for (const [name, exponent] of divisor.monomial.powers) {
      const current = powers.get(name) ?? 0;
      if (current < exponent) throw new Error("Monomial does not divide polynomial exactly.");
      if (current === exponent) powers.delete(name);
      else powers.set(name, current - exponent);
    }
    const coefficient = numericProduct(term.coefficient, numericInverse(divisor.coefficient));
    const monomialTerm = monomialPolynomial(powers);
    result = polynomialAdd(result, scalePolynomial(monomialTerm, coefficient));
  }
  return result;
}

function polynomialContent(poly: Polynomial): NumericExpr {
  if (poly.terms.size === 0) return integer(0);
  let numeratorGcd = 0n;
  let denominatorLcm = 1n;
  for (const term of poly.terms.values()) {
    const [n, d] = numericParts(term.coefficient);
    numeratorGcd = gcd(numeratorGcd, abs(n));
    denominatorLcm = lcm(denominatorLcm, d);
  }
  return rational(numeratorGcd, denominatorLcm) as NumericExpr;
}

function primitivePolynomial(poly: Polynomial): { content: NumericExpr; primitive: Polynomial } {
  const content = polynomialContent(poly);
  if (poly.terms.size === 0 || (content.kind === "Integer" && content.value === 0n)) {
    return { content, primitive: poly };
  }
  return { content, primitive: scalePolynomial(poly, numericInverse(content)) };
}

function polynomialEqual(a: Polynomial, b: Polynomial): boolean {
  return polynomialSubtract(a, b).terms.size === 0;
}

function integerSquareRoot(n: bigint): bigint | null {
  if (n < 0n) return null;
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + n / x) >> 1n;
  }
  return x * x === n ? x : null;
}

function rationalSquareRoot(value: NumericExpr): NumericExpr | null {
  const [n, d] = numericParts(value);
  if (n < 0n) return null;
  const sn = integerSquareRoot(n);
  const sd = integerSquareRoot(d);
  if (sn === null || sd === null || sd === 0n) return null;
  return rational(sn, sd) as NumericExpr;
}

function polynomialFromSingleTerm(term: PolynomialTerm): Polynomial {
  return scalePolynomial(monomialPolynomial(term.monomial.powers), term.coefficient);
}

function squareRootOfMonomialTerm(term: PolynomialTerm): Polynomial | null {
  const coefficient = rationalSquareRoot(term.coefficient);
  if (!coefficient) return null;
  const powers = new Map<string, number>();
  for (const [name, exponent] of term.monomial.powers) {
    if (exponent % 2 !== 0) return null;
    if (exponent > 0) powers.set(name, exponent / 2);
  }
  return scalePolynomial(monomialPolynomial(powers), coefficient);
}

function polynomialTotalDegree(poly: Polynomial): number {
  if (poly.terms.size === 0) return -1;
  return Math.max(...[...poly.terms.values()].map(term =>
    [...term.monomial.powers.values()].reduce((sum, exponent) => sum + exponent, 0)));
}

function productFactorizations(content: NumericExpr, parts: readonly Factorization[]): Factorization {
  let combinedContent = content;
  const factors: PolynomialFactor[] = [];
  for (const part of parts) {
    combinedContent = numericProduct(combinedContent, part.content);
    factors.push(...part.factors);
  }
  return { content: combinedContent, factors };
}

function factorDifferenceOfSquares(poly: Polynomial): readonly [Polynomial, Polynomial] | null {
  if (poly.terms.size !== 2) return null;
  const terms = [...poly.terms.values()];
  const firstSign = numericParts(terms[0]!.coefficient)[0] < 0n ? -1 : 1;
  const secondSign = numericParts(terms[1]!.coefficient)[0] < 0n ? -1 : 1;
  if (firstSign === secondSign) return null;
  const positive = terms[firstSign > 0 ? 0 : 1]!;
  const negative = terms[firstSign < 0 ? 0 : 1]!;
  const a = squareRootOfMonomialTerm(positive);
  const b = squareRootOfMonomialTerm({
    monomial: negative.monomial,
    coefficient: rational(-numericParts(negative.coefficient)[0], numericParts(negative.coefficient)[1]) as NumericExpr,
  });
  if (!a || !b) return null;
  const plus = polynomialAdd(a, b);
  const minus = polynomialSubtract(a, b);
  if (!polynomialEqual(polynomialMultiply(plus, minus), poly)) return null;
  return [plus, minus];
}

function factorPerfectSquareTrinomial(poly: Polynomial): Polynomial | null {
  if (poly.terms.size !== 3) return null;
  const terms = [...poly.terms.values()];
  for (let i = 0; i < terms.length; i++) {
    for (let j = i + 1; j < terms.length; j++) {
      const a = squareRootOfMonomialTerm(terms[i]!);
      const b = squareRootOfMonomialTerm(terms[j]!);
      if (!a || !b) continue;
      const plus = polynomialAdd(a, b);
      if (polynomialEqual(polynomialMultiply(plus, plus), poly)) return plus;
      const minus = polynomialSubtract(a, b);
      if (polynomialEqual(polynomialMultiply(minus, minus), poly)) return minus;
    }
  }
  return null;
}

function proportionalQuotient(a: Polynomial, b: Polynomial): NumericExpr | null {
  if (a.terms.size === 0 || b.terms.size === 0 || a.terms.size !== b.terms.size) return null;
  const rightByMonomial = new Map([...b.terms.values()].map(term => [monomialKey(term.monomial.powers), term]));
  const first = [...a.terms.values()][0]!;
  const matching = rightByMonomial.get(monomialKey(first.monomial.powers));
  if (!matching) return null;
  const ratio = rational(
    numericParts(first.coefficient)[0] * numericParts(matching.coefficient)[1],
    numericParts(first.coefficient)[1] * numericParts(matching.coefficient)[0],
  ) as NumericExpr;
  for (const term of a.terms.values()) {
    const other = rightByMonomial.get(monomialKey(term.monomial.powers));
    if (!other || !numericEqual(term.coefficient, numericProduct(other.coefficient, ratio))) return null;
  }
  return ratio;
}

function factorByGrouping(poly: Polynomial): readonly [Polynomial, Polynomial] | null {
  const terms = [...poly.terms.values()];
  // Searching partitions is exponential, so keep a conservative term limit.
  if (terms.length < 4 || terms.length > 12) return null;
  const n = terms.length;
  const maxMask = 1 << (n - 1);
  for (let mask = 1; mask < maxMask - 1; mask++) {
    // Anchor the first term on the left to avoid checking mirror partitions twice.
    const leftTerms = [terms[0]!];
    const rightTerms: PolynomialTerm[] = [];
    for (let i = 1; i < n; i++) {
      if ((mask & (1 << (i - 1))) !== 0) leftTerms.push(terms[i]!);
      else rightTerms.push(terms[i]!);
    }
    if (leftTerms.length < 2 || rightTerms.length < 2) continue;
    const leftPoly = leftTerms.reduce((acc, term) => polynomialAdd(acc, polynomialFromSingleTerm(term)), polynomialZero());
    const rightPoly = rightTerms.reduce((acc, term) => polynomialAdd(acc, polynomialFromSingleTerm(term)), polynomialZero());
    const leftMonomial = monomialFactor(leftPoly);
    const rightMonomial = monomialFactor(rightPoly);
    const leftQuotient = divideByMonomial(leftPoly, leftMonomial);
    const rightQuotient = divideByMonomial(rightPoly, rightMonomial);
    if (leftQuotient.terms.size <= 1 || rightQuotient.terms.size <= 1) continue;
    const ratio = proportionalQuotient(leftQuotient, rightQuotient);
    if (!ratio) continue;
    const combined = polynomialAdd(scalePolynomial(leftMonomial, ratio), rightMonomial);
    if (combined.terms.size <= 1) continue;
    if (polynomialTotalDegree(combined) >= polynomialTotalDegree(poly) ||
        polynomialTotalDegree(rightQuotient) >= polynomialTotalDegree(poly)) continue;
    if (!polynomialEqual(polynomialMultiply(combined, rightQuotient), poly)) continue;
    return [combined, rightQuotient];
  }
  return null;
}

function factorMultivariate(poly: Polynomial, depth = 0): Factorization {
  const { content, primitive } = primitivePolynomial(poly);
  if (primitive.terms.size <= 1 || depth >= 16) {
    return { content, factors: primitive.terms.size === 0 ? [] : [{ factor: primitive, multiplicity: 1 }] };
  }

  const common = monomialFactor(primitive);
  if (!isUnitPolynomial(common)) {
    const remainder = divideByMonomial(primitive, common);
    const remainderFactorization = factorPolynomial(remainder);
    return productFactorizations(content, [
      { content: integer(1), factors: [{ factor: common, multiplicity: 1 }] },
      remainderFactorization,
    ]);
  }

  const difference = factorDifferenceOfSquares(primitive);
  if (difference) {
    return productFactorizations(content, difference.map(factor => factorPolynomial(factor)));
  }

  const square = factorPerfectSquareTrinomial(primitive);
  if (square) {
    const baseFactorization = factorPolynomial(square);
    return {
      content: numericProduct(content, numericProduct(baseFactorization.content, baseFactorization.content)),
      factors: baseFactorization.factors.map(item => ({ factor: item.factor, multiplicity: item.multiplicity * 2 })),
    };
  }

  const grouped = factorByGrouping(primitive);
  if (grouped) {
    return productFactorizations(content, grouped.map(factor => factorPolynomial(factor)));
  }

  return { content, factors: [{ factor: primitive, multiplicity: 1 }] };
}


/** Derivative of a polynomial with respect to one variable. */
function derivativePolynomial(poly: Polynomial, variable: string): Polynomial {
  const terms: PolynomialTerm[] = [];
  for (const term of poly.terms.values()) {
    const exponent = term.monomial.powers.get(variable) ?? 0;
    if (exponent === 0) continue;
    const powers = new Map(term.monomial.powers);
    if (exponent === 1) powers.delete(variable);
    else powers.set(variable, exponent - 1);
    const coefficient = numericProduct(term.coefficient, integer(exponent));
    terms.push({ monomial: { powers }, coefficient });
  }
  return {
    kind: "Polynomial",
    terms: new Map(terms.map(term => [monomialKey(term.monomial.powers), term])),
  };
}

function monicPolynomial(poly: Polynomial, variable: string): Polynomial {
  if (poly.terms.size === 0) return poly;
  const degree = Math.max(...[...poly.terms.values()].map(term => term.monomial.powers.get(variable) ?? 0));
  const leading = coeffAt(poly, variable, degree);
  if (!leading) throw new Error("Unable to determine polynomial leading coefficient.");
  return scalePolynomial(poly, numericInverse(leading));
}

/** Euclidean GCD over Q[x], normalized to be monic. */
function polynomialGcd(a: Polynomial, b: Polynomial, variable: string): Polynomial {
  let left = monicPolynomial(a, variable);
  let right = monicPolynomial(b, variable);
  let iterations = 0;
  while (right.terms.size > 0) {
    if (++iterations > 1000) throw new RangeError("Polynomial GCD exceeded its safety limit.");
    const remainder = polynomialDivide(left, right).remainder;
    left = right;
    right = remainder.terms.size === 0 ? remainder : monicPolynomial(remainder, variable);
  }
  return left.terms.size === 0 ? left : monicPolynomial(left, variable);
}

function exactDivideForSquareFree(dividend: Polynomial, divisor: Polynomial): Polynomial {
  const division = polynomialDivide(dividend, divisor);
  if (division.remainder.terms.size !== 0) throw new Error("Square-free factorization expected exact polynomial division.");
  return division.quotient;
}

/**
 * Yun-style square-free decomposition. It isolates repeated polynomial factors
 * without needing to find their roots, which is useful for (x^2 + 1)^n.
 * Returns null when the polynomial is already square-free.
 */
function squareFreeDecomposition(poly: Polynomial, variable: string): PolynomialFactor[] | null {
  const derivative = derivativePolynomial(poly, variable);
  if (derivative.terms.size === 0) return null;
  let common = polynomialGcd(poly, derivative, variable);
  if (polynomialDegreeForFactor(common, variable) <= 0) return null;
  let remaining = exactDivideForSquareFree(poly, common);
  const result: PolynomialFactor[] = [];
  let multiplicity = 1;
  let guard = 0;
  while (polynomialDegreeForFactor(remaining, variable) > 0) {
    if (++guard > 1000) throw new RangeError("Square-free factorization exceeded its safety limit.");
    const shared = polynomialGcd(remaining, common, variable);
    const component = exactDivideForSquareFree(remaining, shared);
    if (polynomialDegreeForFactor(component, variable) > 0) {
      result.push({ factor: monicPolynomial(component, variable), multiplicity });
    }
    remaining = shared;
    common = exactDivideForSquareFree(common, shared);
    multiplicity++;
  }
  if (result.length === 0) return null;

  const rebuilt = result.reduce(
    (product, item) => polynomialMultiply(product, polynomialPow(item.factor, item.multiplicity)),
    polynomialConstant(1),
  );
  return polynomialSubtract(rebuilt, poly).terms.size === 0 ? result : null;
}

function polynomialDegreeForFactor(poly: Polynomial, variable: string): number {
  if (poly.terms.size === 0) return -1;
  return Math.max(...[...poly.terms.values()].map(term => term.monomial.powers.get(variable) ?? 0));
}

function findUnivariateVariable(poly: Polynomial): string | null | false {
  let found: string | null = null;
  for (const term of poly.terms.values()) {
    for (const variable of term.monomial.powers.keys()) {
      if (found !== null && found !== variable) return false;
      found = variable;
    }
  }
  return found;
}

/** Factor a univariate polynomial over the rationals using the rational-root theorem.
 * Factors that cannot be split over the rationals remain as a single polynomial.
 */
export function factorPolynomial(poly: Polynomial, variable?: string): Factorization {
  if (poly.terms.size === 0) return { content: integer(0), factors: [] };
  const detected = findUnivariateVariable(poly);
  if (detected === false) {
    return factorMultivariate(poly);
  }
  const x = variable ?? detected ?? "x";
  if (detected && variable && detected !== variable) {
    throw new TypeError(`Polynomial uses '${detected}', not '${variable}'.`);
  }

  let remaining = poly;
  const roots: { root: NumericExpr; multiplicity: number }[] = [];
  while (remaining.terms.size > 0) {
    const root = findRationalRoot(remaining, x);
    if (root === null) break;
    const divided = polynomialDivide(remaining, linearFactor(x, root));
    if (divided.remainder.terms.size !== 0) break;
    const existing = roots.find(r => {
      const a = r.root, b = root;
      const [an, ad] = numericParts(a), [bn, bd] = numericParts(b);
      return an * bd === bn * ad;
    });
    if (existing) existing.multiplicity++;
    else roots.push({ root, multiplicity: 1 });
    remaining = divided.quotient;
  }

  // Preserve the exact scalar by dividing out the leading coefficient of the
  // remaining polynomial, then expose it as `content`.
  const degree = Math.max(0, ...[...remaining.terms.values()].map(t => t.monomial.powers.get(x) ?? 0));
  const leading = coeffAt(remaining, x, degree) ?? integer(1);
  let content: NumericExpr = leading;
  if (remaining.terms.size === 0) content = integer(0);
  let normalized = remaining;
  if (!(leading.kind === "Integer" && leading.value === 1n)) {
    const scalarInverse = rational(numericParts(leading)[1], numericParts(leading)[0]) as NumericExpr;
    normalized = polynomialMultiply(remaining, polynomialConstant(scalarInverse));
  }

  const factors: PolynomialFactor[] = roots.map(({ root, multiplicity }) => ({
    factor: linearFactor(x, root), multiplicity
  }));

  // Recover repeated irreducible factors such as (x^2 + 1)^n without having
  // to factor the irreducible polynomial into roots.
  const squareFreeFactors = squareFreeDecomposition(normalized, x);
  if (squareFreeFactors) {
    factors.push(...squareFreeFactors);
    return { content, factors };
  }

  if (normalized.terms.size > 1 || (normalized.terms.size === 1 && factors.length === 0)) {
    factors.push({ factor: normalized, multiplicity: 1 });
  } else if (normalized.terms.size === 1 && factors.length > 0) {
    // A constant normalized remainder is already represented by `content`.
  }
  return { content, factors };
}

/** Return a product expression for a factorization, suitable for display/use in the CAS. */
function factorizationToExpr(result: Factorization): Expr {
  const factors: Expr[] = [];
  if (!(result.content.kind === "Integer" && result.content.value === 1n)) {
    factors.push(result.content.kind === "Integer"
      ? integer(result.content.value)
      : rational(result.content.numerator, result.content.denominator));
  }
  for (const item of result.factors) {
    const expression = polynomialToExpr(item.factor);
    factors.push(item.multiplicity === 1 ? expression : pow(expression, integer(item.multiplicity)));
  }
  return mul(...factors);
}

/** Return a product expression for a factorization, suitable for display/use in the CAS. */
export function factor(expr: Expr, variable?: string): Expr {
  return factorizationToExpr(factorPolynomial(polynomialFromExpr(expr), variable));
}

/** Factor an expression and report the supported algorithmic stages used. */
export function factorWithSteps(expr: Expr, variable?: string): FactorizationExplanation {
  const polynomial = polynomialFromExpr(expr);
  const factorization = factorPolynomial(polynomial, variable);
  const polynomialExpression = polynomialToExpr(polynomial);
  const expression = factorizationToExpr(factorization);
  const variables = new Set(
    [...polynomial.terms.values()].flatMap(term => [...term.monomial.powers.keys()]),
  );
  const univariate = variables.size <= 1;
  const factors = factorization.factors.map(item => ({
    expression: polynomialToExpr(item.factor),
    multiplicity: item.multiplicity,
  }));
  const rule = univariate
    ? "factor-univariate-over-rationals" as const
    : "factor-multivariate-patterns" as const;
  return {
    expression,
    factorization,
    steps: [
      { rule: "convert-to-polynomial", input: expr, output: polynomialExpression },
      {
        rule,
        input: polynomialExpression,
        output: expression,
        content: factorization.content,
        factors,
      },
      { rule: "reconstruct-factorization", input: polynomialExpression, output: expression },
    ],
  };
}

/** Verify the trace structure and prove the claimed factorization by exact polynomial expansion. */
export function verifyFactorizationExplanation(
  expression: Expr,
  explanation: FactorizationExplanation,
): FactorizationVerificationResult {
  try {
    if (explanation.steps.length !== 3 ||
        explanation.steps[0]!.rule !== "convert-to-polynomial" ||
        explanation.steps[1]!.rule !== "factor-univariate-over-rationals" &&
        explanation.steps[1]!.rule !== "factor-multivariate-patterns" ||
        explanation.steps[2]!.rule !== "reconstruct-factorization") {
      return { valid: false, errors: ["Factorization trace has an invalid sequence of rules."] };
    }

    const [conversion, factorStep, reconstruction] = explanation.steps;
    if (structuralKey(conversion!.input) !== structuralKey(expression)) {
      return { valid: false, errors: ["Factorization trace is not bound to the expected expression."] };
    }
    const inputPolynomial = polynomialFromExpr(conversion!.input);
    const canonicalInput = polynomialToExpr(inputPolynomial);
    if (structuralKey(canonicalInput) !== structuralKey(conversion!.output) ||
        structuralKey(conversion!.output) !== structuralKey(factorStep!.input) ||
        structuralKey(factorStep!.input) !== structuralKey(reconstruction!.input)) {
      return { valid: false, errors: ["Factorization trace has inconsistent polynomial inputs."] };
    }

    const reconstructed = factorizationToExpr(explanation.factorization);
    if (structuralKey(reconstructed) !== structuralKey(explanation.expression) ||
        structuralKey(factorStep!.output) !== structuralKey(explanation.expression) ||
        structuralKey(reconstruction!.output) !== structuralKey(explanation.expression)) {
      return { valid: false, errors: ["Factorization output does not match its factor data."] };
    }

    const outputPolynomial = polynomialFromExpr(explanation.expression);
    if (structuralKey(polynomialToExpr(inputPolynomial)) !==
        structuralKey(polynomialToExpr(outputPolynomial))) {
      return { valid: false, errors: ["Expanded factors do not equal the original polynomial."] };
    }

    const expectedFactors = explanation.factorization.factors.map(item => ({
      expression: polynomialToExpr(item.factor),
      multiplicity: item.multiplicity,
    }));
    const variables = new Set(
      [...inputPolynomial.terms.values()].flatMap(term => [...term.monomial.powers.keys()]),
    );
    const expectedRule = variables.size <= 1
      ? "factor-univariate-over-rationals"
      : "factor-multivariate-patterns";
    if (factorStep!.rule !== expectedRule ||
        structuralKey(factorStep!.content!) !== structuralKey(explanation.factorization.content) ||
        factorStep!.factors?.length !== expectedFactors.length ||
        expectedFactors.some((factor, index) =>
          factorStep!.factors![index]!.multiplicity !== factor.multiplicity ||
          structuralKey(factorStep!.factors![index]!.expression) !== structuralKey(factor.expression))) {
      return { valid: false, errors: ["Factorization step does not list the certified factors."] };
    }

    return { valid: true, errors: [] };
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : "Could not verify factorization explanation."],
    };
  }
}
