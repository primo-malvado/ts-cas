import { add, integer, isNumeric, isZero, mul, negate, numericParts, pow, type Expr } from "../core/expr.js";
import { toString } from "../core/printer.js";
import { expand } from "../algebra/expand.js";
import { factor } from "../algebra/factor.js";
import { simplify } from "../algebra/simplify.js";
import { solvePolynomialInequality, type InequalityInterval } from "../algebra/inequalities.js";
import { polynomialCoefficient, polynomialDegree, polynomialFromExpr, polynomialToExpr } from "../algebra/polynomial.js";

export type IntersectionCondition = "no-intersection" | "tangent" | "two-intersections" | "at-least-one-intersection";

export interface MathSolutionStep {
  readonly title: string;
  readonly explanation: string;
  readonly expression?: string;
}

export interface LineParabolaParameterResult {
  readonly status: "complete" | "partial" | "unsupported";
  readonly parameter: string;
  readonly condition: IntersectionCondition;
  readonly discriminant: Expr;
  readonly discriminantText: string;
  readonly solutionIntervals: readonly InequalityInterval[];
  readonly solutionSet: string;
  readonly steps: readonly MathSolutionStep[];
  readonly message?: string;
}

/**
 * Solve a parameter problem involving a line y = slope*x + lineIntercept and a parabola
 * y = a*x^2 + b*x + c. The quadratic coefficient `a` must be a non-zero exact rational.
 * The coefficients may contain the selected parameter, but the final discriminant inequality
 * must be supported by solvePolynomialInequality (currently exact univariate degree <= 2).
 *
 * All transformations are performed on the CAS expression tree. The returned steps are suitable
 * for rendering a worked solution in a UI or CLI; no natural-language parser is assumed here.
 */
export function solveLineParabolaParameter(
  slope: Expr,
  lineIntercept: Expr,
  a: Expr,
  b: Expr,
  c: Expr,
  parameter: string,
  condition: IntersectionCondition = "no-intersection",
): LineParabolaParameterResult {
  const fail = (message: string): LineParabolaParameterResult => ({
    status: "unsupported", parameter, condition, discriminant: integer(0), discriminantText: "0",
    solutionIntervals: [], solutionSet: "não determinado", steps: [], message,
  });

  if (!isNumeric(a) || isZero(a)) {
    return fail("O coeficiente quadrático da parábola tem de ser uma constante racional não nula.");
  }

  // Intersections satisfy a*x² + (b - slope)*x + (c - lineIntercept) = 0.
  const xCoefficient = simplify(add(b, negate(slope)));
  const constantCoefficient = simplify(add(c, negate(lineIntercept)));
  const equationText = `${formatCoefficientTerm(a, "x^2")} + ${formatCoefficientTerm(xCoefficient, "x")} + ${toString(constantCoefficient)} = 0`;

  // Δ = B² - 4AC. Keep both the formula form and the expanded polynomial for the explanation.
  const discriminantFormula = simplify(add(
    pow(xCoefficient, integer(2)),
    negate(mul(integer(4), a, constantCoefficient)),
  ));
  const discriminant = simplify(expand(discriminantFormula));
  let factorizedDiscriminant = discriminant;
  try { factorizedDiscriminant = factor(discriminant, parameter); } catch { /* expanded form remains valid */ }
  const relation = condition === "no-intersection" ? "<"
    : condition === "tangent" ? "="
    : condition === "two-intersections" ? ">"
    : ">=";

  const inequality = solvePolynomialInequality(discriminant, parameter, relation);
  if (inequality.status !== "complete") {
    return {
      status: inequality.status === "partial" ? "partial" : "unsupported",
      parameter, condition, discriminant, discriminantText: toString(discriminant),
      solutionIntervals: inequality.intervals, solutionSet: "não determinado",
      steps: [
        { title: "Equação de interseção", explanation: "Igualamos a equação da reta à da parábola.", expression: equationText },
        { title: "Discriminante", explanation: "Calculamos Δ = B² − 4AC.", expression: `Δ = ${toString(discriminant)}` },
        { title: "Condição", explanation: `Aplicamos a condição ${relation} 0 ao discriminante.`, expression: `${toString(discriminant)} ${relation} 0` },
      ],
      message: inequality.message ?? "A inequação do discriminante não foi resolvida completamente.",
    };
  }

  const solutionSet = formatIntervals(inequality.intervals);
  const conditionText = condition === "no-intersection" ? "A reta não intersecta a parábola quando Δ < 0."
    : condition === "tangent" ? "A reta é tangente à parábola quando Δ = 0."
    : condition === "two-intersections" ? "A reta intersecta a parábola em dois pontos distintos quando Δ > 0."
    : "A reta intersecta a parábola em pelo menos um ponto real quando Δ ≥ 0.";

  const steps: MathSolutionStep[] = [
    {
      title: "1. Igualar as equações",
      explanation: "Nos pontos de interseção, a reta e a parábola têm a mesma ordenada.",
      expression: equationText,
    },
    {
      title: "2. Identificar os coeficientes",
      explanation: "Escrevemos a equação na forma Ax² + Bx + C = 0, considerando x como incógnita e o parâmetro como constante.",
      expression: `A = ${toString(a)}, B = ${toString(xCoefficient)}, C = ${toString(constantCoefficient)}`,
    },
    {
      title: "3. Calcular o discriminante",
      explanation: "Usamos Δ = B² − 4AC antes de desenvolver a expressão.",
      expression: `Δ = ${toString(discriminantFormula)}`,
    },
    {
      title: "4. Desenvolver e simplificar",
      explanation: "Desenvolvemos o discriminante para obter um polinómio no parâmetro.",
      expression: `Δ = ${toString(discriminant)}`,
    },
    {
      title: "5. Aplicar a condição geométrica",
      explanation: conditionText,
      expression: `${toString(discriminant)} ${relation} 0`,
    },
    {
      title: "6. Fatorizar e resolver a inequação",
      explanation: "Fatorizamos quando possível e resolvemos a inequação, respeitando a inclusão ou exclusão dos extremos.",
      expression: `${toString(factorizedDiscriminant)} ${relation} 0  ⇒  ${parameter} ∈ ${solutionSet}`,
    },
    {
      title: "7. Resposta",
      explanation: condition === "no-intersection"
        ? "Os valores dos extremos não estão incluídos: nesses casos o discriminante é zero e a reta é tangente à parábola."
        : "A solução respeita a condição escolhida para o número de interseções reais.",
      expression: `${parameter} ∈ ${solutionSet}`,
    },
  ];

  return {
    status: "complete", parameter, condition, discriminant,
    discriminantText: toString(discriminant), solutionIntervals: inequality.intervals,
    solutionSet, steps,
  };
}


/**
 * Generic version of the line/parabola parameter solver.
 * Accepts the complete line and parabola expressions and extracts the coefficients
 * from their difference. No intersection equation or discriminant is hard-coded.
 * Example: line=parse("m*x+2"), parabola=parse("x^2-x+6").
 */
export function solveLineParabolaExpressions(
  line: Expr,
  parabola: Expr,
  variable = "x",
  parameter = "m",
  condition: IntersectionCondition = "no-intersection",
): LineParabolaParameterResult {
  const intersectionEquation = simplify(expand(add(parabola, negate(line))));
  let polynomial;
  try {
    polynomial = polynomialFromExpr(intersectionEquation);
  } catch (error) {
    return {
      status: "unsupported", parameter, condition, discriminant: integer(0), discriminantText: "0",
      solutionIntervals: [], solutionSet: "não determinado", steps: [],
      message: error instanceof Error ? error.message : "Não foi possível converter a equação de interseção num polinómio.",
    };
  }

  const degree = polynomialDegree(polynomial, variable);
  if (degree !== 2) {
    return {
      status: "unsupported", parameter, condition, discriminant: integer(0), discriminantText: "0",
      solutionIntervals: [], solutionSet: "não determinado", steps: [],
      message: `A equação de interseção deve ser quadrática em ${variable}; grau encontrado: ${degree}.`,
    };
  }

  // Extract A, B and C with respect to x. Other symbols, such as m, remain in the coefficients.
  const A = simplify(polynomialToExpr(polynomialCoefficient(polynomial, variable, 2)));
  const B = simplify(polynomialToExpr(polynomialCoefficient(polynomial, variable, 1)));
  const C = simplify(polynomialToExpr(polynomialCoefficient(polynomial, variable, 0)));

  const discriminantFormula = simplify(add(pow(B, integer(2)), negate(mul(integer(4), A, C))));
  const discriminant = simplify(expand(discriminantFormula));
  let factorizedDiscriminant = discriminant;
  try { factorizedDiscriminant = factor(discriminant, parameter); } catch { /* expanded form remains valid */ }

  const relation = condition === "no-intersection" ? "<"
    : condition === "tangent" ? "="
    : condition === "two-intersections" ? ">"
    : ">=";
  const inequality = solvePolynomialInequality(discriminant, parameter, relation);
  const equationText = `${toString(intersectionEquation)} = 0`;
  const solutionSet = inequality.status === "complete" ? formatIntervals(inequality.intervals) : "não determinado";
  const steps: MathSolutionStep[] = [
    { title: "1. Construir a equação de interseção", explanation: "Igualamos as expressões da reta e da parábola e passamos tudo para o mesmo membro.", expression: equationText },
    { title: "2. Extrair os coeficientes", explanation: `O CAS identifica automaticamente os coeficientes de ${variable}², ${variable} e o termo independente.`, expression: `A = ${toString(A)}, B = ${toString(B)}, C = ${toString(C)}` },
    { title: "3. Calcular o discriminante", explanation: "Aplicamos Δ = B² − 4AC aos coeficientes extraídos.", expression: `Δ = ${toString(discriminantFormula)}` },
    { title: "4. Simplificar o discriminante", explanation: "Desenvolvemos a expressão simbolicamente.", expression: `Δ = ${toString(discriminant)}` },
    { title: "5. Aplicar a condição", explanation: condition === "no-intersection" ? "Não existem interseções reais quando Δ < 0." : condition === "tangent" ? "Existe tangência quando Δ = 0." : condition === "two-intersections" ? "Existem duas interseções reais distintas quando Δ > 0." : "Existe pelo menos uma interseção real quando Δ ≥ 0.", expression: `${toString(discriminant)} ${relation} 0` },
    { title: "6. Resolver a inequação", explanation: "Resolvemos a inequação no parâmetro indicado.", expression: `${toString(factorizedDiscriminant)} ${relation} 0 ⇒ ${parameter} ∈ ${solutionSet}` },
  ];
  return {
    status: inequality.status === "complete" ? "complete" : inequality.status === "partial" ? "partial" : "unsupported",
    parameter, condition, discriminant, discriminantText: toString(discriminant),
    solutionIntervals: inequality.intervals, solutionSet, steps,
    ...(inequality.message === undefined ? {} : { message: inequality.message }),
  };
}

function formatCoefficientTerm(coefficient: Expr, term: "x" | "x^2"): string {
  if (coefficient.kind === "Integer" && coefficient.value === 1n) return term;
  if (coefficient.kind === "Integer" && coefficient.value === -1n) return `-${term}`;
  if (coefficient.kind === "Add") return `(${toString(coefficient)})*${term}`;
  return `${toString(coefficient)}*${term}`;
}

function formatIntervals(intervals: readonly InequalityInterval[]): string {
  if (intervals.length === 0) return "∅";
  return intervals.map(interval => {
    const lower = interval.lower === null ? "−∞" : toString(interval.lower);
    const upper = interval.upper === null ? "+∞" : toString(interval.upper);
    const left = interval.lower === null ? "]" : interval.lowerClosed ? "[" : "]";
    const right = interval.upper === null ? "[" : interval.upperClosed ? "]" : "[";
    return `${left}${lower}, ${upper}${right}`;
  }).join(" ∪ ");
}

/** Exact helper for numeric constants used by parameterized geometry problems. */
export function rationalCoefficientSign(value: Expr): -1 | 0 | 1 | null {
  if (!isNumeric(value)) return null;
  const [numerator] = numericParts(value);
  return numerator < 0n ? -1 : numerator > 0n ? 1 : 0;
}
