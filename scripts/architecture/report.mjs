export function formatReport(result) {
  if (!result.diagnostics.length) {
    return `OK: ${result.fileCount} source files; ${result.dependencyCount} AST dependencies; exports, layer boundaries and cycles checked.`;
  }
  return result.diagnostics.map(issue =>
    `${issue.file}:${issue.line}:${issue.column} [${issue.code}] ${issue.message}`).join('\n');
}
