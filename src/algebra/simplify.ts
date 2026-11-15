import type { Expr } from "../core/expr.js";
import {
  add,
  equals,
  fn,
  integer,
  isNumeric,
  mul,
  numericParts,
  pow,
  rational,
  structuralKey,
} from "../core/expr.js";
import { exactRationalSquareRoot } from "./radicals.js";

function isProvablyPositive(expr: Expr): boolean {
  if (isNumeric(expr)) return numericParts(expr)[0] > 0n;
  if (expr.kind === "Symbol") return expr.name === "E" || expr.name === "pi";
  if (expr.kind === "Function") return expr.name === "exp" && expr.args.length === 1;
  if (expr.kind === "Mul") return expr.factors.every(isProvablyPositive);
  return expr.kind === "Pow" && isProvablyPositive(expr.base);
}

function positiveRemainder(value: bigint, modulus: bigint): bigint {
  const remainder = value % modulus;
  return remainder < 0n ? remainder + modulus : remainder;
}

function piMultiple(expr: Expr): { numerator: bigint; denominator: bigint } | null {
  if (isNumeric(expr)) {
    const [numerator, denominator] = numericParts(expr);
    return numerator === 0n ? { numerator: 0n, denominator: 1n } : null;
  }

  const factors = expr.kind === "Mul" ? expr.factors : [expr];
  let containsPi = false;
  let numerator = 1n;
  let denominator = 1n;

  for (const factor of factors) {
    if (factor.kind === "Symbol" && factor.name === "pi" && !containsPi) {
      containsPi = true;
      continue;
    }
    if (!isNumeric(factor)) return null;
    const [factorNumerator, factorDenominator] = numericParts(factor);
    numerator *= factorNumerator;
    denominator *= factorDenominator;
  }

  if (!containsPi) return null;
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  return { numerator, denominator };
}

function fractionEquals(
  numerator: bigint,
  denominator: bigint,
  targetNumerator: bigint,
  targetDenominator: bigint,
): boolean {
  return numerator * targetDenominator === targetNumerator * denominator;
}

function exactFirstQuadrantValue(
  name: "sin" | "cos",
  numerator: bigint,
  denominator: bigint,
): Expr | null {
  if (fractionEquals(numerator, denominator, 0n, 1n)) {
    return integer(name === "sin" ? 0 : 1);
  }
  if (fractionEquals(numerator, denominator, 1n, 6n)) {
    return name === "sin"
      ? rational(1n, 2n)
      : mul(rational(1n, 2n), fn("sqrt", integer(3)));
  }
  if (fractionEquals(numerator, denominator, 1n, 4n)) {
    return mul(rational(1n, 2n), fn("sqrt", integer(2)));
  }
  if (fractionEquals(numerator, denominator, 1n, 3n)) {
    return name === "sin"
      ? mul(rational(1n, 2n), fn("sqrt", integer(3)))
      : rational(1n, 2n);
  }
  if (fractionEquals(numerator, denominator, 1n, 2n)) {
    return integer(name === "sin" ? 1 : 0);
  }
  return null;
}

function exactTrigValue(name: "sin" | "cos", argument: Expr): Expr | null {
  const multiple = piMultiple(argument);
  if (!multiple) return null;

  const { denominator } = multiple;
  const numerator = positiveRemainder(multiple.numerator, 2n * denominator);
  let referenceNumerator: bigint;
  let sineSign = 1n;
  let cosineSign = 1n;

  if (2n * numerator <= denominator) {
    referenceNumerator = numerator;
  } else if (numerator <= denominator) {
    referenceNumerator = denominator - numerator;
    cosineSign = -1n;
  } else if (2n * numerator <= 3n * denominator) {
    referenceNumerator = numerator - denominator;
    sineSign = -1n;
    cosineSign = -1n;
  } else {
    referenceNumerator = 2n * denominator - numerator;
    cosineSign = 1n;
    sineSign = -1n;
  }

  const value = exactFirstQuadrantValue(name, referenceNumerator, denominator);
  if (!value) return null;
  const sign = name === "sin" ? sineSign : cosineSign;
  return sign < 0n ? mul(integer(-1), value) : value;
}

function powerParts(expr: Expr): { base: Expr; exponent: Expr } {
  return expr.kind === "Pow"
    ? { base: expr.base, exponent: expr.exponent }
    : { base: expr, exponent: integer(1) };
}

function combinePowerFactors(factors: readonly Expr[]): Expr[] {
  const sameBaseGroups = new Map<string, { base: Expr; exponents: Expr[]; indexes: number[] }>();
  for (let index = 0; index < factors.length; index++) {
    const factor = factors[index]!;
    if (isNumeric(factor)) continue;
    const { base, exponent } = powerParts(factor);
    if (!isProvablyPositive(base)) continue;
    const key = structuralKey(base);
    const group = sameBaseGroups.get(key) ?? { base, exponents: [], indexes: [] };
    group.exponents.push(exponent);
    group.indexes.push(index);
    sameBaseGroups.set(key, group);
  }

  const consumed = new Set<number>();
  const combinedBases: Expr[] = [];
  for (const group of sameBaseGroups.values()) {
    if (group.indexes.length < 2) continue;
    for (const index of group.indexes) consumed.add(index);
    combinedBases.push(pow(group.base, add(...group.exponents)));
  }

  const afterBaseCombine = [
    ...factors.filter((_, index) => !consumed.has(index)),
    ...combinedBases,
  ];
  const sameExponentGroups = new Map<string, { exponent: Expr; factors: Expr[]; bases: Expr[] }>();
  for (const factor of afterBaseCombine) {
    if (isNumeric(factor)) continue;
    const { base, exponent } = powerParts(factor);
    if (exponent.kind !== "Integer") continue;
    const key = structuralKey(exponent);
    const group = sameExponentGroups.get(key) ?? { exponent, factors: [], bases: [] };
    group.factors.push(factor);
    group.bases.push(base);
    sameExponentGroups.set(key, group);
  }

  const groupedFactors = new Set<Expr>();
  const combinedExponents: Expr[] = [];
  for (const group of sameExponentGroups.values()) {
    if (group.bases.length < 2 || (group.exponent.kind === "Integer" && group.exponent.value === 1n)) continue;
    for (const factor of group.factors) groupedFactors.add(factor);
    combinedExponents.push(pow(mul(...group.bases), group.exponent));
  }

  return [
    ...afterBaseCombine.filter(factor => !groupedFactors.has(factor)),
    ...combinedExponents,
  ];
}

interface TrigSquare {
  readonly name: "sin" | "cos";
  readonly argument: Expr;
  readonly coefficient: Expr;
}

function trigSquare(term: Expr): TrigSquare | null {
  const factors = term.kind === "Mul" ? term.factors : [term];
  let match: TrigSquare | null = null;
  const otherFactors: Expr[] = [];

  for (const factor of factors) {
    if (
      factor.kind === "Pow" &&
      factor.exponent.kind === "Integer" &&
      factor.exponent.value === 2n &&
      factor.base.kind === "Function" &&
      (factor.base.name === "sin" || factor.base.name === "cos") &&
      factor.base.args.length === 1
    ) {
      if (match) return null;
      match = {
        name: factor.base.name,
        argument: factor.base.args[0]!,
        coefficient: integer(1),
      };
    } else {
      otherFactors.push(factor);
    }
  }

  return match
    ? { ...match, coefficient: otherFactors.length > 0 ? simplify(mul(...otherFactors)) : integer(1) }
    : null;
}

function simplifyPythagoreanIdentity(terms: readonly Expr[]): Expr | null {
  const squares = terms.map(trigSquare);

  for (let left = 0; left < terms.length; left++) {
    const first = squares[left];
    if (!first) continue;
    for (let right = left + 1; right < terms.length; right++) {
      const second = squares[right];
      if (
        second &&
        first.name !== second.name &&
        equals(first.argument, second.argument) &&
        equals(first.coefficient, second.coefficient)
      ) {
        return add(
          ...terms.filter((_, index) => index !== left && index !== right),
          first.coefficient,
        );
      }
    }
  }

  for (let squareIndex = 0; squareIndex < terms.length; squareIndex++) {
    const square = squares[squareIndex];
    if (!square) continue;
    for (let constantIndex = 0; constantIndex < terms.length; constantIndex++) {
      if (constantIndex === squareIndex) continue;
      if (!equals(simplify(add(terms[constantIndex]!, square.coefficient)), integer(0))) continue;
      const complementaryName = square.name === "sin" ? "cos" : "sin";
      const replacement = mul(
        integer(-1),
        square.coefficient,
        pow(fn(complementaryName, square.argument), integer(2)),
      );
      return add(
        ...terms.filter((_, index) => index !== squareIndex && index !== constantIndex),
        replacement,
      );
    }
  }

  return null;
}

export function simplify(expr: Expr): Expr {
  switch (expr.kind) {
    case "Integer":
    case "Rational":
    case "Symbol":
      return expr;
    case "Function": {
      const args = expr.args.map(simplify);
      if (expr.name === "sqrt" && args.length === 1 && isNumeric(args[0]!)) {
        return exactRationalSquareRoot(args[0]!) ?? fn(expr.name, ...args);
      }
      if ((expr.name === "sin" || expr.name === "cos") && args.length === 1) {
        const exactValue = exactTrigValue(expr.name, args[0]!);
        if (exactValue) return exactValue;
      }
      return fn(expr.name, ...args);
    }
    case "Add": {
      const normalized = add(...expr.terms.map(simplify));
      if (normalized.kind !== "Add") return normalized;
      const rewritten = simplifyPythagoreanIdentity(normalized.terms);
      return rewritten ? simplify(rewritten) : normalized;
    }
    case "Mul": {
      const normalized = mul(...expr.factors.map(simplify));
      if (normalized.kind !== "Mul") return normalized;
      const combined = combinePowerFactors(normalized.factors);
      return combined.length === normalized.factors.length &&
          combined.every((factor, index) => factor === normalized.factors[index])
        ? normalized
        : simplify(mul(...combined));
    }
    case "Pow": {
      const base = simplify(expr.base);
      const exponent = simplify(expr.exponent);
      if (isNumeric(base) && exponent.kind === "Rational" &&
          exponent.numerator === 1n && exponent.denominator === 2n) {
        const root = exactRationalSquareRoot(base);
        if (root !== null) return root;
      }
      if (
        base.kind === "Pow" &&
        ((base.exponent.kind === "Integer" && exponent.kind === "Integer") ||
          isProvablyPositive(base.base))
      ) {
        return simplify(pow(base.base, mul(base.exponent, exponent)));
      }
      if (isNumeric(base) && isNumeric(exponent) && exponent.kind === "Integer") {
        const n = exponent.value;
        if (n >= 0n && n <= 10000n) {
          if (base.kind === "Integer") return integer(base.value ** n);
          return rational(base.numerator ** n, base.denominator ** n);
        }
        if (n < 0n && base.kind === "Integer" && base.value !== 0n && n >= -10000n) {
          return rational(1n, base.value ** (-n));
        }
        if (n < 0n && base.kind === "Rational" && base.numerator !== 0n && n >= -10000n) {
          return rational(base.denominator ** (-n), base.numerator ** (-n));
        }
      }
      return pow(base, exponent);
    }
  }
}
