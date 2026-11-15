export interface TutorialCodeExample {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly code: string;
}

export interface TutorialChapter {
  readonly id: string;
  readonly menuGroup: TutorialMenuGroupTitle;
  readonly number: string;
  readonly title: string;
  // readonly introduction: string;
  readonly paragraphs: readonly string[];
  readonly examples: readonly TutorialCodeExample[];
}

export type TutorialMenuGroupTitle = string

export interface TutorialMenuGroup {
  readonly id: string;
  readonly sectionId: string;
  readonly title: TutorialMenuGroupTitle;
  readonly items: readonly TutorialMenuItem[];
}

export interface TutorialMenuItem {
  readonly id: string;
  readonly title: string;
}

export function toggleTutorialMenuGroup(
  current: TutorialMenuGroupTitle | null,
  selected: TutorialMenuGroupTitle,
): TutorialMenuGroupTitle | null {
  return current === selected ? null : selected;
}

export const TUTORIAL_CHAPTERS: readonly TutorialChapter[] = [
  {
    id: "basic-operations",
    menuGroup: "Basic operations",
    number: "01",
    title: "Basic operations",
    //introduction: ".",
    paragraphs: [
      "Here we explore basic operations using ts-cas.",
    ],
    examples: [

      {
        id: "parse-expression-string",
        title: "Convert a string to a TsCas expression",
        description: "Parse user-written math text.",
        code: `const source = "x^2 + 3*x - 1/2";
const expression = tsCas.parse(source);
console.log("Expression:", expression);`,
      },

      {
        id: "print-expression",
        title: "Print an expression",
        description: "Convert the TsCas expression into readable text without changing its value.",
        code: `const expression = tsCas.parse("(x + 1)^3");
console.log(tsCas.toString(expression));`,
      },


      {
        id: "symbol-substitution",
        title: "Substitution",
        description: "Replace a symbol with another symbolic expression.",
        code: `const expression = tsCas.parse("cos(x) + 1");
const result = tsCas.substitute(expression, { x: tsCas.parse("y+1") });
console.log(tsCas.toString(result));`,
      },
      
      {
        id: "point-substitution",
        title: "Substitute x by a value",
        description: "Substitute an exact value and keep the original expression unchanged.",
        code: `const expression = tsCas.parse("x^2 + 1");
const value = tsCas.substitute(expression, { x: tsCas.parse("3") });
console.log("At x = 3, y =", tsCas.toString(value));`,
      },

      {
        id: "numeric-evaluation",
        title: "Evaluate: approximate a symbolic value",
        description: "Keep an exact radical and evaluate it as a JavaScript number only when needed.",
        code: `const expression = tsCas.parse("sqrt(8)");
console.log("Exact:", tsCas.toString(expression));
console.log("Approximate:", tsCas.evaluate(expression));`,
      },


      //////////////////////////////////




    ],
  },
 
  {
    id: "simplification",
    menuGroup: "Simplification",
    number: "02",
    title: "Simplification",
    //introduction: "Choose an expression form that suits the next step in your calculation.",
    paragraphs: [
      "simplify reduces expressions using the available symbolic rules. expand develops supported products and powers. factor searches for exact factors; it does not promise to factor every expression over every domain.",
      "Each operation is explicit, so it stays clear which transformation was requested and how to interpret cases that remain unresolved.",
    ],
    examples: [


      {
        id: "simplify-like-terms",
        title: "Simplify",
        description: "Simplify an expression.",
        code: `

const list = [
  "2*x + 3*x", 
  "cos(x)^2 + sin(x)^2",  
  "(4)^(1/2)",
];

list.forEach(expr => {
  const parsed = tsCas.parse(expr);
  console.log(expr + " <=> " + tsCas.toString(tsCas.simplify(parsed)));
});
`,
      },


      {
        id: "expand-binomial",
        title: "Expand a binomial square",
        description: "Expand a  binomial square.",
        code: `const expression = tsCas.parse("(x + 1)^2");
console.log(tsCas.toString(tsCas.expand(expression)));`,
      },
      {
        id: "expand-product",
        title: "Expand a product",
        description: "Expand a  product.",
        code: `const expression = tsCas.parse("(x + 1)*(x - 2) - (x - 1)*x");
console.log(tsCas.toString(tsCas.expand(expression)));`,
      },


      {
        id: "factor",
        title: "Factor a polynomial",
        description: "present .",
        code: `const expression = tsCas.parse("x^2*z + 4*x*y*z + 4*y^2*z");
const result = tsCas.factor(expression, "x");
console.log(tsCas.toString(result));


 

`,
      },

      {
        id: "factor-with-steps",
        title: "Factor a polynomial explaining the steps",
        description: "Inspect the exact factors and the factorizer's trace.",
        code: `const expression = tsCas.parse("x^3 - x^2 + x - 1");
const result = tsCas.factorWithSteps(expression, "x");
console.log(tsCas.toString(result.expression));


console.log("Steps:")

result.steps.forEach(step =>
  console.log(step.rule + ": " + tsCas.toString(step.input) + " <=> " + tsCas.toString(step.output))
);

`,
      },
    ],
  },
 



  {
    id: "calculus",
    menuGroup: "Calculus",
    number: "03",
    title: "Derivatives, integrals, and explanations",
    //introduction: "Calculus operations can return a trace of the applied rules along with the symbolic result.",
    paragraphs: [
      "The step-aware calculus functions return both a symbolic result and a structured trace. toLearningExplanation turns that trace into readable steps: the rule, why it applies, and any relevant conditions.",
      "A condition listed for a rule is not automatically proven for every input. Read it together with the expression's domain.",
    ],
    examples: [
      {
        id: "chain-rule-steps",
        title: "Differentiate a composition",
        description: "Edit the function and inspect the chain-rule result and explanation.",
        code: `const trace = tsCas.differentiateWithSteps(
  tsCas.parse("sin(x^2)"),
  "x",
);
const explanation = tsCas.toLearningExplanation(trace, { variable: "x" });
const ruleNames = {
  variable: "Differentiate the variable",
  "power-rule": "Power rule",
  "chain-rule-sin": "Chain rule: sine",
};
console.log(explanation.result);
console.log("Rules:", trace.steps.map(step =>
  ruleNames[step.rule] ?? step.rule
).join(" → "));
console.log("Explained steps:", explanation.steps.length);`,
      },
      {
        id: "polynomial-integral",
        title: "Integrate a polynomial",
        description: "Find a symbolic antiderivative and inspect its trace.",
        code: `const trace = tsCas.integrateWithSteps(
  tsCas.parse("x^2"),
  "x",
);
const explanation = tsCas.toLearningExplanation(trace, { variable: "x" });
const ruleNames = { "integrate-polynomial": "Integrate term by term" };
console.log(explanation.result);
console.log("Rules:", trace.steps.map(step =>
  ruleNames[step.rule] ?? step.rule
).join(" → "));`,
      },
    ],
  },


 
  {
    id: "solvers",
    menuGroup: "Solvers",
    number: "04",
    title: "Solve equations",
    //introduction: "The solver treats its input expression as equal to zero and reports the status of the result.",
    paragraphs: [
      "For supported univariate polynomials, the solver can return exact roots. Its status distinguishes a complete solution set from a partial or unsupported result.",
      "Do not treat a partial list as the complete solution. When an operation provides a certificate, you can also verify it independently.",
    ],
    examples: [
      {
        id: "quadratic-roots",
        title: "Find exact roots of a quadratic",
        description: "Solve x² − 2 and display the status and symbolic roots.",
        code: `const result = tsCas.solveWithSteps(
  tsCas.parse("x^2 - 2"),
  "x",
);
const statusNames = {
  finite: "finite",
  partial: "partial",
  none: "no solutions",
  all: "all real values",
  unsupported: "unsupported",
};
console.log("Status:", statusNames[result.result.status] ?? result.result.status);
console.log(
  result.result.solutions.map(tsCas.toString).join(", ") || "No solutions found",
);`,
      },
      {
        id: "quadratic-pi-roots",
        title: "Find exact roots involving pi",
        description: "Solve x² − π and display its exact roots.",
        code: `const result = tsCas.solve(
  tsCas.parse("x^2 - pi"),
  "x",
);

console.log(
  result.solutions.map(tsCas.toString).join("\\n\\n") || "No solutions found",
);`,
      },
      {
        id: "irrational-power-root",
        title: "Solve an irrational-power equation",
        description: "Solve x^√2 − 2 on the principal power branch.",
        code: `const result = tsCas.solve(
  tsCas.parse("x^sqrt(2)-2"),
  "x",
);

console.log(
  result.solutions.map(tsCas.toString).join("\\n\\n") || "No solutions found",
);`,
      },
      {
        id: "quartic-complex-roots",
        title: "Find exact complex roots of a quartic",
        description: "Solve x⁴ + 10x² + x + 1 and display its four exact complex roots.",
        code: `const result = tsCas.solve(
   tsCas.parse("x^4 + 10*x^2 + x + 1"),
   "x",
 );

 console.log(
   result.solutions.map(tsCas.toString).join("\\n\\n") || "No solutions found",
 );`,
      },
      {
        id: "solve-trig-roots",
        title: "Find exact roots of a trigonometric equation",
        description: "Solve sin(x) − 1 and display the status and symbolic roots.",
        code: `const result = tsCas.solve(
  tsCas.parse("sin(x) - 1"),
  "x",
);
  
console.log(
  result.solutions.map(tsCas.toString).join(", ") || "No solutions found",
);
if (result.parameter) {
  console.log(result.parameter.name + " is an integer");
}`,
      },
    ],
  },
     
 
  {
    id: "domain",
    menuGroup: "Domain",
    number: "05",
    title: "Preserve the original domain",
    //introduction: "An algebraic simplification can change where an expression is defined.",
    paragraphs: [
      "For example, (x² − 1)/(x − 1) simplifies to x + 1, but the original expression is still undefined at x = 1. parseWithDomain preserves restrictions identified while parsing.",
      "Conditions may be incomplete when the analysis cannot decide a symbolic property. The analysis status and returned conditions are part of the result.",
    ],
    examples: [
      {
        id: "domain-restrictions",
        title: "Inspect domain restrictions",
        description: "Edit the rational expression and see which domain conditions are preserved.",
        code: `const analysis = tsCas.parseWithDomain(
  "((x - 1)^2)/(x - 1)",
);
const statusNames = {
  complete: "complete",
  partial: "partial",
  unsupported: "unsupported",
  undefined: "undefined",
};
console.log("Status:", statusNames[analysis.status] ?? analysis.status);
console.log("Expression:", tsCas.toString(analysis.expression));
console.log(analysis.conditions.map(condition =>
  \`\${tsCas.toString(condition.expression)}: \${condition.relation}\`
).join("\\n"));`,
      },

      {
        id: "simplify-with-domain",
        title: "Simplify an expression maintaining the domain",
        description: "Simplify an expression while keeping its domain in mind.",
        code: `
const expr = "(x^3 + x^2 - x - 1)/(x^2 + 2*x + 1)";
const parsed = tsCas.parse(expr);

const result = tsCas.simplifyWithDomain(parsed); 
console.log(expr + " <=> " + tsCas.toString(result.expression));

console.log(result.conditions);
`,
      },

      {
        id: "domain-aware-substitution",
        title: "Check a substitution against the domain",
        description: "The preserved restriction rejects x = 1 but allows x = 2.",
        code: `const expression = tsCas.parseWithDomain("(x^2 - 1)/(x - 1)");
const excluded = tsCas.substituteWithDomain(expression, { x: tsCas.parse("1") });
const allowed = tsCas.substituteWithDomain(expression, { x: tsCas.parse("2") });
console.log("At x = 1:", excluded.status);
console.log("At x = 2:", allowed.status, tsCas.toString(allowed.expression));`,
      },
    ],
  },
 
 
  {
    id: "certificates",
    menuGroup: "Proofs and certificates",
    number: "06",
    title: "Verifiable results",
    //introduction: "Some operations return a result together with data that can be checked independently.",
    paragraphs: [
      "Proof-carrying operations include explanations and certificates for supported cases. verifyProofCarryingResult rechecks the calculation and can bind it to the expression you intended to transform.",
      "A verified certificate is an executable algebraic check within the implemented scope, not a formal proof in a proof assistant.",
    ],
    examples: [
      {
        id: "verified-factorization",
        title: "Verify a factorization",
        description: "Generate and verify an identity certificate for x² − 1.",
        code: `const input = tsCas.parse("x^2 - 1");
const proof = tsCas.factorWithProof(input, "x");
if (proof.status === "unsupported") {
  console.log(proof.message);
} else {
  console.log("Factorization:", proof.calculation.result);
  console.log(
    tsCas.verifyProofCarryingResult(proof.calculation, input),
  );
}`,
      },
      {
        id: "antiderivative-certificate",
        title: "Verify an antiderivative",
        description: "Check that the derivative of the returned primitive matches the integrand.",
        code: `const integrand = tsCas.parse("2*x");
const result = tsCas.createAntiderivativeCertificate(integrand, "x");
if ("certificate" in result) {
  console.log("Status:", result.status);
  console.log(
    tsCas.verifyAntiderivativeCertificate(result.certificate, integrand),
  );
} else {
  console.log(result.status, result.message);
}`,
      },
    ],
  },
    
 
  {
    id: "numerical-bounds",
    menuGroup: "Numerical methods",
    number: "07",
    title: "Approximations and numerical bounds",
    //introduction: "The CAS distinguishes numerical approximations from results with certified bounds.",
    paragraphs: [
      "The numerical engine can configure precision and evaluate expressions over intervals. For supported operations and functions, outward-rounded interval arithmetic returns an interval containing the exact value.",
      "Certification has limits: unsupported expressions or precision requests are rejected rather than silently presented as guarantees.",
    ],
    examples: [
      {
        id: "certified-interval",
        title: "Bound sin(x) with an interval",
        description: "Evaluate sin(x) for x between 0 and 1 using certified outward rounding.",
        code: `const engine = tsCas.createNumericalEngine({ precision: 24 });
const result = engine.evaluateInterval(
  tsCas.parse("sin(x)"),
  { x: { lower: "0", upper: "1" } },
);
console.log(tsCas.decimalIntervalToString(result.interval));
console.log("Certified:", result.certified);
console.log("Precision:", result.precision, "digits");`,
      },

      {
        id: "high-precision-decimal",
        title: "Evaluate one seventh to 40 digits",
        description: "Use a configured decimal engine instead of JavaScript's binary floating-point numbers.",
        code: `const engine = tsCas.createNumericalEngine({ precision: 40 });
const value = engine.evaluate(tsCas.parse("1/7"));
console.log(tsCas.decimalToString(value));
console.log("Configured precision:", engine.precision);`,
      },
      {
        id: "numerical-root",
        title: "Find a numerical root",
        description: "Approximate ln(2) by solving exp(x) − 2 = 0 on [0, 1].",
        code: `const engine = tsCas.createNumericalEngine({ precision: 30 });
const result = engine.solveRoot(
  tsCas.parse("exp(x) - 2"),
  "x",
  "0",
  "1",
);
console.log("Status:", result.status);
console.log("Approximate root:", result.rootText ?? "not available");
console.log("Precision:", result.precision, "digits");`,
      },
    ],
  },
    
 
  {
    id: "limits-and-series",
    menuGroup: "Limits and series",
    number: "08",
    title: "Limits and local series",
    //introduction: "Limits and Taylor series describe behavior near a point, including points where direct substitution fails.",
    paragraphs: [
      "A limit result includes its status and method. For sin(x)/x at zero, direct substitution is indeterminate, so the supported limit rules reduce the expression to an exact value.",
      "Taylor expansions keep exact symbolic coefficients and report the truncation order. The supported order and expression forms are deliberately bounded.",
    ],
    examples: [
      {
        id: "l-hopital-limit",
        title: "Evaluate a limit with L'Hôpital's rule",
        description: "Find the exact limit of sin(x)/x as x approaches zero.",
        code: `const result = tsCas.limit(
  tsCas.parse("sin(x)/x"),
  "x",
  tsCas.parse("0"),
);
console.log("Status:", result.status);
console.log("Limit:", result.value ? tsCas.toString(result.value) : result.status);
console.log("Method:", result.method);
console.log("L'Hôpital steps:", result.lHopitalSteps);`,
      },
      {
        id: "taylor-series",
        title: "Expand sine as a Taylor series",
        description: "Build a fifth-order expansion with exact rational coefficients.",
        code: `const expansion = tsCas.taylorSeries(
  tsCas.parse("sin(x)"),
  "x",
  tsCas.parse("0"),
  5,
);
console.log(tsCas.toString(expansion.expression));
console.log("Remainder:", expansion.remainder);
console.log("Leading exponent:", expansion.leadingExponent);`,
      },
    ],
  },
     
 
  {
    id: "linear-algebra",
    menuGroup: "Matrices",
    number: "09",
    title: "Exact linear algebra",
    //introduction: "The matrix APIs use symbolic expressions, so rational coefficients stay exact while solving systems.",
    paragraphs: [
      "solveMatrixSystem reports whether the system has a unique solution, infinitely many solutions, or no solution. Its input is a coefficient matrix A and a right-hand-side vector b for A·x = b.",
    ],
    examples: [
      {
        id: "exact-linear-system",
        title: "Solve a linear system exactly",
        description: "Solve two equations and keep the rational solution exact.",
        code: `const coefficients = [
  [tsCas.parse("1"), tsCas.parse("2")],
  [tsCas.parse("3"), tsCas.parse("4")],
];
const result = tsCas.solveMatrixSystem(
  coefficients,
  [tsCas.parse("5"), tsCas.parse("11")],
);
console.log("Status:", result.status);
console.log("Solution:", result.solution?.map(tsCas.toString).join(", "));`,
      },
    ],
  },
    
 
  {
    id: "polynomial-certificates",
    menuGroup: "Polynomials certificates",
    number: "10",
    title: "Certify roots and inequalities",
    //introduction: "Exact polynomial certificates can verify root counts and sign charts using rational arithmetic.",
    paragraphs: [
      "Root certificates use Sturm sequences to isolate real roots and certify their total count. Inequality certificates add rational witnesses for the sign of the polynomial between roots.",
      "These APIs support univariate polynomials with exact rational coefficients. Unsupported inputs do not produce a successful certificate.",
    ],
    examples: [
      {
        id: "polynomial-root-certificate",
        title: "Certify the real roots of a polynomial",
        description: "Create a JSON-serializable certificate for x² − 2 and verify it against the input.",
        code: `const expression = tsCas.parse("x^2 - 2");
const result = tsCas.createPolynomialRootCertificate(expression, "x");
if ("certificate" in result) {
  const saved = JSON.parse(JSON.stringify(result.certificate));
  const verification = tsCas.verifyPolynomialRootCertificate(saved, expression);
  console.log("Status:", result.status);
  console.log("Distinct real roots:", result.certificate.totalDistinctRealRoots);
  console.log("Verified:", verification.valid);
} else {
  console.log(result.status, result.message);
}`,
      },
      {
        id: "polynomial-inequality-certificate",
        title: "Certify a polynomial inequality",
        description: "Build and verify a complete sign chart for x² − 4 ≤ 0.",
        code: `const expression = tsCas.parse("x^2 - 4");
const result = tsCas.createPolynomialInequalityCertificate(expression, "x", "<=");
if ("certificate" in result) {
  const verification = tsCas.verifyPolynomialInequalityCertificate(
    result.certificate,
    expression,
  );
  console.log("Status:", result.status);
  console.log("Sign cells:", result.certificate.cells.map(cell =>
    \`\${cell.sign > 0 ? "+" : "-"} \${cell.accepted ? "included" : "excluded"}\`
  ).join(", "));
  console.log("Verified:", verification.valid);
} else {
  console.log(result.status, result.message);
}`,
      },
    ],
  },
     
 
  {
    id: "data-and-sequences",
    menuGroup: "Statistics and sequences",
    number: "12",
    title: "Statistics and sequences",
    //introduction: "The library also includes practical numeric tools for data summaries and sequence generation.",
    paragraphs: [
      "Descriptive statistics return a five-number summary and explicitly identify the quartile convention. Sequence helpers use JavaScript numbers, so their values are approximate when floating-point rounding applies.",
    ],
    examples: [
      {
        id: "descriptive-statistics",
        title: "Summarize a dataset",
        description: "Calculate the mean, median, and range of a small dataset.",
        code: `const summary = tsCas.describeQuantitativeData([1, 2, 2, 3, 7]);
console.log("Mean:", summary.mean);
console.log("Median:", summary.median);
console.log("Range:", summary.range);
console.log("Quartile method:", summary.quartileMethod);`,
      },
      {
        id: "recurrence-sequence",
        title: "Generate a Fibonacci sequence",
        description: "Use the recurrence helper to generate the first eight terms.",
        code: `const values = tsCas.recurrenceSequence(
  [0, 1],
  8,
  previous => previous[previous.length - 1] + previous[previous.length - 2],
);
console.log(values.join(", "));`,
      },
    ],
  },
 
];

const TUTORIAL_MENU_ORDER: readonly {
  readonly id: string;
  readonly title: TutorialMenuGroupTitle;
}[] = [
  { id: "basic-operations", title: "Basic operations" },
  { id: "simplification", title: "Simplification" },
  { id: "calculus", title: "Calculus" },
  { id: "solvers", title: "Solvers" },
  { id: "domain", title: "Domain" },
  
  
  
  { id: "proofs-certificates", title: "Proofs and certificates" },
  { id: "polynomials-certificates", title: "Polynomials certificates" },
  { id: "numerical-methods", title: "Numerical methods" },
  { id: "limits-series", title: "Limits and series" },
  { id: "matrices", title: "Matrices" },

  { id: "statistics-sequences", title: "Statistics and sequences" },
];

export const TUTORIAL_MENU: readonly TutorialMenuGroup[] = TUTORIAL_MENU_ORDER
  .flatMap(({ id, title }) => {
    const chapters = TUTORIAL_CHAPTERS.filter((chapter) => chapter.menuGroup === title);
    const section = chapters[0];
    const items = chapters.flatMap((chapter) => chapter.examples.map((example) => ({
        id: `example-${example.id}`,
        title: example.title,
    })));
    return section && items.length > 0
      ? [{ id, sectionId: section.id, title, items }]
      : [];
  });
