# ts-cas

A computer algebra system (CAS) for JavaScript and TypeScript, combining exact
symbolic mathematics with configurable-precision numerical computation.

Parse expressions, simplify and transform them, solve supported equations, and
differentiate or integrate—all from a small, dependency-free library.

## Features

- Exact integer and rational arithmetic in symbolic expressions
- Expression parser with implicit multiplication, such as `2x`
- Simplification, expansion, factorization, and equation/system solving,
  including safe power and common trigonometric identities
- Symbolic differentiation, integration, limits, and Taylor/Laurent series
- Numerical evaluation, calculus, complex arithmetic, and arbitrary-precision decimals
- Certified real-root isolation and real-domain analysis for supported inputs
- Matrices, statistics, probability, and function sampling

The project is written in TypeScript and ships an ESM API that JavaScript
applications can import. Operations document their supported mathematical
domains and report unsupported or partial cases rather than claiming a general
solution when one is not available.

## Quick start

Install the published package:

```bash
npm install ts-cas
```

```js
import { parse, simplify, toString } from "ts-cas";

console.log(toString(simplify(parse("2x + 3x")))); // 5*x
```

To build from a clone of this repository instead:

```bash
npm install
npm run build
```

Then use the compiled API from JavaScript:

```js
import { differentiate, parse, simplify, toString } from "./dist/src/index.js";

const expression = parse("2x + 3x");
console.log(toString(simplify(expression))); // 5*x

const derivative = differentiate(parse("sin(x^2)"), "x");
console.log(toString(derivative)); // 2*x*cos(x^2)
```

Run the test suite with `npm test`. TypeScript users can import the same
functions and receive declarations from the package build.

## Website and playground

The Angular application in [`site/`](./site/) includes an interactive
playground wired to the CAS library, selectable examples, and in-page API
guidance. The site requires Node.js 22 or newer. To run it locally, build the
library first, then install and start the site:

```bash
npm ci
npm run build
npm ci --prefix site
npm start --prefix site
```

Run its focused tests with `npm run test:site` and create a production build
with `npm run build --prefix site`. GitHub Pages deployment is configured in
[`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml)
and runs on pushes to `master`. To enable it, open **Settings → Pages** and
select **GitHub Actions** as the build and deployment source.

## Numerical precision and guarantees

Exact symbolic integers and rationals remain exact until an operation converts
them to a numeric type. The numeric APIs do not all provide the same precision
or guarantees:

| API family | Numeric model | What the result guarantees |
| --- | --- | --- |
| `evaluate`, `numericalDerivative`, `integrateNumerically`, and the ordinary numeric/complex APIs | JavaScript `number` (IEEE-754 binary64) | Approximate values, typically around 15–16 significant decimal digits. There is no general error bound; cancellation, rounding, overflow, or underflow can affect results. |
| `evaluateDecimal`, `evaluateComplexDecimal`, and `NumericalEngine.evaluate` / `.evaluateComplex` | BigInt-backed decimal arithmetic; 50 significant digits by default, configurable from 2 to 10,000 | The requested decimal rounding is applied, but the result is still an approximation, not a certified enclosure. Use decimal strings for inputs that must not first pass through binary64. |
| Decimal numerical calculus and general root finding | BigInt-backed decimal arithmetic; generally 2–1,000 digits | `estimatedError` and `converged` report algorithmic estimates and stopping criteria, not formal error proofs. |
| `evaluateDecimalInterval` and `NumericalEngine.evaluateInterval` | Outward-rounded decimal intervals; 50 digits by default, configurable from 2 to 1,000 | For the supported real-expression subset, the returned interval encloses the exact value. Unsupported operations and intervals crossing singularities are rejected; dependency between repeated variables can make an enclosure wider than necessary. |

`numericalDerivative` first evaluates a symbolic derivative and otherwise uses
finite differences. `integrateNumerically` uses adaptive Simpson quadrature;
decimal integration compares 16- and 32-point Gauss–Legendre estimates. Their
error fields are estimates, not rigorous bounds. For numeric root finding,
bisection and hybrid methods require a sign-changing bracket and assume
continuity; Newton's method is local. These methods do not prove uniqueness or
find every root, and `converged` means only that the method met its stopping
criterion.

With binary64, every integer is exactly representable only through
`Number.MAX_SAFE_INTEGER` (`2^53 - 1`). Non-finite results are rejected, but
finite rounding and underflow to zero are not necessarily reported.

For stronger root guarantees, `solvePolynomialNumericallyDecimal` uses exact
Sturm counts and rational isolating intervals for univariate rational
polynomials (degree 24 by default, configurable up to 64). The displayed
decimal root is still an approximation. `certifyRealRoots` can certify roots
only inside the supplied finite interval and supported expression subset;
polynomial roots use exact Sturm analysis, while non-polynomial certification
is conservative and may return `partial` with unresolved regions. A certified
interval evaluation or root certificate is a mathematical enclosure/count,
not extra decimal digits in an ordinary `number`.

Some practical limits are deliberate: scalar decimal `exp` rejects arguments
with magnitude above 10,000; scalar decimal `sin`/`cos`/`tan` require
`|x| <= 10^12`; certified interval trigonometry supports `|x| <= 10^30` but
may reject a requested precision when argument reduction lacks enough guard
digits. Errors and `partial`/`unsupported` statuses must not be interpreted as
successful numeric answers.

## Explainable differentiation

`differentiateWithSteps` returns the derivative together with a structured,
language-neutral trace of the rules applied. Each step contains the original
expression, its derivative, a rule identifier, and a `parentId` so applications
can render the derivation as a tree and localize rule names for their users.

```js
import { differentiateWithSteps, parse, toString } from "./dist/src/index.js";

const result = differentiateWithSteps(parse("(x^2 + 1)*sin(x)"), "x");
console.log(toString(result.derivative));
for (const step of result.steps) {
  console.log(step.id, step.parentId, step.rule, "=>", toString(step.derivative));
}
```

The trace explains the implemented differentiation procedure; it does not
certify domain assumptions or claim that each algebraic transformation is a
formal proof. The existing `differentiate` API and its return value are
unchanged.

`factorWithSteps` and `integrateWithSteps` also identify the supported
factorization or integration method selected. These are top-level algorithm
explanations, not formal proof objects. `solveWithSteps` reports supported
linear, quadratic, and rational-factorization steps. Limit results include the
selected `method` and the number of L'Hôpital applications.

## Domain-aware simplification

`simplifyWithDomain` returns a simplified expression together with conditions
that preserve the real domain of the input:

```js
import { parse, simplifyWithDomain, toString } from "./dist/src/index.js";

const result = simplifyWithDomain(parse("(x^2 - 1)/(x - 1)"));
console.log(toString(result.expression)); // 1 + x
console.log(result.conditions.map(c => `${toString(c.expression)} ${c.relation} 0`));
// ["-1 + x nonzero 0"]
```

For source strings, prefer `parseWithDomain`. Unlike the canonical `parse`
function, it preserves the original arithmetic structure long enough to detect
restrictions that cancellation could otherwise erase:

```js
import { parseWithDomain, solveWithDomain, toString } from "./dist/src/index.js";

const source = parseWithDomain("((x - 1)^2)/(x - 1)");
console.log(source.conditions.map(c => `${toString(c.expression)} ${c.relation} 0`));
const roots = solveWithDomain(source, "x");
console.log(roots.excludedSolutions.map(toString)); // ["1"]
```

Conditions use the relations `nonzero`, `positive`, and `nonnegative`. The API
tracks rational denominator restrictions, square roots, logarithms, tangent,
and real rational powers. Unknown function domains are reported as
`unsupported`; a `complete` result does not mean that symbolic conditions have
been solved. The analysis applies to the supplied expression tree, so it
cannot recover restrictions already discarded before the call.

Use `differentiateWithDomain`, `substituteWithDomain`, `expandWithDomain`,
`factorWithDomain`, or `integrateWithDomain` to carry these conditions through
common expression transformations. `transformWithDomain` provides the same
behavior for other unary expression-to-expression operations.
`combineWithDomain` carries restrictions from multiple operands when building
a new expression. A substitution that
violates a carried condition returns `undefined` instead of a value that looks
valid. `solveWithDomain` filters exact roots that violate numeric conditions
and labels roots with undecidable symbolic conditions as undetermined.
`solvePolynomialSystemWithDomain` applies the same checks to finite points
returned by the supported two-variable polynomial-system solver.

`evaluateWithDomain` returns a value only when the carried conditions are
verified; uncertain floating-point boundary checks return `partial`.
`limitWithDomain` and the Taylor/Laurent series wrappers keep the source
conditions and report whether the point is in the original domain. They mark
results `partial` when inherited restrictions could change the local approach.
`analyzeContinuityWithDomain` similarly avoids a definitive classification
when the simplified expression no longer captures those restrictions.

These wrappers preserve conditions supplied or discovered in the input; they
do not retrofit domain tracking into the existing operations automatically.
Each transformation can discover additional restrictions in its output, but
the current analysis remains limited to the supported functions listed above.

## Explainable equation solving

`solveWithSteps` returns the normal solver result plus structured steps for
normalization, polynomial degree classification, linear or quadratic formulas,
and supported rational factorization. The trace is an explanation of the
implemented procedure, not a proof object. Unsupported higher-degree factors
remain visible as partial results rather than being presented as solved.

`solveWithCertificates` pairs the existing exact solver with a certificate for
the complete real-root set, including cases where the symbolic solver cannot
express higher-degree roots in closed form.

Use `toLearningExplanation` to turn a trace into readable steps that include
the applied rule, why it applies, and the conditions it needs. It supports
differentiation, factorization, integration, and equation-solving traces while
leaving the existing trace APIs unchanged:

```js
import {
  differentiateWithSteps,
  parse,
  toLearningExplanation,
} from "./dist/src/index.js";

const trace = differentiateWithSteps(parse("ln(x)"), "x");
const lesson = toLearningExplanation(trace, { variable: "x" });
console.log(lesson.steps.at(-1));
// Includes the chain rule, why d(log(u))/dx = u'/u, and the condition u > 0.
```

The descriptions state the mathematical assumptions of each rule; they do not
claim that every condition has been proven for a given input.

For standalone, serializable results, `differentiateWithProof`,
`factorWithProof`, `integrateWithProof`, and `solveWithProof` bundle the result
with its explanation and a checkable identity or certificate. Verify a saved
result with `verifyProofCarryingResult`:

```js
import {
  differentiateWithProof,
  parseWithDomain,
  verifyProofCarryingResult,
} from "./dist/src/index.js";

const source = parseWithDomain("(x^2 - 1)/(x - 1)");
const created = differentiateWithProof(source, "x");
if ("calculation" in created) {
  const saved = JSON.parse(JSON.stringify(created.calculation));
  console.log(verifyProofCarryingResult(saved, source)); // { valid: true, errors: [] }
}
```

These checks are not formal proofs. Supplying the expected original input binds
the verification to its domain assumptions; without it, embedded assumptions
are treated as hypotheses rather than verified provenance.

## Verifiable polynomial inequality certificates

`createPolynomialInequalityCertificate` certifies sign charts for univariate
rational-polynomial inequalities. It combines exact root-isolation intervals
with rational witness points between roots; the verifier independently
recomputes the root certificate and each witness sign.

```js
import {
  createPolynomialInequalityCertificate,
  parse,
  verifyPolynomialInequalityCertificate,
} from "./dist/src/index.js";

const expression = parse("x^2 - 4");
const result = createPolynomialInequalityCertificate(expression, "x", "<=");
if ("certificate" in result) {
  console.log(verifyPolynomialInequalityCertificate(result.certificate, expression));
  // { valid: true, errors: [] }
}
```

Only exact univariate rational polynomials are supported. The certificate
describes sign cells and included root boundaries, not a symbolic interval
notation for the final solution set.

## Verifiable linear-system certificates

`createLinearSystemCertificate` emits a JSON-serializable certificate for a
unique solution of an exact rational linear system. Verification checks every
equation by exact arithmetic and recomputes full column rank, so the certificate
establishes both that the solution exists and that it is unique.

```js
import {
  createLinearSystemCertificate,
  parse,
  verifyLinearSystemCertificate,
} from "./dist/src/index.js";

const equations = [
  { left: parse("x + y"), right: parse("3") },
  { left: parse("x - y"), right: parse("1") },
];
const result = createLinearSystemCertificate(equations, ["x", "y"]);
if ("certificate" in result) {
  console.log(verifyLinearSystemCertificate(result.certificate, equations, ["x", "y"]));
}
```

`createPolynomialSystemWitnessCertificate` verifies exact solution points for
the current supported two-variable polynomial systems, including rational and
radical witnesses. It certifies each listed point, **not** that the list is
complete.

For systems with one non-constant linear equation where substitution reduces
the other equation to a polynomial of degree at most two,
`createPolynomialSystemCompletenessCertificate` combines a complete Sturm
root count with distinct exact solution witnesses to prove completeness over
the real numbers. `verifyCertificate` provides a single dispatcher for the
supported root, inequality, system, and antiderivative certificate verifiers.

`createAntiderivativeCertificate` checks a primitive by differentiating its
stored antiderivative and recomputing the exact residual. This verifies the
derivative identity on the common domain; it does not prove that the two
expressions have identical domains.

## Continuous validation and benchmarks

GitHub Actions runs the build, full test suite, and domain-helper regression checks
on Node.js 20 and 22, and measures representative differentiation,
simplification, and certification workloads on every push and pull request.
Run `npm run test:all`, `npm run test:oracle`, `npm run validate:domain-helpers`,
and `npm run benchmark` locally to reproduce the checks. The oracle suite uses
frozen expected results generated by SymPy 1.12 and needs no Python dependency.
CI also applies deliberately generous median
time budgets to catch severe slowdowns; they are not fine-grained performance
targets. CI retains a machine-readable benchmark report as a short-lived
workflow artifact. Set `BENCHMARK_OUTPUT` to write the same report locally.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the non-publishing validation
workflow and [docs/API_REFERENCE.md](./docs/API_REFERENCE.md) for signatures,
examples, and supported-scope notes for these APIs.

## Verifiable polynomial root certificates

`createPolynomialRootCertificate` produces a JSON-serializable certificate for
the exact real roots of a univariate rational polynomial. It includes rational
isolating intervals, multiplicities, Sturm variation counts, and the total
number of distinct real roots. The verifier recomputes these claims using exact
arithmetic instead of trusting the stored counts.

```js
import {
  createPolynomialRootCertificate,
  parse,
  verifyPolynomialRootCertificate,
} from "./dist/src/index.js";

const expression = parse("x^2 - 2");
const result = createPolynomialRootCertificate(expression, "x");
if ("certificate" in result) {
  const saved = JSON.parse(JSON.stringify(result.certificate));
  console.log(verifyPolynomialRootCertificate(saved, expression));
  // { valid: true, errors: [] }
}
```

Certificates with unresolved root groups are marked `partial` but can still be
verified; the zero polynomial and unsupported expressions do not receive a
finite certificate. Pass the original expression to the verifier to bind the
certificate's coefficients to that input.

## Scope and limitations

This is an actively developed CAS, not a complete replacement for systems such
as Mathematica or SageMath. Canonicalization is structural rather than a
universal mathematical normal form; solving, factorization, integration,
limits, and certification each support defined subsets of expressions. See
individual API sections below for details. Contributions and reproducible bug
reports are welcome.

The sections below retain the project's detailed implementation notes and
examples for the public mathematical APIs.


## Polinómios

O módulo `src/algebra/polynomial.ts` acrescenta uma representação esparsa de polinómios multivariáveis com coeficientes racionais exatos (`bigint`), independente da árvore de expressões.

```ts
import {
  parse, toString, polynomialFromExpr, polynomialToExpr,
  polynomialMultiply, polynomialDivide, polynomialDegree,
} from "./src/index.js";

const p = polynomialFromExpr(parse("(x + 1)^2"));
const q = polynomialFromExpr(parse("x + 1"));
console.log(toString(polynomialToExpr(p))); // x^2 + 2*x + 1

const { quotient, remainder } = polynomialDivide(p, q);
console.log(toString(polynomialToExpr(quotient)));  // x + 1
console.log(toString(polynomialToExpr(remainder))); // 0
console.log(polynomialDegree(p, "x"));              // 2
```

Operações disponíveis: conversão para/de expressões, soma, subtração, negação, multiplicação, potência inteira não negativa, grau, extração de coeficiente, avaliação numérica e divisão euclidiana de polinómios univariáveis. A divisão usa aritmética racional exata. Expressões com funções ou expoentes negativos/não inteiros não são polinómios e são rejeitadas.


## Fatorização

O módulo `src/algebra/factor.ts` implementa fatorização univariável sobre os racionais através do teorema das raízes racionais e reconhece várias formas multivariáveis comuns: fator monomial comum, diferenças de quadrados, trinómios quadrados perfeitos e fatorização por agrupamento. O fator restante é conservado quando nenhum dos métodos exatos disponíveis o consegue decompor.

```ts
import { factor, parse, toString } from "./src/index.js";

console.log(toString(factor(parse("x^2 - 1"))));
console.log(toString(factor(parse("x^2 - y^2"))));
console.log(toString(factor(parse("x^2 + 2*x*y + y^2"))));
console.log(toString(factor(parse("x^2 + x*y + x*z + y*z"))));
```

A fatorização é exata para os padrões reconhecidos, mas ainda não é um algoritmo geral de fatorização multivariável sobre os racionais. Fatores irredutíveis sobre os racionais e fatorização por extensões algébricas permanecem fora do âmbito. O agrupamento tem um limite de termos para evitar uma procura combinatória excessiva; a procura de raízes racionais também usa uma salvaguarda para coeficientes inteiros muito grandes.

## Resolução de equações

O módulo `src/algebra/solve.ts` resolve equações polinomiais univariáveis com coeficientes racionais exatos. A função `solve(expr, "x")` interpreta a expressão como `expr = 0`; `solveEquation(left, right, "x")` resolve `left = right`.

```ts
import { parse, solve, solveEquation, toString } from "./src/index.js";

console.log(solve(parse("2*x - 6"), "x").solutions.map(toString));
// ["3"]

console.log(solve(parse("x^2 - 5*x + 6"), "x").solutions.map(toString));
// ["3", "2"]

console.log(solve(parse("x^2 - pi"), "x").solutions.map(toString));
// ["sqrt(pi)", "sqrt(pi)*-1"]

console.log(solve(parse("x^2 - y"), "x").solutions.map(toString));
// ["sqrt(y)", "sqrt(y)*-1"]

console.log(solveEquation(parse("2*x + 1"), parse("7"), "x").solutions.map(toString));
// ["3"]
```

O resultado informa `status`, incluindo `finite`, `partial`, `none`, `all` e `unsupported`. Raízes irracionais ou complexas podem ser representadas simbolicamente com radicais.

Equações lineares e quadráticas aceitam um termo constante polinomial em parâmetros, `pi` e `E`, desde que os coeficientes da variável sejam racionais. As raízes são complexas em geral e podem coincidir para certos valores dos parâmetros. A filtragem e certificação dessas soluções no domínio real ainda não são suportadas por `solveWithDomain` e `solveWithProof`. Equações mais gerais com coeficientes simbólicos continuam sem suporte.

O solver também resolve `a*x^sqrt(r)+b = 0` para coeficientes racionais, `0 < r < 4` e `-b/a > 0`. Por exemplo, `x^sqrt(2) - 2 = 0` tem a solução exata `2^(sqrt(2)/2)`, única no ramo principal complexo. Outros casos podem continuar `unsupported`; a verificação independente e a certificação desta solução ainda não são suportadas.

## Resolução de equações de grau superior

O solver tenta fatorizar polinómios de grau superior a 2. Resolve os fatores lineares e quadráticos encontrados e aplica uma fórmula por radicais aos fatores quárticos.

```ts
import { parse, solve, toString } from "./src/index.js";

const result = solve(parse("x^3 - 6*x^2 + 11*x - 6"), "x");
console.log(result.solutions.map(toString)); // ["1", "2", "3"]

const quartic = solve(parse("x^4 + 10*x^2 + x + 1"), "x");
console.log(quartic.solutions.map(toString)); // quatro raízes complexas exatas
```

Os radicais quárticos usam os ramos principais complexos de `sqrt` e da potência `1/3`; a avaliação numérica pode sofrer erros de arredondamento. A fatorização não resolve todos os polinómios: por exemplo, um fator cúbico sem raízes racionais pode permanecer por resolver. Consulta `status` para distinguir uma lista completa (`finite`), parcial (`partial`) ou não suportada (`unsupported`).

Quando `method` é `"quartic-formula"`, `verifyEquationSolveExplanation` ainda não verifica independentemente os radicais, e `solveWithDomain` e `solveWithProof` não os classificam nem certificam no domínio real. `solveWithCertificates` pode fornecer separadamente certificados para as raízes reais.


## Radicais e números complexos

O módulo `src/algebra/radicals.ts` simplifica raízes quadradas de racionais exatos, extrai fatores quadrados e trata radicandos negativos através da unidade imaginária `i`. Também reduz potências inteiras de `i` usando a periodicidade de quatro. Usa `simplifyRadicals(expr)` para aplicar estas regras sem alterar o simplificador geral existente.

O `simplify()` também calcula raízes quadradas racionais exatas, por exemplo `simplify(parse("(4)^(1/2)"))` devolve `2`. Quando a raiz não é racional ou o radicando é negativo, mantém a expressão simbólica.

```ts
import { parse, simplifyRadicals, toString } from "./src/index.js";

console.log(toString(simplifyRadicals(parse("sqrt(12)"))));  // sqrt(3)*2
console.log(toString(simplifyRadicals(parse("sqrt(-4)")))); // 2*i
console.log(toString(simplifyRadicals(parse("i^2"))));      // -1
```

O módulo `src/algebra/complex.ts` fornece aritmética exata para números complexos cujas partes real e imaginária são inteiros ou racionais: `complex`, `complexAdd`, `complexSubtract`, `complexMultiply`, `complexDivide`, `complexConjugate` e `complexIsReal`. Por exemplo, `(1+2i)/(3+4i)` é representado exatamente como `11/25 + (2/25)i`.

Limitações: a simplificação de radicais usa fatorização inteira por tentativa e pode ser lenta para radicandos enormes; ainda não simplifica expressões gerais como `sqrt(x^2)` sem hipóteses sobre `x`, nem racionaliza denominadores algébricos. A aritmética complexa exata é uma API separada e não transforma ainda toda a AST num tipo complexo dedicado.


## Sistemas lineares

O módulo `src/algebra/system.ts` resolve sistemas lineares com coeficientes racionais exatos usando eliminação de Gauss.

```ts
import { parse, solveLinearSystem, type LinearEquation } from "./src/index.js";

const equations: PolynomialEquation[] = [
  { left: parse("2*x + y"), right: parse("5") },
  { left: parse("x - y"), right: parse("1") },
];

const result = solveLinearSystem(equations, ["x", "y"]);
// result.status === "unique"
// result.solutions contém x = 2 e y = 1
```

Estados possíveis: `unique` (solução única), `none` (sistema incompatível), `infinite` (infinitas soluções) e `unsupported` (equações não lineares ou coeficientes não racionais exatos). Quando existem variáveis livres, `solutions` contém expressões paramétricas e `parameters` lista os parâmetros introduzidos. Por exemplo, para `x + y = 2`, o resultado representa `y = t1` e `x = 2 - t1`. Os nomes dos parâmetros são escolhidos para não colidir com as variáveis do sistema.


## Sistemas polinomiais não lineares (duas variáveis)

O módulo de sistemas acrescenta `solvePolynomialSystem(equations, ["x", "y"])`. Resolve sistemas de duas equações e duas variáveis quando ambas são lineares, ou quando uma é linear e a substituição reduz a outra a uma equação polinomial de grau no máximo dois. Os cálculos mantêm coeficientes racionais exatos e as soluções irracionais ficam em forma simbólica.

```ts
import { parse, solvePolynomialSystem, toString, type PolynomialEquation } from "./src/index.js";

const equations: PolynomialEquation[] = [
  { left: parse("x + y"), right: parse("3") },
  { left: parse("x^2 + y^2"), right: parse("5") },
];

const result = solvePolynomialSystem(equations, ["x", "y"]);
console.log(result.status); // "finite"
console.log(result.solutions.map(s => [toString(s.x!), toString(s.y!)]));
// [["2", "1"], ["1", "2"]]
```

Os estados são `finite`, `none`, `infinite` e `unsupported`. Quando existem infinitas soluções, `solutions` contém uma família paramétrica e `parameters` lista os parâmetros utilizados. A versão atual não é um solver geral de sistemas não lineares: exige exatamente duas equações e duas variáveis, e não resolve sistemas em que ambas as equações são não lineares nem reduções de grau superior a dois.


## Substituição simbólica

A função `substitute(expr, values)` substitui símbolos por expressões e reconstrói a árvore com os construtores canónicos. A substituição funciona dentro de somas, produtos, potências e funções.

```ts
import { parse, substitute, toString } from "./src/index.js";

const result = substitute(parse("x^2 + y"), {
  x: parse("2"),
  y: parse("3"),
});
console.log(toString(result)); // 7
```

A substituição não avalia funções como `sin` ou `log` em geral; apenas substitui os seus argumentos. Esta função também é usada internamente pelo solver de sistemas polinomiais.

## License

Copyright (C) 2026 Rui Costa.

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. See [LICENSE](./LICENSE) for the full text.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE.
