import {
  add, integer, isNumeric, isZero, mul, numericAdd, numericDiv, numericMul,
  numericParts, pow, rational, type Expr, type NumericExpr,
} from "../core/expr.js";

export interface Monomial {
  /** Variable name -> non-negative integer exponent. Missing variables have exponent 0. */
  readonly powers: ReadonlyMap<string, number>;
}

export interface PolynomialTerm {
  readonly monomial: Monomial;
  readonly coefficient: NumericExpr;
}

/** Sparse multivariate polynomial with exact rational coefficients. */
export interface Polynomial {
  readonly kind: "Polynomial";
  readonly terms: ReadonlyMap<string, PolynomialTerm>;
}


function asNumeric(expr: Expr): NumericExpr {
  if (!isNumeric(expr)) throw new TypeError("Expected an exact numeric coefficient.");
  return expr;
}

function canonicalPowers(powers: Iterable<[string, number]>): Map<string, number> {
  const result = new Map<string, number>();
  for (const [name, exponent] of powers) {
    if (!Number.isSafeInteger(exponent) || exponent < 0) {
      throw new RangeError("Polynomial exponents must be non-negative safe integers.");
    }
    if (exponent !== 0) result.set(name, (result.get(name) ?? 0) + exponent);
  }
  for (const [name, exponent] of result) if (exponent === 0) result.delete(name);
  return new Map([...result].sort(([a], [b]) => a.localeCompare(b)));
}

function monomialKey(powers: ReadonlyMap<string, number>): string {
  return [...powers].map(([name, exponent]) => `${name.length}:${name}^${exponent}`).join("*") || "1";
}

function multiplyMonomials(a: Monomial, b: Monomial): Monomial {
  return { powers: canonicalPowers([...a.powers, ...b.powers]) };
}

function monomialDegree(monomial: Monomial, variable?: string): number {
  if (variable !== undefined) return monomial.powers.get(variable) ?? 0;
  return [...monomial.powers.values()].reduce((sum, exponent) => sum + exponent, 0);
}

function compareMonomials(a: Monomial, b: Monomial): number {
  const names = [...new Set([...a.powers.keys(), ...b.powers.keys()])].sort();
  for (const name of names) {
    const diff = (b.powers.get(name) ?? 0) - (a.powers.get(name) ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function polynomialZero(): Polynomial {
  return { kind: "Polynomial", terms: new Map() };
}

export function polynomialConstant(value: NumericExpr | bigint | number): Polynomial {
  const coefficient = typeof value === "bigint" || typeof value === "number" ? integer(value) : value;
  if (isZero(coefficient)) return polynomialZero();
  const powers = new Map<string, number>();
  return {
    kind: "Polynomial",
    terms: new Map([[monomialKey(powers), { monomial: { powers }, coefficient }]])
  };
}

export function polynomialVariable(name: string): Polynomial {
  const powers = new Map([[name, 1]]);
  return {
    kind: "Polynomial",
    terms: new Map([[monomialKey(powers), { monomial: { powers }, coefficient: integer(1) }]])
  };
}

function fromTerms(input: Iterable<PolynomialTerm>): Polynomial {
  const combined = new Map<string, PolynomialTerm>();
  for (const term of input) {
    const powers = canonicalPowers(term.monomial.powers);
    if (isZero(term.coefficient)) continue;
    const key = monomialKey(powers);
    const previous = combined.get(key);
    const coefficient = previous
      ? asNumeric(numericAdd(previous.coefficient, term.coefficient))
      : term.coefficient;
    if (isZero(coefficient)) combined.delete(key);
    else combined.set(key, { monomial: { powers }, coefficient });
  }
  const ordered = [...combined.entries()].sort((a, b) => compareMonomials(a[1].monomial, b[1].monomial));
  return { kind: "Polynomial", terms: new Map(ordered) };
}

export function polynomialAdd(a: Polynomial, b: Polynomial): Polynomial {
  return fromTerms([...a.terms.values(), ...b.terms.values()]);
}

export function polynomialNegate(a: Polynomial): Polynomial {
  return fromTerms([...a.terms.values()].map(t => ({
    monomial: t.monomial,
    coefficient: asNumeric(mul(integer(-1), t.coefficient))
  })));
}

export function polynomialSubtract(a: Polynomial, b: Polynomial): Polynomial {
  return polynomialAdd(a, polynomialNegate(b));
}

export function polynomialMultiply(a: Polynomial, b: Polynomial): Polynomial {
  const terms: PolynomialTerm[] = [];
  for (const left of a.terms.values()) {
    for (const right of b.terms.values()) {
      terms.push({
        monomial: multiplyMonomials(left.monomial, right.monomial),
        coefficient: asNumeric(numericMul(left.coefficient, right.coefficient))
      });
    }
  }
  return fromTerms(terms);
}

export function polynomialPow(base: Polynomial, exponent: number): Polynomial {
  if (!Number.isSafeInteger(exponent) || exponent < 0) {
    throw new RangeError("Polynomial exponent must be a non-negative safe integer.");
  }
  let result = polynomialConstant(1);
  let factor = base;
  let n = exponent;
  while (n > 0) {
    if (n % 2 === 1) result = polynomialMultiply(result, factor);
    n = Math.floor(n / 2);
    if (n > 0) factor = polynomialMultiply(factor, factor);
  }
  return result;
}

function scalePolynomial(poly: Polynomial, coefficient: NumericExpr): Polynomial {
  return fromTerms([...poly.terms.values()].map(t => ({
    monomial: t.monomial,
    coefficient: asNumeric(numericMul(t.coefficient, coefficient))
  })));
}

/**
 * Converts a supported expression into a sparse polynomial.
 * Supports exact numbers, symbols, sums, products and non-negative integer powers.
 * Throws when the expression is not polynomial.
 */
export function polynomialFromExpr(expr: Expr): Polynomial {
  switch (expr.kind) {
    case "Integer":
    case "Rational":
      return polynomialConstant(expr);
    case "Symbol":
      return polynomialVariable(expr.name);
    case "Add":
      return expr.terms.reduce((acc, term) => polynomialAdd(acc, polynomialFromExpr(term)), polynomialZero());
    case "Mul":
      return expr.factors.reduce((acc, factor) => polynomialMultiply(acc, polynomialFromExpr(factor)), polynomialConstant(1));
    case "Pow":
      if (expr.exponent.kind !== "Integer" || expr.exponent.value < 0n || expr.exponent.value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new TypeError("Polynomial conversion only supports non-negative integer exponents.");
      }
      return polynomialPow(polynomialFromExpr(expr.base), Number(expr.exponent.value));
    case "Function":
      throw new TypeError(`Function '${expr.name}' is not a polynomial expression.`);
  }
}

function coefficientToExpr(coefficient: NumericExpr): Expr {
  return coefficient.kind === "Integer"
    ? integer(coefficient.value)
    : rational(coefficient.numerator, coefficient.denominator);
}

export function polynomialToExpr(poly: Polynomial): Expr {
  const terms: Expr[] = [];
  for (const { monomial, coefficient } of poly.terms.values()) {
    const factors: Expr[] = [];
    if (!(coefficient.kind === "Integer" && coefficient.value === 1n) || monomial.powers.size === 0) {
      factors.push(coefficientToExpr(coefficient));
    }
    for (const [name, exponent] of monomial.powers) {
      factors.push(exponent === 1 ? { kind: "Symbol", name } : pow({ kind: "Symbol", name }, integer(exponent)));
    }
    terms.push(mul(...factors));
  }
  return add(...terms);
}

export function polynomialDegree(poly: Polynomial, variable?: string): number {
  if (poly.terms.size === 0) return -1;
  return Math.max(...[...poly.terms.values()].map(t => monomialDegree(t.monomial, variable)));
}

export function polynomialCoefficient(poly: Polynomial, variable: string, exponent: number): Polynomial {
  if (!Number.isSafeInteger(exponent) || exponent < 0) throw new RangeError("Exponent must be a non-negative integer.");
  const terms: PolynomialTerm[] = [];
  for (const term of poly.terms.values()) {
    if ((term.monomial.powers.get(variable) ?? 0) !== exponent) continue;
    const powers = new Map(term.monomial.powers);
    powers.delete(variable);
    terms.push({ monomial: { powers }, coefficient: term.coefficient });
  }
  return fromTerms(terms);
}

export function polynomialEvaluate(poly: Polynomial, values: Readonly<Record<string, number>>): number {
  let result = 0;
  for (const { monomial, coefficient } of poly.terms.values()) {
    const [n, d] = numericParts(coefficient);
    let term = Number(n) / Number(d);
    for (const [name, exponent] of monomial.powers) {
      if (!(name in values)) throw new Error(`Missing value for variable '${name}'.`);
      term *= values[name]! ** exponent;
    }
    result += term;
  }
  return result;
}

function univariateVariable(poly: Polynomial): string | null {
  let variable: string | null = null;
  for (const term of poly.terms.values()) {
    for (const name of term.monomial.powers.keys()) {
      if (variable !== null && variable !== name) {
        throw new TypeError("Polynomial division requires univariate polynomials.");
      }
      variable = name;
    }
  }
  return variable;
}

function leadingTerm(poly: Polynomial): PolynomialTerm | null {
  let best: PolynomialTerm | null = null;
  for (const term of poly.terms.values()) {
    if (!best || monomialDegree(term.monomial) > monomialDegree(best.monomial)) best = term;
  }
  return best;
}

/** Univariate polynomial long division over exact rational coefficients. */
export function polynomialDivide(
  dividend: Polynomial,
  divisor: Polynomial
): { quotient: Polynomial; remainder: Polynomial } {
  if (divisor.terms.size === 0) throw new RangeError("Polynomial division by zero.");
  const aVar = univariateVariable(dividend);
  const bVar = univariateVariable(divisor);
  if (aVar && bVar && aVar !== bVar) throw new TypeError("Dividend and divisor must use the same variable.");
  const variable = aVar ?? bVar ?? "x";
  let remainder = dividend;
  let quotient = polynomialZero();
  const divisorLead = leadingTerm(divisor)!;
  const divisorDegree = divisorLead.monomial.powers.get(variable) ?? 0;

  while (remainder.terms.size > 0) {
    const remLead = leadingTerm(remainder)!;
    const remDegree = remLead.monomial.powers.get(variable) ?? 0;
    if (remDegree < divisorDegree) break;
    const exponent = remDegree - divisorDegree;
    const coefficient = asNumeric(numericDiv(remLead.coefficient, divisorLead.coefficient));
    const termPowers = new Map<string, number>();
    if (exponent > 0) termPowers.set(variable, exponent);
    const term: Polynomial = fromTerms([{ monomial: { powers: termPowers }, coefficient }]);
    quotient = polynomialAdd(quotient, term);
    remainder = polynomialSubtract(remainder, polynomialMultiply(term, divisor));
  }
  return { quotient, remainder };
}

/** True when every term contains only the supplied variable (or is constant). */
export function isUnivariatePolynomial(poly: Polynomial, variable?: string): boolean {
  try {
    const found = univariateVariable(poly);
    return variable === undefined || found === null || found === variable;
  } catch {
    return false;
  }
}
