import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const sourceExtension = /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/;
const slash = value => value.split(path.sep).join('/');

async function sourceFiles(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(file));
    else if (entry.isFile() && sourceExtension.test(file)) files.push(file);
    else if (entry.isSymbolicLink()) throw new Error(`Source symlinks are unsupported: ${file}`);
  }
  return files;
}

export async function loadProject(root) {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const entries = Array.isArray(manifest.workspaces) ? manifest.workspaces : manifest.workspaces?.packages;
  if (!Array.isArray(entries)) throw new Error('Expected explicit workspace paths in root package.json.');
  const workspaces = [];
  for (const relative of entries) {
    if (typeof relative !== 'string' || /[*?{}]/.test(relative)) {
      throw new Error('Architecture configuration accepts explicit workspace paths; expand glob entries first.');
    }
    const directory = path.resolve(root, relative);
    const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    workspaces.push({ name: pkg.name, directory, relative: slash(path.relative(root, directory)),
      manifest: pkg, files: await sourceFiles(path.join(directory, 'src')) });
  }
  const files = workspaces.flatMap(workspace => workspace.files).sort();
  const owner = new Map(workspaces.flatMap(workspace => workspace.files.map(file => [file, workspace])));
  return { root, workspaces, files, known: new Set(files), owner,
    relative: file => slash(path.relative(root, file)) };
}

export function classifyFile(project, file) {
  const workspace = project.owner.get(file);
  if (!workspace) return { zone: 'outside', workspace: null, unit: null, layer: null };
  const relative = slash(path.relative(path.join(workspace.directory, 'src'), file));
  if (workspace.name === '@airframes/api') return { zone: 'api', workspace, relative, unit: 'api', layer: 'api' };
  if (workspace.name === '@airframes/web') return { zone: 'web', workspace, relative,
    unit: relative.split('/')[0], layer: 'web' };
  if (workspace.name !== '@airframes/backend') return { zone: 'unknown', workspace, relative, unit: null, layer: null };
  if (relative.startsWith('kernel/')) return { zone: 'kernel', workspace, relative, unit: 'kernel', layer: 'kernel' };
  if (relative.startsWith('contracts/')) return { zone: 'contracts', workspace, relative, unit: 'contracts', layer: 'contracts' };
  if (relative.startsWith('app/')) return { zone: 'backend', workspace, relative, unit: 'app', layer: 'composition' };
  const core = relative.match(/^modules\/([^/]+)\/([^/]+)\//);
  if (core) return { zone: 'backend', workspace, relative, unit: `module:${core[1]}`, layer: core[2] };
  const demo = relative.match(/^demo\/([^/]+)\//);
  if (demo) return { zone: 'backend', workspace, relative, unit: 'demo', layer: demo[1] };
  return { zone: 'unknown', workspace, relative, unit: null, layer: null };
}
