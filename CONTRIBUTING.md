# Contributing

Thanks for helping improve `ts-cas`. This project is actively developed; keep
changes focused, preserve exact arithmetic where available, and make unsupported
cases explicit instead of returning plausible-looking results.

## Local checks

Use Node.js 20 or 22 and install the locked dependencies:

```sh
npm ci
npm run test:all
npm run validate:domain-helpers
npm run benchmark
```

The GitHub Actions workflow runs the build, full test suite, domain-helper
checks, and representative benchmarks. To save a machine-readable benchmark report
locally:

```sh
BENCHMARK_OUTPUT=/tmp/ts-cas-benchmarks.json npm run benchmark
```

Benchmark values vary by machine. CI uses deliberately generous median budgets
to flag severe slowdowns, not to enforce fine-grained hardware-specific targets.

## Mathematical and domain behavior

- Add focused tests for new behavior, including unsupported and boundary cases.
- Prefer exact rational calculations for symbolic algorithms and certificates.
- When simplifying or transforming expressions, preserve domain restrictions or
  return a status that explains why they could not be determined.
- Certificates must be independently verifiable from their serialized data;
  never trust stored counts, signs, or rank claims without recomputing them.
- Algorithm traces explain the selected implementation path; do not describe
  them as formal proofs unless a verifier checks every proof step.

## Releases

Package versions follow semantic versioning. Before merging a release to
`master`, bump the version in `package.json` and `package-lock.json`:

```sh
npm version patch --no-git-tag-version
```

Use `patch` for compatible bug fixes, `minor` for backward-compatible features,
and `major` for breaking API changes. Include the version bump in the commit
pushed to `master`; the publish workflow publishes a version only once and
skips pushes whose version is already on npm.

The first publication creates the npm package and must be done manually from a
logged-in maintainer machine with `npm publish --access public`. Enable
two-factor authentication on the npm account first, and complete any
authentication prompt. Inspect the package with `npm pack --dry-run` before
publishing. Then configure
npm Trusted Publishing for this repository and
`.github/workflows/publish.yml`; subsequent version bumps are published
automatically after pushes to `master`, without a long-lived npm token.

## License

By contributing you agree that your contributions are licensed under the
MIT License, the same license as this project.
