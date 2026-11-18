# Architecture boundary checks

Run from the repository root after `npm ci`:

```sh
npm run check:boundaries
node --test scripts/architecture/*.test.mjs
```

The checker uses the TypeScript AST parser. It covers TS/JS files under `src` in explicitly listed workspaces. It recognizes static imports, type-only imports, re-exports, `import("...").Type` expressions, dynamic imports with literal specifiers, `import = require`, literal `require` calls, and triple-slash references. Comments and strings containing apparent imports do not create dependencies. A dynamic module name is an error because its boundaries cannot be verified statically.

| File | Single primary responsibility |
| --- | --- |
| `project.mjs` | Discover workspaces, source files, and their owners. |
| `parse.mjs` | Read dependency edges from the AST. |
| `resolve.mjs` | Resolve paths and public package exports. |
| `policy.mjs` | Define explicitly allowed dependency directions. |
| `check.mjs` | Orchestrate analysis and detect cycles, including type dependencies. |
| `report.mjs` | Format readable diagnostics with file names and positions. |
| `check-boundaries.test.mjs` | Cover violations and valid exceptions with regression tests. |

The kernel depends only on the kernel. Contracts depend on the kernel and contracts. A module's domain depends on its own domain, contracts, and the kernel. The application/ports layers communicate with other modules through `public/index.ts`; they do not wire adapters. They may use a local, pure `public/types.ts` to define explicit DTOs without importing a factory. Node types and external packages are forbidden in these pure layers.

The composition root may wire concrete adapters. `demo/public/index.ts` is the only public entry point allowed to export a factory from its own composition layer. Production core modules do not depend on the demo. The API may use Node and the backend package's declared exports; a relative reference from the API to a backend file is forbidden even when that file is under `public`.

The checker requires explicit workspace paths and explicit package exports; glob/pattern exports, source symlinks, and imports of resources outside the checked code are unsupported. Dependency analysis does not replace semantic type checking, behavioral tests, or runtime authorization checks. It is not a defense against code deliberately hidden in `eval`, code generation, or a custom loader.
