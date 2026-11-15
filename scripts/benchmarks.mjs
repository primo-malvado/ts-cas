import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createPolynomialInequalityCertificate,
  createPolynomialRootCertificate,
  differentiateWithSteps,
  parse,
  simplifyWithDomain,
} from "../dist/src/index.js";

const cases = [
  {
    name: "differentiate-with-steps",
    maximumMedianMilliseconds: 100,
    run: () => differentiateWithSteps(parse("exp(x^2)*sin(x)"), "x"),
  },
  {
    name: "simplify-with-domain",
    maximumMedianMilliseconds: 2000,
    run: () => simplifyWithDomain(parse("(x^6 - 1)/(x^3 - 1)")),
  },
  {
    name: "polynomial-root-certificate",
    maximumMedianMilliseconds: 2000,
    run: () => createPolynomialRootCertificate(parse("x^4 - 5*x^2 + 4"), "x"),
  },
  {
    name: "polynomial-inequality-certificate",
    maximumMedianMilliseconds: 2000,
    run: () => createPolynomialInequalityCertificate(parse("x^4 - 5*x^2 + 4"), "x", "<="),
  },
];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const report = {
  schemaVersion: 1,
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  benchmarks: [],
};
const regressions = [];

for (const { name, run, maximumMedianMilliseconds } of cases) {
  run();
  const durations = [];
  for (let iteration = 0; iteration < 7; iteration++) {
    const start = performance.now();
    const result = run();
    durations.push(performance.now() - start);
    if (result?.status && result.status !== "complete") {
      throw new Error(`${name} returned ${result.status}; benchmark case is no longer valid.`);
    }
  }
  const result = {
    name,
    iterations: durations.length,
    medianMilliseconds: Number(median(durations).toFixed(3)),
    minimumMilliseconds: Number(Math.min(...durations).toFixed(3)),
    maximumMilliseconds: Number(Math.max(...durations).toFixed(3)),
    maximumMedianMilliseconds,
  };
  report.benchmarks.push(result);
  console.log(`${name}: median ${result.medianMilliseconds} ms (7 iterations)`);
  if (process.env.BENCHMARK_ENFORCE === "1" &&
      result.medianMilliseconds > maximumMedianMilliseconds) {
    regressions.push(
      `${name}: median ${result.medianMilliseconds} ms exceeds ${maximumMedianMilliseconds} ms`,
    );
  }
}

if (process.env.BENCHMARK_OUTPUT) {
  const output = resolve(process.env.BENCHMARK_OUTPUT);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Machine-readable report: ${output}`);
}

if (regressions.length > 0) {
  throw new Error(`Benchmark regression budget exceeded:\n${regressions.join("\n")}`);
}
