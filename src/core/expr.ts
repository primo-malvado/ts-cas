export type Expr =
  | IntegerExpr | RationalExpr | SymbolExpr
  | AddExpr | MulExpr | PowExpr | FunctionExpr;

export interface IntegerExpr { readonly kind: "Integer"; readonly value: bigint }
export interface RationalExpr { readonly kind: "Rational"; readonly numerator: bigint; readonly denominator: bigint }
export interface SymbolExpr { readonly kind: "Symbol"; readonly name: string }
export interface AddExpr { readonly kind: "Add"; readonly terms: readonly Expr[] }
export interface MulExpr { readonly kind: "Mul"; readonly factors: readonly Expr[] }
export interface PowExpr { readonly kind: "Pow"; readonly base: Expr; readonly exponent: Expr }
export interface FunctionExpr { readonly kind: "Function"; readonly name: string; readonly args: readonly Expr[] }

export type NumericExpr = IntegerExpr | RationalExpr;

export function integer(value: bigint | number): IntegerExpr {
  return { kind: "Integer", value: BigInt(value) };
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function rational(numerator: bigint, denominator: bigint): Expr {
  if (denominator === 0n) throw new RangeError("A rational denominator cannot be zero.");
  if (numerator === 0n) return integer(0);
  const divisor = gcd(numerator, denominator);
  let n = numerator / divisor;
  let d = denominator / divisor;
  if (d < 0n) { n = -n; d = -d; }
  return d === 1n
    ? integer(n)
    : { kind: "Rational", numerator: n, denominator: d };
}

export function symbol(name: string): SymbolExpr {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid symbol name: ${name}`);
  return { kind: "Symbol", name };
}

export function isNumeric(expr: Expr): expr is NumericExpr {
  return expr.kind === "Integer" || expr.kind === "Rational";
}

export function numericParts(expr: NumericExpr): [bigint, bigint] {
  return expr.kind === "Integer" ? [expr.value, 1n] : [expr.numerator, expr.denominator];
}

export function numericAdd(a: NumericExpr, b: NumericExpr): Expr {
  const [an, ad] = numericParts(a), [bn, bd] = numericParts(b);
  return rational(an * bd + bn * ad, ad * bd);
}

export function numericMul(a: NumericExpr, b: NumericExpr): Expr {
  const [an, ad] = numericParts(a), [bn, bd] = numericParts(b);
  return rational(an * bn, ad * bd);
}

export function numericDiv(a: NumericExpr, b: NumericExpr): Expr {
  const [an, ad] = numericParts(a), [bn, bd] = numericParts(b);
  if (bn === 0n) throw new RangeError("Division by zero.");
  return rational(an * bd, ad * bn);
}

export function negate(expr: Expr): Expr {
  return mul(integer(-1), expr);
}

export function isZero(expr: Expr): boolean {
  return expr.kind === "Integer" && expr.value === 0n;
}
export function isOne(expr: Expr): boolean {
  return expr.kind === "Integer" && expr.value === 1n;
}

/** Stable structural key. This is a structural identity, not a proof of algebraic equivalence. */
export function structuralKey(expr: Expr): string {
  switch (expr.kind) {
    case "Integer": return `I:${expr.value}`;
    case "Rational": return `Q:${expr.numerator}/${expr.denominator}`;
    case "Symbol": return `S:${expr.name}`;
    case "Add": return `A(${expr.terms.map(structuralKey).join(",")})`;
    case "Mul": return `M(${expr.factors.map(structuralKey).join(",")})`;
    case "Pow": return `P(${structuralKey(expr.base)},${structuralKey(expr.exponent)})`;
    case "Function": return `F:${expr.name}(${expr.args.map(structuralKey).join(",")})`;
  }
}

export function equals(a: Expr, b: Expr): boolean {
  return structuralKey(a) === structuralKey(b);
}

const compareExpr = (a: Expr, b: Expr): number =>
  structuralKey(a).localeCompare(structuralKey(b));

function productRank(expr: Expr): number {
  if (isNumeric(expr)) return 0;
  switch (expr.kind) {
    case "Symbol": return 1;
    case "Pow": return 2;
    case "Function": return 3;
    case "Add": return 4;
    case "Mul": return 5;
  }
}

const compareProductFactors = (a: Expr, b: Expr): number =>
  productRank(a) - productRank(b) || compareExpr(a, b);

/** Canonical sum constructor: flattens nested sums, collects numeric constants, sorts terms. */
export function add(...input: Expr[]): Expr {
  const flat: Expr[] = [];
  for (const term of input) {
    if (term.kind === "Add") flat.push(...term.terms);
    else flat.push(term);
  }

  let constant: Expr = integer(0);
  const coefficients = new Map<string, { base: Expr; coefficient: NumericExpr }>();

  for (const term of flat) {
    let coefficient: NumericExpr = integer(1);
    let base: Expr | null = term;
    if (isNumeric(term)) {
      constant = numericAdd(constant as NumericExpr, term);
      continue;
    }
    if (term.kind === "Mul" && term.factors.length > 0) {
      // The canonical product order may place a function before its numeric
      // coefficient. Extract the coefficient wherever it occurs so like terms
      // such as exp(x) and -exp(x) can still cancel reliably.
      const coefficientIndex = term.factors.findIndex(isNumeric);
      if (coefficientIndex >= 0) {
        coefficient = term.factors[coefficientIndex] as NumericExpr;
        const rest = term.factors.filter((_, index) => index !== coefficientIndex);
        base = rest.length === 1 ? rest[0]! : mul(...rest);
      }
    }
    const key = structuralKey(base);
    const previous = coefficients.get(key);
    coefficients.set(key, {
      base,
      coefficient: previous
        ? numericAdd(previous.coefficient, coefficient) as NumericExpr
        : coefficient
    });
  }

  const terms: Expr[] = [];
  if (!isZero(constant)) terms.push(constant);
  for (const { base, coefficient } of coefficients.values()) {
    if (isZero(coefficient)) continue;
    terms.push(isOne(coefficient) ? base : mul(coefficient, base));
  }
  terms.sort(compareExpr);
  if (terms.length === 0) return integer(0);
  if (terms.length === 1) return terms[0]!;
  return { kind: "Add", terms };
}

/** Canonical product constructor: flattens products and combines exact numeric coefficients. */
export function mul(...input: Expr[]): Expr {
  const flat: Expr[] = [];
  for (const factor of input) {
    if (factor.kind === "Mul") flat.push(...factor.factors);
    else flat.push(factor);
  }

  let coefficient: Expr = integer(1);
  const rest: Expr[] = [];
  for (const factor of flat) {
    if (isNumeric(factor)) coefficient = numericMul(coefficient as NumericExpr, factor);
    else rest.push(factor);
  }
  if (isZero(coefficient)) return integer(0);

  // Combine repeated bases with integer exponents: x*x*x -> x^3; x^2*x^3 -> x^5.
  // If exponents cancel to zero (x/x), preserve the original factors instead of
  // replacing them with 1. This retains the original domain restriction x != 0.
  const powers = new Map<string, { base: Expr; exponent: bigint; originals: Expr[] }>();
  const other: Expr[] = [];
  for (const factor of rest) {
    let base = factor;
    let exponent = 1n;
    if (factor.kind === "Pow" && factor.exponent.kind === "Integer") {
      base = factor.base;
      exponent = factor.exponent.value;
    } else if (factor.kind === "Pow") {
      other.push(factor);
      continue;
    }
    const key = structuralKey(base);
    const previous = powers.get(key);
    powers.set(key, {
      base,
      exponent: (previous?.exponent ?? 0n) + exponent,
      originals: [...(previous?.originals ?? []), factor],
    });
  }

  const factors: Expr[] = [];
  if (!isOne(coefficient) || (powers.size === 0 && other.length === 0)) factors.push(coefficient);
  for (const { base, exponent, originals } of powers.values()) {
    if (exponent === 0n) {
      factors.push(...originals);
      continue;
    }
    factors.push(exponent === 1n ? base : pow(base, integer(exponent)));
  }
  factors.push(...other);
  // For chain-rule products containing a coefficient, a variable and a function,
  // prefer the conventional derivative order: coefficient, variable, function.
  // Keep the established canonical ordering for other products to avoid changing
  // the presentation of radical and factorization results.
  const hasNumeric = factors.some(isNumeric);
  const hasSymbol = factors.some(factor => factor.kind === "Symbol");
  const hasFunction = factors.some(factor => factor.kind === "Function");
  factors.sort(hasNumeric && hasSymbol && hasFunction ? compareProductFactors : compareExpr);
  if (factors.length === 0) return integer(1);
  if (factors.length === 1) return factors[0]!;
  return { kind: "Mul", factors };
}

/** Canonical power constructor with safe elementary identities. */
export function pow(base: Expr, exponent: Expr): Expr {
  if (exponent.kind === "Integer") {
    if (exponent.value === 1n) return base;
    if (exponent.value === 0n) {
      if (isZero(base)) throw new RangeError("0^0 is undefined.");
      return integer(1);
    }
    if (base.kind === "Integer" && exponent.value > 0n && exponent.value <= 10000n) {
      return integer(base.value ** exponent.value);
    }
    if (base.kind === "Integer" && exponent.value < 0n && exponent.value >= -10000n) {
      if (base.value === 0n) throw new RangeError("Zero cannot be raised to a negative power.");
      return rational(1n, base.value ** (-exponent.value));
    }
    if (base.kind === "Rational" && exponent.value > 0n && exponent.value <= 10000n) {
      return rational(base.numerator ** exponent.value, base.denominator ** exponent.value);
    }
    if (base.kind === "Rational" && exponent.value < 0n && exponent.value >= -10000n) {
      if (base.numerator === 0n) throw new RangeError("Zero cannot be raised to a negative power.");
      return rational(base.denominator ** (-exponent.value), base.numerator ** (-exponent.value));
    }
    if (isOne(base)) return integer(1);
  }
  if (base.kind === "Integer" && base.value === 0n && exponent.kind === "Integer" && exponent.value > 0n) {
    return integer(0);
  }
  if (base.kind === "Integer" && base.value === 1n) return integer(1);
  return { kind: "Pow", base, exponent };
}

export function fn(name: string, ...args: Expr[]): FunctionExpr {
  return { kind: "Function", name, args };
}
