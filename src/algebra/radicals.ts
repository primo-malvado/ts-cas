import {
  add, fn, integer, isNumeric, mul, numericParts, pow, rational, type Expr, type NumericExpr,
} from "../core/expr.js";

function perfectSquareRoot(value: bigint): bigint | null {
  if (value < 0n) return null;
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x * x === value ? x : null;
}

/** Return the exact non-negative rational square root, if it exists. */
export function exactRationalSquareRoot(value: NumericExpr): Expr | null {
  const [numerator, denominator] = numericParts(value);
  const rootNumerator = perfectSquareRoot(numerator);
  const rootDenominator = perfectSquareRoot(denominator);
  return rootNumerator !== null && rootDenominator !== null
    ? rational(rootNumerator, rootDenominator)
    : null;
}

/** Return n = outside^2 * inside, with inside square-free, for modest positive integers. */
function squareFreeParts(value: bigint): { outside: bigint; inside: bigint } {
  if (value < 0n) throw new RangeError("squareFreeParts expects a non-negative integer.");
  if (value < 2n) return { outside: 1n, inside: value };
  let remaining = value;
  let outside = 1n;
  let inside = 1n;
  for (let prime = 2n; prime * prime <= remaining; prime = prime === 2n ? 3n : prime + 2n) {
    if (remaining % prime !== 0n) continue;
    let count = 0;
    while (remaining % prime === 0n) {
      remaining /= prime;
      count++;
    }
    for (let i = 0; i < Math.floor(count / 2); i++) outside *= prime;
    if (count % 2 === 1) inside *= prime;
  }
  if (remaining > 1n) inside *= remaining;
  return { outside, inside };
}

function isZeroNumeric(value: NumericExpr): boolean {
  return value.kind === "Integer" ? value.value === 0n : value.numerator === 0n;
}

function sqrtNumeric(value: NumericExpr): Expr {
  const [numerator, denominator] = numericParts(value);
  if (numerator < 0n) {
    const positive = rational(-numerator, denominator) as NumericExpr;
    return mul(integer(1), symbolI(), sqrtNumeric(positive));
  }
  if (numerator === 0n) return integer(0);
  // sqrt(n/d) = sqrt(n*d)/d, preserving an exact rational expression.
  const { outside, inside } = squareFreeParts(numerator * denominator);
  if (inside === 1n) return rational(outside, denominator) as Expr;
  const radical = fn("sqrt", integer(inside));
  return outside === denominator
    ? radical
    : mul(rational(outside, denominator) as Expr, radical);
}

function symbolI(): Expr {
  return { kind: "Symbol", name: "i" };
}

/**
 * Simplify square roots of exact rational numbers, extract square factors,
 * reduce i^n, and recursively simplify sums/products/powers.
 */
export function simplifyRadicals(expr: Expr): Expr {
  switch (expr.kind) {
    case "Integer":
    case "Rational":
    case "Symbol":
      return expr;
    case "Function": {
      const args = expr.args.map(simplifyRadicals);
      if (expr.name === "sqrt" && args.length === 1 && isNumeric(args[0]!)) {
        return sqrtNumeric(args[0]!);
      }
      return fn(expr.name, ...args);
    }
    case "Add":
      return add(...expr.terms.map(simplifyRadicals));
    case "Mul":
      return mul(...expr.factors.map(simplifyRadicals));
    case "Pow": {
      const base = simplifyRadicals(expr.base);
      const exponent = simplifyRadicals(expr.exponent);
      if (base.kind === "Symbol" && base.name === "i" && exponent.kind === "Integer") {
        const power = ((exponent.value % 4n) + 4n) % 4n;
        if (power === 0n) return integer(1);
        if (power === 1n) return symbolI();
        if (power === 2n) return integer(-1);
        return mul(integer(-1), symbolI());
      }
      if (base.kind === "Function" && base.name === "sqrt" && base.args.length === 1 &&
          exponent.kind === "Integer" && exponent.value === 2n) {
        return base.args[0]!;
      }
      if (base.kind === "Function" && base.name === "sqrt" && base.args.length === 1 &&
          exponent.kind === "Integer" && exponent.value === 1n) return base;
      return pow(base, exponent);
    }
  }
}
