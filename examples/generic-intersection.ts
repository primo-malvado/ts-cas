import {
  add,
  expand,
  integer,
  mul,
  parse,
  polynomialCoefficientsIn,
  simplify,
  solvePolynomialInequality,
  toString,
  type Expr,
} from "../src/index.js";

// Generic CAS workflow: the input consists only of the two function expressions.
const firstFunction = parse("m*x + 2");
const secondFunction = parse("x^2 - x + 6");

// Form f(x) - g(x) generically, then collect powers of x with symbolic coefficients.
const intersectionEquation = expand(add(firstFunction, mul(integer(-1), secondFunction)));
const coefficients = polynomialCoefficientsIn(intersectionEquation, "x");
const a = coefficients[2] ?? integer(0);
const b = coefficients[1] ?? integer(0);
const c = coefficients[0] ?? integer(0);

// Discriminant is constructed from the extracted coefficients, not hard-coded values.
const discriminant = simplify(add(mul(b, b), mul(integer(-4), a, c)));
const inequality = solvePolynomialInequality(discriminant, "m", "<");

console.log("Equação de interseção:", toString(intersectionEquation));
console.log("a =", toString(a));
console.log("b =", toString(b));
console.log("c =", toString(c));
console.log("Discriminante:", toString(discriminant));
console.log("Estado:", inequality.status);
if (inequality.message) console.log("Mensagem:", inequality.message);
console.log("Intervalos-solução:");
for (const interval of inequality.intervals) {
  const lower = interval.lower === null ? "-∞" : toString(interval.lower);
  const upper = interval.upper === null ? "+∞" : toString(interval.upper);
  console.log(`${interval.lowerClosed ? "[" : "]"}${lower}, ${upper}${interval.upperClosed ? "]" : "["}`);
}
