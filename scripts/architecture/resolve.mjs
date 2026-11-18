import path from 'node:path';
import { isBuiltin } from 'node:module';
import ts from 'typescript';

const compilerOptions = {
  module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ESNext, allowImportingTsExtensions: true, allowJs: true,
};

function resolveFile(specifier, from) {
  return ts.resolveModuleName(specifier, from, compilerOptions, ts.sys).resolvedModule?.resolvedFileName;
}

function exportTarget(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  for (const condition of ['types', 'import', 'node', 'default']) {
    const target = exportTarget(value[condition]);
    if (target) return target;
  }
  return null;
}

export function resolveDependency(project, from, dependency) {
  const specifier = dependency.specifier;
  if (specifier === 'node:types' && dependency.kind === 'reference-types') {
    return { kind: 'external', packageName: specifier, builtin: true };
  }
  if (specifier.startsWith('node:') && !isBuiltin(specifier)) {
    return { kind: 'error', code: 'MISSING_TARGET', message: `Unknown Node builtin ${specifier}.` };
  }
  if (isBuiltin(specifier)) return { kind: 'external', packageName: specifier, builtin: true };
  const workspace = project.workspaces.find(item =>
    specifier === item.name || specifier.startsWith(`${item.name}/`));
  if (workspace) {
    const key = specifier === workspace.name ? '.' : `.${specifier.slice(workspace.name.length)}`;
    const exports = workspace.manifest.exports;
    const target = exportTarget(key === '.' && typeof exports === 'string' ? exports : exports?.[key]);
    if (!target || !target.startsWith('./')) {
      return { kind: 'error', code: 'PRIVATE_PACKAGE_IMPORT', message: `${specifier} is not a declared package export.` };
    }
    const file = resolveFile(path.resolve(workspace.directory, target), from);
    if (!file || !project.known.has(path.resolve(file))) {
      return { kind: 'error', code: 'MISSING_TARGET', message: `Export ${specifier} has no scanned source target (${target}).` };
    }
    return { kind: 'source', file: path.resolve(file), workspaceExport: true, targetWorkspace: workspace };
  }
  const file = resolveFile(specifier, from);
  if (!file) return { kind: 'error', code: 'MISSING_TARGET', message: `Cannot resolve ${specifier}.` };
  const resolved = path.resolve(file);
  if (project.known.has(resolved)) return { kind: 'source', file: resolved, workspaceExport: false };
  if (specifier.startsWith('.') || path.isAbsolute(specifier) || !resolved.includes(`${path.sep}node_modules${path.sep}`)) {
    return { kind: 'error', code: 'OUTSIDE_SOURCE_IMPORT', message: `${specifier} resolves outside the checked workspace source.` };
  }
  const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
  return { kind: 'external', packageName, builtin: false };
}
