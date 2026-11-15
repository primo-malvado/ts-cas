import {
  differentiateWithSteps,
  expand,
  factorWithSteps,
  integrateWithSteps,
  parse,
  parseWithDomain,
  simplify,
  solveWithSteps,
  toLearningExplanation,
  toString,
  type DomainSimplificationStatus,
  type LearningStep,
} from "ts-cas";

export const PLAYGROUND_OPERATIONS = [
  { id: "simplify", label: "Simplificar", description: "Reduz a expressão pela simplificação simbólica disponível." },
  { id: "expand", label: "Expandir", description: "Desenvolve produtos e potências suportados." },
  { id: "factor", label: "Fatorizar", description: "Procura uma fatorização exata nos padrões implementados." },
  { id: "differentiate", label: "Derivar", description: "Calcula a derivada simbólica e mostra as regras aplicadas." },
  { id: "integrate", label: "Integrar", description: "Procura uma primitiva simbólica; casos não suportados são reportados." },
  { id: "solve", label: "Resolver f(x) = 0", description: "Resolve a equação para a variável indicada, nos casos suportados." },
  { id: "domain", label: "Analisar domínio", description: "Simplifica a expressão e mantém as condições de domínio identificadas." },
] as const;

export type PlaygroundOperation = (typeof PLAYGROUND_OPERATIONS)[number]["id"];

export interface PlaygroundExample {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly expression: string;
  readonly operation: PlaygroundOperation;
  readonly variable: string;
  readonly description: string;
}

export const PLAYGROUND_EXAMPLES: readonly PlaygroundExample[] = [
  {
    id: "chain-rule",
    title: "Regra da cadeia",
    category: "Cálculo",
    expression: "sin(x^2)",
    operation: "differentiate",
    variable: "x",
    description: "Deriva uma composição e apresenta os passos de aprendizagem.",
  },
  {
    id: "domain",
    title: "Domínio preservado",
    category: "Domínio",
    expression: "((x - 1)^2)/(x - 1)",
    operation: "domain",
    variable: "x",
    description: "Mostra por que a forma simplificada continua a excluir x = 1.",
  },
  {
    id: "factor",
    title: "Diferença de quadrados",
    category: "Álgebra",
    expression: "x^2 - 1",
    operation: "factor",
    variable: "x",
    description: "Fatoriza um polinómio com coeficientes racionais exatos.",
  },
  {
    id: "roots",
    title: "Raízes exatas",
    category: "Equações",
    expression: "x^2 - 2",
    operation: "solve",
    variable: "x",
    description: "Resolve uma quadrática e apresenta as raízes simbólicas.",
  },
  {
    id: "integral",
    title: "Primitiva polinomial",
    category: "Cálculo",
    expression: "x^2",
    operation: "integrate",
    variable: "x",
    description: "Integra um polinómio; a constante é indicada na explicação.",
  },
  {
    id: "expand",
    title: "Produto notável",
    category: "Álgebra",
    expression: "(x + 1)^3",
    operation: "expand",
    variable: "x",
    description: "Desenvolve uma potência sem aproximação numérica.",
  },
  {
    id: "simplify",
    title: "Termos semelhantes",
    category: "Álgebra",
    expression: "2*x + 3*x",
    operation: "simplify",
    variable: "x",
    description: "Combina termos semelhantes com coeficientes exatos.",
  },
];

export interface PlaygroundStep {
  readonly title: string;
  readonly why: string;
  readonly conditions: readonly string[];
  readonly output?: string;
}

export interface PlaygroundResult {
  readonly value: string;
  readonly status: string;
  readonly note?: string;
  readonly conditions?: readonly string[];
  readonly steps?: readonly PlaygroundStep[];
}

type LearningOperation = "differentiate" | "factor" | "integrate" | "solve";
type LearningText = Omit<PlaygroundStep, "output">;

export interface PlaygroundRequest {
  readonly expression: string;
  readonly operation: PlaygroundOperation;
  readonly variable: string;
}

const domainStatusLabels: Record<DomainSimplificationStatus, string> = {
  complete: "Análise completa para as regras suportadas",
  partial: "Análise parcial",
  unsupported: "Expressão não suportada",
  undefined: "Expressão indefinida no domínio real",
};

const relationLabels = {
  nonzero: "≠ 0",
  positive: "> 0",
  nonnegative: "≥ 0",
} as const;

const solveStatusLabels = {
  finite: "finito",
  infinite: "família infinita",
  partial: "parcial",
  none: "sem soluções",
  all: "todas as soluções",
  unsupported: "não suportado",
} as const;

const sharedLearningText: Partial<Record<LearningStep["rule"], LearningText>> = {
  constant: {
    title: "Derivar uma constante",
    why: "Uma constante não varia com a variável escolhida.",
    conditions: ["A expressão não depende da variável de derivação."],
  },
  variable: {
    title: "Derivar a variável escolhida",
    why: "A derivada de uma variável em relação a si própria é um.",
    conditions: ["O símbolo é a variável selecionada."],
  },
  "constant-symbol": {
    title: "Derivar outro símbolo",
    why: "Um símbolo diferente da variável escolhida é tratado como constante.",
    conditions: ["O símbolo é independente da variável de derivação."],
  },
  "product-rule": {
    title: "Aplicar a regra do produto",
    why: "Deriva-se um fator de cada vez e somam-se os produtos resultantes.",
    conditions: ["Cada fator é diferenciável no ponto ou intervalo considerado."],
  },
  "logarithmic-power-rule": {
    title: "Derivar uma potência com expoente variável",
    why: "Reescreve-se u(x)^v(x) como exp(v(x)*log(u(x))) e aplicam-se as regras da cadeia e do produto.",
    conditions: ["A base é positiva e a base e o expoente são diferenciáveis."],
  },
  "chain-rule-sin": {
    title: "Aplicar a regra da cadeia ao seno",
    why: "A derivada de sin(u) é cos(u)*u'.",
    conditions: ["A função interior é diferenciável."],
  },
  "chain-rule-cos": {
    title: "Aplicar a regra da cadeia ao cosseno",
    why: "A derivada de cos(u) é -sin(u)*u'.",
    conditions: ["A função interior é diferenciável."],
  },
  "chain-rule-tan": {
    title: "Aplicar a regra da cadeia à tangente",
    why: "A derivada de tan(u) é u'/cos(u)^2.",
    conditions: ["A função interior é diferenciável e cos(u) não é zero."],
  },
  "chain-rule-atan": {
    title: "Aplicar a regra da cadeia ao arco-tangente",
    why: "A derivada de atan(u) é u'/(1+u^2).",
    conditions: ["A função interior é diferenciável."],
  },
  "chain-rule-exp": {
    title: "Aplicar a regra da cadeia à exponencial",
    why: "A derivada de exp(u) é exp(u)*u'.",
    conditions: ["A função interior é diferenciável."],
  },
  "chain-rule-log": {
    title: "Aplicar a regra da cadeia ao logaritmo",
    why: "A derivada de log(u) é u'/u.",
    conditions: ["A função interior é diferenciável e u é positivo."],
  },
  "chain-rule-log-abs": {
    title: "Derivar o logaritmo de um valor absoluto",
    why: "Em cada lado de zero, a derivada de log(|u|) é u'/u.",
    conditions: ["A função interior é diferenciável e u não é zero."],
  },
  "chain-rule-sqrt": {
    title: "Aplicar a regra da cadeia à raiz quadrada",
    why: "Para u positivo, a derivada de sqrt(u) é u'/(2*sqrt(u)).",
    conditions: ["A função interior é diferenciável e u é positivo."],
  },
  "chain-rule-cbrt": {
    title: "Aplicar a regra da cadeia à raiz cúbica",
    why: "Fora de zero, a derivada de cbrt(u) é u'/(3*cbrt(u)^2).",
    conditions: ["A função interior é diferenciável e u não é zero."],
  },
  "chain-rule-abs": {
    title: "Derivar um valor absoluto",
    why: "Onde u não é zero, a derivada de |u| é sign(u)*u'.",
    conditions: ["A função interior é diferenciável e u não é zero."],
  },
  "integrate-independent-expression": {
    title: "Integrar uma expressão independente da variável",
    why: "Uma expressão constante em relação à variável integra-se multiplicando-a por essa variável.",
    conditions: ["O integrando é independente da variável de integração."],
  },
  "integrate-polynomial": {
    title: "Integrar termo a termo",
    why: "Em cada termo c*x^n, soma-se um ao expoente e divide-se pelo novo expoente.",
    conditions: ["O integrando é um polinómio com coeficientes racionais exatos."],
  },
  "u-substitution": {
    title: "Usar substituição",
    why: "Um fator corresponde à derivada de uma expressão interior, reduzindo a integral a uma primitiva conhecida.",
    conditions: ["A relação com a derivada interior é exata e a integral exterior é suportada."],
  },
  "rational-partial-fractions": {
    title: "Integrar por frações parciais",
    why: "A divisão polinomial e as frações parciais reduzem a função racional a termos mais simples.",
    conditions: ["O denominador decompõe-se em fatores lineares racionais."],
  },
  "integration-by-parts": {
    title: "Usar integração por partes",
    why: "Escolhem-se u e dv para transformar a integral numa expressão mais simples.",
    conditions: ["As derivadas, primitivas e a integral restante são suportadas."],
  },
  "constant-multiple": {
    title: "Colocar uma constante em evidência",
    why: "Um fator independente da variável pode sair da integral.",
    conditions: ["O fator extraído é independente da variável de integração."],
  },
  "elementary-chain-rule": {
    title: "Integrar uma função elementar de expressão afim",
    why: "Aplica-se uma primitiva conhecida e divide-se pelo declive da expressão interior.",
    conditions: ["O argumento é afim, tem declive não nulo e está definido no domínio real."],
  },
  "convert-to-polynomial": {
    title: "Converter para a forma polinomial",
    why: "A representação polinomial canónica permite aplicar algoritmos exatos de fatorização.",
    conditions: ["A expressão é um polinómio com coeficientes racionais exatos."],
  },
  "factor-univariate-over-rationals": {
    title: "Fatorizar um polinómio univariável sobre os racionais",
    why: "O algoritmo procura raízes racionais e fatores repetidos; fatores irredutíveis podem permanecer.",
    conditions: ["O polinómio tem no máximo uma variável e coeficientes racionais exatos."],
  },
  "factor-multivariate-patterns": {
    title: "Procurar padrões multivariáveis suportados",
    why: "O fatorizador verifica identidades como fator comum, diferença de quadrados e agrupamento.",
    conditions: ["Só são decompostos padrões reconhecidos pelo fatorizador atual."],
  },
  "reconstruct-factorization": {
    title: "Reconstruir a fatorização",
    why: "Multiplicam-se o conteúdo e os fatores listados, respeitando as multiplicidades.",
    conditions: ["O produto dos fatores tem de ser exatamente igual ao polinómio original."],
  },
  "normalize-to-zero": {
    title: "Escrever a equação como expressão igual a zero",
    why: "O solver interpreta a entrada como o lado esquerdo de uma equação cujo lado direito é zero.",
    conditions: ["A equação pode ser representada pelo lado esquerdo menos o lado direito."],
  },
  "classify-polynomial-degree": {
    title: "Classificar o grau do polinómio",
    why: "O grau determina que regra exata pode ser aplicada.",
    conditions: ["A expressão é um polinómio univariável com coeficientes racionais exatos."],
  },
  "constant-equation": {
    title: "Resolver uma equação constante",
    why: "Uma constante não nula não tem raízes; o polinómio nulo é satisfeito por todos os valores.",
    conditions: ["O polinómio tem grau zero ou é identicamente nulo."],
  },
  "linear-formula": {
    title: "Resolver a equação linear",
    why: "Em a*x+b=0, isola-se x para obter x=-b/a.",
    conditions: ["A equação tem grau um e a é não nulo."],
  },
  "quadratic-discriminant": {
    title: "Calcular o discriminante",
    why: "O valor Δ=b^2-4ac determina o número e a forma das raízes quadráticas.",
    conditions: ["A equação é quadrática e a é não nulo."],
  },
  "quadratic-formula": {
    title: "Aplicar a fórmula resolvente",
    why: "Substituem-se a, b e c em x=(-b±sqrt(Δ))/(2a).",
    conditions: ["A equação é quadrática; para raízes reais, o discriminante tem de ser não negativo."],
  },
  "factor-over-rationals": {
    title: "Fatorizar sobre os racionais",
    why: "Fatores racionais podem reduzir uma equação de grau elevado a subproblemas lineares ou quadráticos.",
    conditions: ["Fatores com grau superior a dois podem ficar por resolver."],
  },
  "report-solver-status": {
    title: "Apresentar o estado do solver",
    why: "O estado distingue uma resposta completa de um resultado parcial ou não suportado.",
    conditions: ["Só raízes obtidas por regras exatas suportadas são apresentadas como resolvidas."],
  },
  "unsupported-input": {
    title: "Parar perante uma entrada não suportada",
    why: "O solver exato atual não consegue aplicar as regras polinomiais a esta entrada.",
    conditions: ["Estas regras exigem um polinómio univariável com coeficientes racionais exatos."],
  },
};

const operationLearningText: Partial<
  Record<LearningOperation, Partial<Record<LearningStep["rule"], LearningText>>>
> = {
  differentiate: {
    "sum-rule": {
      title: "Aplicar a regra da soma",
      why: "A derivada de uma soma é a soma das derivadas dos seus termos.",
      conditions: ["Cada termo é diferenciável no ponto ou intervalo considerado."],
    },
    "power-rule": {
      title: "Aplicar a regra da potência",
      why: "Para u(x)^n com n constante, a derivada é n*u(x)^(n-1)*u'(x).",
      conditions: ["O expoente é constante e a potência está definida no domínio real."],
    },
  },
  integrate: {
    "sum-rule": {
      title: "Integrar cada termo",
      why: "A primitiva de uma soma é a soma das primitivas.",
      conditions: ["Cada termo tem uma primitiva suportada."],
    },
    "power-rule": {
      title: "Aplicar a regra da potência afim",
      why: "Integra-se a potência de uma expressão afim e divide-se pelo seu declive.",
      conditions: ["A expressão base é afim e tem declive não nulo."],
    },
  },
};

function presentLearningSteps(
  steps: readonly LearningStep[],
  operation: LearningOperation,
): PlaygroundStep[] {
  return steps.map((step) => {
    const text = operationLearningText[operation]?.[step.rule]
      ?? sharedLearningText[step.rule]
      ?? { title: step.title, why: step.why, conditions: step.conditions };
    return { ...text, output: step.output };
  });
}

export function evaluatePlayground(request: PlaygroundRequest): PlaygroundResult {
  const source = request.expression.trim();
  if (!source) {
    throw new Error("Escreve uma expressão antes de executar o cálculo.");
  }

  const variable = request.variable.trim();
  if (
    ["differentiate", "integrate", "solve", "factor"].includes(request.operation)
    && !variable
  ) {
    throw new Error("Indica a variável para esta operação.");
  }

  if (request.operation === "domain") {
    const analysis = parseWithDomain(source);
    const conditions = analysis.conditions.map(
      (condition) => `${toString(condition.expression)} ${relationLabels[condition.relation]}`,
    );
    return {
      value: analysis.expression
        ? toString(analysis.expression)
        : "Não foi possível produzir uma expressão simplificada.",
      status: domainStatusLabels[analysis.status],
      note: analysis.message ?? "As condições listadas limitam a equivalência com a expressão original.",
      conditions,
    };
  }

  const expression = parse(source);
  switch (request.operation) {
    case "simplify":
      return {
        value: toString(simplify(expression)),
        status: "Simplificação simbólica",
      };
    case "expand":
      return {
        value: toString(expand(expression)),
        status: "Expansão simbólica",
      };
    case "factor": {
      const trace = factorWithSteps(expression, variable);
      const explanation = toLearningExplanation(trace, { variable });
      return {
        value: explanation.result,
        status: "Fatorização simbólica",
        steps: presentLearningSteps(explanation.steps, "factor"),
      };
    }
    case "differentiate": {
      const trace = differentiateWithSteps(expression, variable);
      const explanation = toLearningExplanation(trace, { variable });
      return {
        value: explanation.result,
        status: "Derivada simbólica",
        steps: presentLearningSteps(explanation.steps, "differentiate"),
      };
    }
    case "integrate": {
      const trace = integrateWithSteps(expression, variable);
      const explanation = toLearningExplanation(trace, { variable });
      return {
        value: explanation.result,
        status: "Primitiva simbólica",
        note: "A API omite a constante de integração no valor algébrico; a explicação apresenta + C.",
        steps: presentLearningSteps(explanation.steps, "integrate"),
      };
    }
    case "solve": {
      const explanation = solveWithSteps(expression, variable);
      const result = explanation.result;
      const value = result.status === "finite" || result.status === "infinite"
        ? result.solutions.length > 0
          ? result.solutions.map(toString).join(", ") +
            (result.parameter ? ` (${result.parameter.name} inteiro)` : "")
          : "∅"
        : result.status === "all"
          ? "Todos os valores reais"
          : result.status === "none"
            ? "∅"
            : result.solutions.length > 0
              ? result.solutions.map(toString).join(", ")
              : "Não foi possível determinar as soluções.";
      const learning = toLearningExplanation(explanation, { variable });
      return {
        value,
        status: `Estado do solver: ${solveStatusLabels[result.status]}`,
        note: result.message,
        steps: presentLearningSteps(learning.steps, "solve"),
      };
    }
  }
}
