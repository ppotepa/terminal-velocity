import { classifyFile } from './project.mjs';

const coreLayers = new Set(['domain', 'application', 'ports', 'public', 'infrastructure', 'composition']);
const pureLayers = new Set(['domain', 'application', 'ports', 'public']);
const isPublicEntry = info => info.layer === 'public' && info.relative.endsWith('/public/index.ts');
const isPublicContract = info => info.layer === 'public' && !isPublicEntry(info);
const failure = (code, message) => ({ code, message });

/** Rules are intentionally explicit: no dependency is legalized by a matching folder name alone. */
export function checkDependencyPolicy(project, fromFile, resolution) {
  const from = classifyFile(project, fromFile);
  if (from.zone === 'unknown') return failure('UNKNOWN_SOURCE_AREA', `Source area ${from.relative} has no architecture policy.`);
  if (from.zone === 'backend' && !coreLayers.has(from.layer)) {
    return failure('UNKNOWN_LAYER', `Backend layer ${from.layer} has no architecture policy.`);
  }
  if (resolution.kind === 'external') {
    if (from.zone === 'kernel' || from.zone === 'contracts' || pureLayers.has(from.layer)) {
      return failure('IMPURE_DEPENDENCY', `${from.zone}/${from.layer} cannot depend on ${resolution.packageName}, including type-only imports.`);
    }
    if (!resolution.builtin) {
      const pkg = from.workspace.manifest;
      const declared = { ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies };
      if (!(resolution.packageName in declared)) {
        return failure('UNDECLARED_PACKAGE', `${resolution.packageName} is not a runtime dependency of ${from.workspace.name}.`);
      }
    }
    return null;
  }
  const to = classifyFile(project, resolution.file);
  if (from.workspace !== to.workspace) {
    if (!resolution.workspaceExport) return failure('CROSS_WORKSPACE_PATH', 'Use a declared package export instead of a relative cross-workspace import.');
    if (from.zone !== 'api' || to.workspace?.name !== '@airframes/backend' || !isPublicEntry(to)) {
      return failure('CROSS_WORKSPACE_DIRECTION', 'Only API → declared backend public entry is allowed across workspaces.');
    }
    if (!(to.workspace.name in (from.workspace.manifest.dependencies ?? {}))) {
      return failure('UNDECLARED_PACKAGE', `${to.workspace.name} is not a dependency of ${from.workspace.name}.`);
    }
    return null;
  }
  if (from.zone === 'api') return null;
  if (from.zone === 'kernel') return to.zone === 'kernel' ? null
    : failure('KERNEL_DEPENDENCY', 'Kernel may depend only on kernel.');
  if (from.zone === 'contracts') return ['kernel', 'contracts'].includes(to.zone) ? null
    : failure('CONTRACT_DEPENDENCY', 'Contracts may depend only on contracts and kernel.');
  if (to.unit === 'module:fleet-identity' && from.unit !== to.unit && !isPublicEntry(to)) {
    return failure('CROSS_MODULE_DEEP_IMPORT', 'Fleet identity consumers must use public/index.ts.');
  }
  if (from.layer === 'composition') return to.zone !== 'unknown' ? null
    : failure('UNKNOWN_SOURCE_AREA', `Composition targets unclassified source ${to.relative}.`);
  if (['kernel', 'contracts'].includes(to.zone)) return null;
  if (to.zone !== 'backend') return failure('OUTWARD_DEPENDENCY', `Backend ${from.layer} cannot depend on ${to.zone}.`);
  if (from.layer === 'domain') return from.unit === to.unit && to.layer === 'domain' ? null
    : failure('DOMAIN_DEPENDENCY', 'Domain may depend only on its own domain, contracts and kernel.');
  if (from.unit !== to.unit) {
    if (from.unit.startsWith('module:') && to.unit === 'demo') {
      return failure('CORE_TO_DEMO', 'Core modules must not depend on demo orchestration.');
    }
    return isPublicEntry(to) ? null
      : failure('CROSS_MODULE_DEEP_IMPORT', 'Cross-module imports must use public/index.ts; only composition may wire an adapter.');
  }
  if (['application', 'ports'].includes(from.layer)) {
    return ['domain', 'application', 'ports'].includes(to.layer) || isPublicContract(to) ? null
      : failure('OUTWARD_DEPENDENCY', `${from.layer} cannot import ${to.layer}; depend on a port or a pure contract.`);
  }
  if (from.layer === 'public') {
    if (to.layer === 'infrastructure') return failure('PUBLIC_ADAPTER_EXPORT', 'Public entry must not expose an infrastructure adapter.');
    if (to.layer === 'composition' && !((from.unit === 'demo' || from.unit === 'module:fleet-identity'
      || from.unit === 'module:flight-tracking') && isPublicEntry(from))) {
      return failure('PUBLIC_COMPOSITION_EXPORT', 'Only approved public entries may export composition factories.');
    }
    return null;
  }
  if (from.layer === 'infrastructure' && to.layer === 'composition') {
    return failure('OUTWARD_DEPENDENCY', 'An adapter must not depend on its composition root.');
  }
  return null;
}
