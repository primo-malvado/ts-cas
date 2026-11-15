# ts-cas Angular site

The site is an Angular application (Node.js 22+) that bundles the local `ts-cas` package.
Its playground runs symbolic operations in the visitor's browser; no
calculation is sent to a server.

## Local development

From the repository root:

```bash
npm ci
npm run build
npm ci --prefix site
npm start --prefix site
```

Open `http://localhost:4200/`. The page has a short English introduction
followed by a chapter-based tutorial with editable TypeScript examples that
execute against the bundled `ts-cas` API in a Web Worker. The cells have no DOM
or network access and are terminated after five seconds; TypeScript is
transpiled but not type-checked.

After changing the library, run `npm run build` at the repository root to
update the compiled package used by the site. Restart the site server if it
does not pick up the rebuilt package. The development server excludes `ts-cas`
from dependency prebundling to avoid serving an outdated cached copy.

Run the playground and tutorial-cell tests from the repository root with
`npm run test:site`, and create the production bundle with
`npm run build --prefix site`.
