/** Recursively visit Babel (estree-like) nodes without @babel/traverse. */

const SKIP = new Set([
  'loc',
  'start',
  'end',
  'range',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'comments',
  'tokens',
  'extra',
]);

/**
 * @param {object} root
 * @param {Record<string, function>} visitors
 */
export function walkAst(root, visitors) {
  function visit(node, parent) {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        visit(child, parent);
      }
      return;
    }
    const type = node.type;
    if (typeof type !== 'string') {
      return;
    }
    visitors[type]?.(node, parent);
    for (const key of Object.keys(node)) {
      if (SKIP.has(key)) {
        continue;
      }
      const val = node[key];
      if (val && typeof val === 'object') {
        visit(val, node);
      }
    }
  }
  visit(root, null);
}

/**
 * Approximate Babel `path.isReferencedIdentifier()`.
 *
 * @param {object} node
 * @param {object|null} parent
 */
export function isReferencedIdentifier(node, parent) {
  if (!parent) {
    return true;
  }
  if (
    (parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') &&
    parent.property === node &&
    !parent.computed
  ) {
    return false;
  }
  if (
    (parent.type === 'ObjectProperty' ||
      parent.type === 'ObjectMethod' ||
      parent.type === 'ClassMethod' ||
      parent.type === 'ClassProperty' ||
      parent.type === 'Property') &&
    parent.key === node &&
    !parent.computed &&
    !parent.shorthand
  ) {
    return false;
  }
  if (parent.type === 'VariableDeclarator' && parent.id === node) {
    return false;
  }
  if (
    (parent.type === 'FunctionDeclaration' ||
      parent.type === 'FunctionExpression' ||
      parent.type === 'ClassDeclaration' ||
      parent.type === 'ClassExpression') &&
    parent.id === node
  ) {
    return false;
  }
  if (
    parent.type === 'ImportSpecifier' ||
    parent.type === 'ImportDefaultSpecifier' ||
    parent.type === 'ImportNamespaceSpecifier' ||
    parent.type === 'ExportSpecifier'
  ) {
    return false;
  }
  if (parent.type === 'CatchClause' && parent.param === node) {
    return false;
  }
  if (parent.type === 'MetaProperty') {
    return false;
  }
  return true;
}
