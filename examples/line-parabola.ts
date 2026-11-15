import {
  parse,
  solveLineParabolaExpressions,
  toString,
} from "../src/index.js";

// Inputs: the actual functions, not a manually constructed intersection equation.
const line = parse("m*x + 2");
const parabola = parse("x^2 - x + 6");

const result = solveLineParabolaExpressions(
  line,
  parabola,
  "x",
  "m",
  "no-intersection",
);

console.log(`Estado: ${result.status}`);
console.log(`Discriminante: ${result.discriminantText}`);
console.log(`Conjunto-solução: m ∈ ${result.solutionSet}`);
for (const step of result.steps) {
  console.log(`\n${step.title}`);
  console.log(step.explanation);
  if (step.expression) console.log(step.expression);
}
if (result.message) console.error(result.message);
