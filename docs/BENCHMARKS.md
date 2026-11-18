# Benchmarks and adoption

This page documents how ts-cas publishes comparable evidence and what is not
yet supported as a cross-library benchmark.

## npm adoption snapshot

Snapshot collected 2026-11-18 using the npm registry:

| Package | Current npm version | Downloads in the previous week |
| --- | ---: | ---: |
| mathjs | 15.2.0 | 5,520,254 |
| nerdamer | 2.0.1 | 26,227 |
| algebrite | 1.4.0 | 4,722 |
| ts-cas | 1.0.0 | not reported at publication time |

Download counts are adoption indicators, not engineering performance
benchmarks. They also include CI, bots, mirrors, and application build activity.

## Built-in performance evidence

The `benchmark` script in `scripts/benchmarks.mjs` is run by CI and can enforce
representative median budgets. It currently covers:

- step-aware differentiation;
- domain-aware simplification;
- polynomial root certificates; and
- polynomial inequality certificates.

CI publishes the machine-readable `benchmark-results.json` as an artifact.
Run the same benchmark locally with:

```bash
npm run benchmark
BENCHMARK_ENFORCE=1 npm run benchmark
```

## Cross-library benchmark policy

Do not publish a single cross-library winner until operations, inputs,
versions, runtimes, warm-up, and result interpretation are identical. The
first comparison should cover these reproducible operations:

1. parsing and simplification;
2. polynomial expansion and factorization;
3. symbolic differentiation;
4. symbolic integration;
5. exact linear solving; and
6. certified or unconstrained numeric roots, reported separately.

Each result must include package versions, Node.js version, CPU, iteration
count, warm-up count, median and percentile values, and whether the competitor
returns exact, approximate, or certified output.

A third-party benchmark study comparing JavaScript CAS libraries is indexed at
[Zenodo 11402820](https://zenodo.org/records/11402820). It is useful historical
context but does not replace a versioned ts-cas benchmark run.
