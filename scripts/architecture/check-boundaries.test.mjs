import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkProject } from './check.mjs';
import { parseDependencies } from './parse.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const backend = 'packages/backend/src/';
const module = `${backend}modules/sample/`;
const api = 'apps/api/src/';
const web = 'apps/web/src/';

async function fixture(t, files) {
  const root = await mkdtemp(path.join(directory, '.fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifests = {
    'package.json': { private: true, type: 'module', workspaces: ['packages/backend', 'apps/api', 'apps/web'] },
    'packages/backend/package.json': { name: '@airframes/backend', type: 'module', exports: {
      './demo': './src/demo/public/index.ts',
      './correlation': './src/modules/aircraft-correlation/public/index.ts',
      './availability': './src/modules/message-availability/public/index.ts',
    } },
    'apps/api/package.json': { name: '@airframes/api', type: 'module', dependencies: { '@airframes/backend': '0.1.0' } },
    'apps/web/package.json': { name: '@airframes/web', type: 'module', dependencies: { react: '19.3.1' } },
  };
  for (const [file, contents] of Object.entries(manifests)) files[file] = JSON.stringify(contents);
  for (const [file, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), contents);
  }
  return checkProject(root);
}

const codes = result => result.diagnostics.map(issue => issue.code);

test('AST collects imports, re-exports, import types, import-equals and dynamic literals; ignores comments', () => {
  const result = parseDependencies('example.ts', `
    // import { fake } from './comment.ts';
    const text = "import('./text.ts')";
    import type { One } from './one.ts';
    export type { Two } from './two.ts';
    export * from './three.ts';
    type Four = import('./four.ts').Four;
    const five = import('./five.ts');
    import six = require('./six.ts');
    import './seven.ts';
  `);
  assert.deepEqual(result.dependencies.map(item => item.specifier),
    ['./one.ts', './two.ts', './three.ts', './four.ts', './five.ts', './six.ts', './seven.ts']);
  assert.deepEqual(result.diagnostics, []);
});

for (const [name, dependency] of [
  ['static import', "import { adapter } from '../infrastructure/adapter.ts';"],
  ['type-only import', "import type { Adapter } from '../infrastructure/adapter.ts';"],
  ['re-export', "export { adapter } from '../infrastructure/adapter.ts';"],
  ['dynamic literal import', "const adapter = import('../infrastructure/adapter.ts');"],
  ['import type expression', "type Adapter = import('../infrastructure/adapter.ts').Adapter;"],
  ['import-equals', "import adapter = require('../infrastructure/adapter.ts');"],
  ['require literal', "const adapter = require('../infrastructure/adapter.ts');"],
]) {
  test(`rejects domain → infrastructure through ${name}`, async t => {
    const result = await fixture(t, {
      [`${module}domain/rule.ts`]: dependency,
      [`${module}infrastructure/adapter.ts`]: 'export const adapter = 1; export type Adapter = number;',
    });
    assert.ok(codes(result).includes('DOMAIN_DEPENDENCY'), JSON.stringify(result.diagnostics));
  });
}

test('does not miss a domain → app dependency outside modules', async t => {
  const result = await fixture(t, {
    [`${module}domain/rule.ts`]: "import { wire } from '../../../app/wire.ts';",
    [`${backend}app/wire.ts`]: 'export const wire = 1;',
  });
  assert.ok(codes(result).includes('DOMAIN_DEPENDENCY'));
});

test('contracts cannot import a composition root', async t => {
  const result = await fixture(t, {
    [`${backend}contracts/value.ts`]: "export { wire } from '../app/wire.ts';",
    [`${backend}app/wire.ts`]: 'export const wire = 1;',
  });
  assert.ok(codes(result).includes('CONTRACT_DEPENDENCY'));
});

test('kernel cannot import domain contracts', async t => {
  const result = await fixture(t, {
    [`${backend}kernel/value.ts`]: "import type { Id } from '../contracts/id.ts';",
    [`${backend}contracts/id.ts`]: 'export type Id = string;',
  });
  assert.ok(codes(result).includes('KERNEL_DEPENDENCY'));
});

test('pure domain cannot import Node types', async t => {
  const result = await fixture(t, {
    [`${module}domain/rule.ts`]: "import type { Stats } from 'node:fs'; export type State = Stats;",
  });
  assert.ok(codes(result).includes('IMPURE_DEPENDENCY'));
});

test('pure contracts cannot import an installed external package', async t => {
  const result = await fixture(t, {
    [`${backend}contracts/value.ts`]: "import type { Node } from 'typescript'; export type Value = Node;",
  });
  assert.ok(codes(result).includes('IMPURE_DEPENDENCY'));
});

test('API may use Node builtins and own modules', async t => {
  const result = await fixture(t, {
    [`${api}route.ts`]: "import { createServer } from 'node:http'; import type { Config } from './config.ts';",
    [`${api}config.ts`]: 'export type Config = { port: number };',
  });
  assert.deepEqual(result.diagnostics, []);
});

test('web may compose its own UI but cannot import backend internals', async t => {
  const result = await fixture(t, {
    [`${web}app/App.ts`]: "import { Button } from '../shared/Button.ts'; import { facts } from '../../../../packages/backend/src/modules/sample/domain/facts.ts';",
    [`${web}shared/Button.ts`]: 'export const Button = 1;',
    [`${module}domain/facts.ts`]: 'export const facts = 1;',
  });
  assert.ok(codes(result).includes('CROSS_WORKSPACE_PATH'), JSON.stringify(result.diagnostics));
  assert.equal(result.diagnostics.filter(issue => issue.file === `${web}app/App.ts`).length, 1);
});

test('web cannot import Node builtins and backend cannot import web', async t => {
  const result = await fixture(t, {
    [`${web}app/App.ts`]: "import { readFile } from 'node:fs';",
    [`${module}application/use-case.ts`]: "import { Button } from '../../../../../../apps/web/src/shared/Button.ts';",
    [`${web}shared/Button.ts`]: 'export const Button = 1;',
  });
  assert.ok(codes(result).includes('WEB_BUILTIN'), JSON.stringify(result.diagnostics));
  assert.ok(result.diagnostics.some(issue => issue.file === `${module}application/use-case.ts`),
    JSON.stringify(result.diagnostics));
});

test('web may import a local stylesheet but missing styles fail the boundary check', async t => {
  const valid = await fixture(t, {
    [`${web}main.ts`]: "import './styles/base.css';",
    [`${web}styles/base.css`]: ':root { color: black; }',
  });
  assert.deepEqual(valid.diagnostics, []);
  const missing = await fixture(t, { [`${web}main.ts`]: "import './styles/missing.css';" });
  assert.ok(codes(missing).includes('MISSING_TARGET'));
});

test('a nonexistent Node builtin is a missing import target', async t => {
  const result = await fixture(t, {
    [`${api}route.ts`]: "import { missing } from 'node:not-a-real-module';",
  });
  assert.ok(codes(result).includes('MISSING_TARGET'));
});

test('application may import another module through public only', async t => {
  const result = await fixture(t, {
    [`${module}application/use-case.ts`]: "import { rule } from '../../other/public/index.ts';",
    [`${backend}modules/other/public/index.ts`]: "export { rule } from '../domain/rule.ts';",
    [`${backend}modules/other/domain/rule.ts`]: 'export const rule = () => 1;',
  });
  assert.deepEqual(result.diagnostics, []);
});

test('application cannot deep-import another module even through a dynamic literal', async t => {
  const result = await fixture(t, {
    [`${module}application/use-case.ts`]: "const rule = import('../../other/domain/rule.ts');",
    [`${backend}modules/other/domain/rule.ts`]: 'export const rule = () => 1;',
  });
  assert.ok(codes(result).includes('CROSS_MODULE_DEEP_IMPORT'));
});

test('composition consumes fleet identity only through its public entry', async t => {
  const result = await fixture(t, {
    [`${module}composition/wire.ts`]: "import { read } from '../../fleet-identity/infrastructure/read.ts';",
    [`${backend}modules/fleet-identity/infrastructure/read.ts`]: 'export const read = () => 1;',
  });
  assert.ok(codes(result).includes('CROSS_MODULE_DEEP_IMPORT'));
});

test('reports a missing target, including an import type expression', async t => {
  const result = await fixture(t, {
    [`${module}domain/rule.ts`]: "type Missing = import('./missing.ts').Value;",
  });
  assert.ok(codes(result).includes('MISSING_TARGET'));
});

test('detects source cycles including type-only dependencies', async t => {
  const result = await fixture(t, {
    [`${module}domain/one.ts`]: "import type { Two } from './two.ts'; export type One = { two: Two };",
    [`${module}domain/two.ts`]: "import type { One } from './one.ts'; export type Two = { one: One };",
  });
  assert.ok(codes(result).includes('CYCLE'));
});

test('rejects dynamic module expressions that cannot be resolved statically', async t => {
  const result = await fixture(t, {
    [`${api}route.ts`]: 'const moduleName = process.env.MODULE; const module = import(moduleName);',
  });
  assert.ok(codes(result).includes('NON_LITERAL_DEPENDENCY'));
});

test('API may import the exported demo factory; composition may wire adapters', async t => {
  const result = await fixture(t, {
    [`${api}route.ts`]: "import { factory } from '@airframes/backend/demo';",
    [`${backend}demo/public/index.ts`]: "export { factory } from '../composition/factory.ts';",
    [`${backend}demo/composition/factory.ts`]: "import { adapter } from '../infrastructure/adapter.ts'; export const factory = () => adapter;",
    [`${backend}demo/infrastructure/adapter.ts`]: 'export const adapter = 1;',
  });
  assert.deepEqual(result.diagnostics, []);
});

test('flight-tracking public entry may expose its private PostgreSQL composition', async t => {
  const result = await fixture(t, {
    [`${backend}modules/flight-tracking/public/index.ts`]: "export { create } from '../composition/wire.ts';",
    [`${backend}modules/flight-tracking/composition/wire.ts`]: "import { adapter } from '../infrastructure/adapter.ts'; export const create = () => adapter;",
    [`${backend}modules/flight-tracking/infrastructure/adapter.ts`]: 'export const adapter = 1;',
  });
  assert.deepEqual(result.diagnostics, []);
});

test('API cannot bypass package exports using a private package path', async t => {
  const result = await fixture(t, {
    [`${api}route.ts`]: "type Raw = import('@airframes/backend/src/demo/domain/value.ts').Value;",
    [`${backend}demo/domain/value.ts`]: 'export type Value = number;',
  });
  assert.ok(codes(result).includes('PRIVATE_PACKAGE_IMPORT'));
});

test('API cannot bypass package exports with a relative source path', async t => {
  const result = await fixture(t, {
    [`${api}route.ts`]: "import type { Value } from '../../../packages/backend/src/demo/public/index.ts';",
    [`${backend}demo/public/index.ts`]: 'export type Value = number;',
  });
  assert.ok(codes(result).includes('CROSS_WORKSPACE_PATH'));
});

test('application may use a pure local public DTO but not its own composition entry', async t => {
  const result = await fixture(t, {
    [`${backend}demo/application/query.ts`]: "import type { View } from '../public/types.ts'; export const query = (): View => ({ id: '1' });",
    [`${backend}demo/public/types.ts`]: 'export type View = { id: string };',
  });
  assert.deepEqual(result.diagnostics, []);
});

test('application cannot import its own public composition entry', async t => {
  const result = await fixture(t, {
    [`${backend}demo/application/query.ts`]: "import { value } from '../public/index.ts';",
    [`${backend}demo/public/index.ts`]: 'export const value = 1;',
  });
  assert.ok(codes(result).includes('OUTWARD_DEPENDENCY'));
});

test('a triple-slash Node type reference cannot hide a kernel dependency', async t => {
  const result = await fixture(t, {
    [`${backend}kernel/value.ts`]: '/// <reference types="node" />\nexport type Value = string;',
  });
  assert.ok(codes(result).includes('IMPURE_DEPENDENCY'));
});

test('core cannot depend on demo orchestration through a public export', async t => {
  const result = await fixture(t, {
    [`${module}application/use-case.ts`]: "import type { Demo } from '../../../demo/public/index.ts';",
    [`${backend}demo/public/index.ts`]: 'export type Demo = string;',
  });
  assert.ok(codes(result).includes('CORE_TO_DEMO'));
});

test('syntax errors fail the checker instead of concealing dependency edges', async t => {
  const result = await fixture(t, {
    [`${api}broken.ts`]: 'import { value from "./other.ts";',
  });
  assert.ok(codes(result).includes('PARSE_ERROR'));
});
