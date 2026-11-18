# API stability

`ts-cas/core` is the frozen integration surface. It covers parsing, printing,
exact expression transforms, differentiation, integration, equation solving,
and numeric evaluation.

```js
import {
  differentiate,
  parse,
  simplify,
  toString,
} from "ts-cas/core";

console.log(toString(simplify(parse("2x + 3x"))));
console.log(toString(differentiate(parse("x^2"), "x")));
```

The package entrypoint remains the full API. It may add exports at minor
versions, but must not add new exports to `ts-cas/core` or change the behavior
of an existing export without following a major release.

## Compatibility rules

- **Patch:** bug fixes, documentation, and test additions. Existing return
  values and exceptions remain compatible.
- **Minor:** new exports and optional return metadata. Required parameters,
  existing fields, and documented guarantees are not changed.
- **Major:** removed exports, changed required parameters, changed result
  meaning, or removed guarantee. A deprecated alias remains for at least one
  major release.

## Verification

Every release runs the full test suite and a public export check for
`ts-cas/core`. Breaking a frozen export makes CI fail. The TypeScript
declarations in `dist/src/core-api.d.ts` are published with the package.
