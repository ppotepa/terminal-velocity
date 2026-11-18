import ts from 'typescript';

/** Enumerate dependencies structurally, including erased TypeScript imports. */
export function parseDependencies(fileName, text) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const dependencies = [];
  const diagnostics = [];
  const location = node => {
    const at = source.getLineAndCharacterOfPosition(node.getStart(source));
    return { line: at.line + 1, column: at.character + 1 };
  };
  function add(node, argument, kind) {
    if (argument && ts.isStringLiteralLike(argument)) {
      dependencies.push({ specifier: argument.text, kind, ...location(node) });
    } else {
      diagnostics.push({ code: 'NON_LITERAL_DEPENDENCY', ...location(node),
        message: `${kind} must use a literal module specifier so its boundary can be checked.` });
    }
  }
  function visit(node) {
    if (ts.isImportDeclaration(node)) add(node, node.moduleSpecifier, 'import');
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier) add(node, node.moduleSpecifier, 'export');
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node, node.moduleReference.expression, 'import-equals');
    } else if (ts.isImportTypeNode(node)) {
      add(node, ts.isLiteralTypeNode(node.argument) ? node.argument.literal : null, 'import-type');
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node, node.arguments[0], 'dynamic-import');
      else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        add(node, node.arguments[0], 'require');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const issue of source.parseDiagnostics) {
    const at = source.getLineAndCharacterOfPosition(issue.start ?? 0);
    diagnostics.push({ code: 'PARSE_ERROR', line: at.line + 1, column: at.character + 1,
      message: ts.flattenDiagnosticMessageText(issue.messageText, '\n') });
  }
  // Triple-slash references also create dependencies, even though no import remains at runtime.
  for (const reference of source.referencedFiles) {
    dependencies.push({ specifier: reference.fileName.startsWith('.') ? reference.fileName : `./${reference.fileName}`,
      kind: 'reference-path', line: source.getLineAndCharacterOfPosition(reference.pos).line + 1, column: 1 });
  }
  for (const reference of source.typeReferenceDirectives) {
    dependencies.push({ specifier: reference.fileName === 'node' ? 'node:types' : `@types/${reference.fileName}`,
      kind: 'reference-types', line: source.getLineAndCharacterOfPosition(reference.pos).line + 1, column: 1 });
  }
  return { dependencies, diagnostics };
}
