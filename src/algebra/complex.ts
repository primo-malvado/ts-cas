import { rational, type NumericExpr } from "../core/expr.js";

export interface ExactComplex {
  readonly re: NumericExpr;
  readonly im: NumericExpr;
}

function parts(value: NumericExpr): [bigint, bigint] {
  return value.kind === "Integer"
    ? [value.value, 1n]
    : [value.numerator, value.denominator];
}

function addRational(a: NumericExpr, b: NumericExpr): NumericExpr {
  const [an, ad] = parts(a), [bn, bd] = parts(b);
  return rational(an * bd + bn * ad, ad * bd) as NumericExpr;
}

function mulRational(a: NumericExpr, b: NumericExpr): NumericExpr {
  const [an, ad] = parts(a), [bn, bd] = parts(b);
  return rational(an * bn, ad * bd) as NumericExpr;
}

function subRational(a: NumericExpr, b: NumericExpr): NumericExpr {
  const [n, d] = parts(b);
  return addRational(a, rational(-n, d) as NumericExpr);
}

function divRational(a: NumericExpr, b: NumericExpr): NumericExpr {
  const [an, ad] = parts(a), [bn, bd] = parts(b);
  if (bn === 0n) throw new RangeError("Division by zero.");
  return rational(an * bd, ad * bn) as NumericExpr;
}

export function complex(re: NumericExpr, im: NumericExpr = rational(0n, 1n) as NumericExpr): ExactComplex {
  return { re, im };
}

export function complexAdd(a: ExactComplex, b: ExactComplex): ExactComplex {
  return { re: addRational(a.re, b.re), im: addRational(a.im, b.im) };
}

export function complexSubtract(a: ExactComplex, b: ExactComplex): ExactComplex {
  return { re: subRational(a.re, b.re), im: subRational(a.im, b.im) };
}

export function complexMultiply(a: ExactComplex, b: ExactComplex): ExactComplex {
  return {
    re: subRational(mulRational(a.re, b.re), mulRational(a.im, b.im)),
    im: addRational(mulRational(a.re, b.im), mulRational(a.im, b.re)),
  };
}

export function complexDivide(a: ExactComplex, b: ExactComplex): ExactComplex {
  const denominator = addRational(mulRational(b.re, b.re), mulRational(b.im, b.im));
  if (denominator.kind === "Integer" && denominator.value === 0n) {
    throw new RangeError("Division by complex zero.");
  }
  if (denominator.kind === "Rational" && denominator.numerator === 0n) {
    throw new RangeError("Division by complex zero.");
  }
  return {
    re: divRational(addRational(mulRational(a.re, b.re), mulRational(a.im, b.im)), denominator),
    im: divRational(subRational(mulRational(a.im, b.re), mulRational(a.re, b.im)), denominator),
  };
}

export function complexConjugate(value: ExactComplex): ExactComplex {
  const [n, d] = parts(value.im);
  return { re: value.re, im: rational(-n, d) as NumericExpr };
}

export function complexIsReal(value: ExactComplex): boolean {
  return value.im.kind === "Integer"
    ? value.im.value === 0n
    : value.im.numerator === 0n;
}
