import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadProject } from './project.mjs';
import { parseDependencies } from './parse.mjs';
import { resolveDependency } from './resolve.mjs';
import { checkDependencyPolicy } from './policy.mjs';

export async function checkProject(root) {
  const project = await loadProject(path.resolve(root));
  const diagnostics = [];
  const graph = new Map(project.files.map(file => [file, []]));
  let dependencyCount = 0;
  for (const file of project.files) {
    const parsed = parseDependencies(file, await readFile(file, 'utf8'));
    const source = project.relative(file);
    diagnostics.push(...parsed.diagnostics.map(issue => ({ file: source, ...issue })));
    for (const dependency of parsed.dependencies) {
      dependencyCount += 1;
      const resolution = resolveDependency(project, file, dependency);
      const issue = resolution.kind === 'error' ? resolution : checkDependencyPolicy(project, file, resolution);
      if (issue) diagnostics.push({ file: source, line: dependency.line, column: dependency.column,
        code: issue.code, message: `${issue.message} [${dependency.kind}: ${dependency.specifier}]` });
      if (resolution.kind === 'source') graph.get(file).push(resolution.file);
    }
  }
  const visited = new Set();
  const active = new Set();
  function visit(file, trail = []) {
    if (active.has(file)) {
      const cycle = [...trail.slice(trail.indexOf(file)), file];
      diagnostics.push({ file: project.relative(file), line: 1, column: 1, code: 'CYCLE',
        message: cycle.map(project.relative).join(' → ') });
      return;
    }
    if (visited.has(file)) return;
    active.add(file);
    for (const target of graph.get(file) ?? []) visit(target, [...trail, file]);
    active.delete(file);
    visited.add(file);
  }
  for (const file of project.files) visit(file);
  diagnostics.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.code.localeCompare(b.code));
  return { fileCount: project.files.length, dependencyCount, diagnostics };
}
