import type {
  ImportDeclarationStructure,
  Project,
  TypeAliasDeclaration,
} from 'ts-morph';
import {StructureKind, ts} from 'ts-morph';

export interface CustomTypeRequest {
  tableName: string;
  columnName: string;
}

export interface ResolveCustomTypesOptions {
  project: Project;
  helperName: 'CustomType' | 'ZeroCustomType';
  schemaTypeExpression: string;
  schemaImports: ResolverImport[];
  requests: Iterable<CustomTypeRequest>;
}

export type ResolvedCustomTypeMap = Map<string, string>;

export const COLUMN_SEPARATOR = '::|::';

const RESOLVER_FILE_NAME = '__drizzle_zero_type_resolver.ts';

type ResolverImport = Omit<ImportDeclarationStructure, 'kind'>;

const typeFormatFlags =
  ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.WriteArrowStyleSignature;

export function resolveCustomTypes({
  project,
  helperName,
  schemaTypeExpression,
  schemaImports,
  requests,
}: ResolveCustomTypesOptions): ResolvedCustomTypeMap {
  const uniqueRequests = new Map<string, CustomTypeRequest>();
  for (const request of requests) {
    const key = `${request.tableName}${COLUMN_SEPARATOR}${request.columnName}`;
    if (!uniqueRequests.has(key)) {
      uniqueRequests.set(key, request);
    }
  }

  if (uniqueRequests.size === 0) {
    return new Map();
  }

  const resolverFile = project.createSourceFile(RESOLVER_FILE_NAME, '', {
    overwrite: true,
  });

  resolverFile.addImportDeclarations(
    schemaImports.map((structure): ImportDeclarationStructure => ({
      kind: StructureKind.ImportDeclaration,
      ...structure,
    })),
  );

  resolverFile.addImportDeclaration({
    moduleSpecifier: 'drizzle-zero',
    namedImports: [{name: helperName}],
    isTypeOnly: true,
  });

  const aliasByRequest = new Map<string, TypeAliasDeclaration>();

  for (const [key, request] of uniqueRequests) {
    const aliasName = `__DZ_CT_${aliasByRequest.size}`;
    const typeExpression = `${helperName}<${schemaTypeExpression}, "${request.tableName}", "${request.columnName}">`;
    aliasByRequest.set(
      key,
      resolverFile.addTypeAlias({
        name: aliasName,
        type: typeExpression,
        isExported: false,
      }),
    );
  }

  const resolved = new Map<string, string>();

  for (const [key, alias] of aliasByRequest.entries()) {
    const type = alias.getType();
    const text = type.getText(alias, typeFormatFlags);

    if (isSafeResolvedType(text)) {
      resolved.set(key, canonicalizeTypeText(text));
    }
  }

  resolverFile.delete();

  return resolved;
}

const allowedTypeIdentifiers = new Set<string>([
  'boolean',
  'number',
  'string',
  'true',
  'false',
  'null',
  'undefined',
]);

export const isSafeResolvedType = (typeText: string | undefined): boolean => {
  if (!typeText) {
    return false;
  }

  if (typeText === 'ReadonlyJSONValue') {
    return true;
  }

  if (
    typeText === 'unknown' ||
    typeText === 'any' ||
    typeText.includes('__error__') ||
    typeText.includes('() ') ||
    typeText === 'SchemaIsAnyError' ||
    typeText.includes('CustomType') ||
    typeText.includes('ZeroCustomType') ||
    typeText.includes('import(') ||
    typeText.includes('=>')
  ) {
    return false;
  }

  const getPrevNonWhitespace = (index: number) => {
    for (let i = index - 1; i >= 0; i--) {
      const char = typeText[i] ?? '';
      if (char.trim()) {
        return char;
      }
    }

    return '';
  };

  const getNextNonWhitespace = (index: number) => {
    for (let i = index; i < typeText.length; i++) {
      const char = typeText[i] ?? '';
      if (char.trim()) {
        return char;
      }
    }

    return '';
  };

  const identifierRegex = /\b[A-Za-z_]\w*\b/g;
  const matches = typeText.matchAll(identifierRegex);

  for (const match of matches) {
    const identifier = match[0] ?? '';
    const startIndex = match.index ?? 0;
    const endIndex = startIndex + identifier.length;
    const prevChar = getPrevNonWhitespace(startIndex);
    const nextChar = getNextNonWhitespace(endIndex);

    if (prevChar === "'" || prevChar === '"' || prevChar === '`') {
      continue;
    }

    if (/^_+$/.test(identifier) && prevChar === '}') {
      continue;
    }

    if (nextChar === ':') {
      continue;
    }

    if (nextChar === '?' && getNextNonWhitespace(endIndex + 1) === ':') {
      continue;
    }

    const normalized = identifier.toLowerCase();

    if (identifier === normalized && allowedTypeIdentifiers.has(normalized)) {
      continue;
    }

    return false;
  }

  return true;
};

/**
 * Reorders the parts of a printed type that TypeScript orders by internal
 * type id.
 *
 * TypeScript interns literal types globally and keeps union and intersection
 * members sorted by the id each type was assigned when the checker first
 * created it. The printed order therefore encodes the order the whole program
 * was checked in, not anything about the type: moving an entry in an
 * unrelated lookup table shifts a member in every union that mentions it, and
 * the ids differ between TypeScript versions.
 *
 * Sorting the members ourselves makes the printed form depend only on the set
 * of members. Anything this does not recognise is left exactly as printed.
 */
export function canonicalizeTypeText(typeText: string): string {
  try {
    const file = ts.createSourceFile(
      '__drizzle_zero_canonical_type.ts',
      `type __T = ${typeText};`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    const parseDiagnostics = (
      file as unknown as {parseDiagnostics?: readonly unknown[]}
    ).parseDiagnostics;

    if (parseDiagnostics && parseDiagnostics.length > 0) {
      return typeText;
    }

    const [statement] = file.statements;

    if (!statement || !ts.isTypeAliasDeclaration(statement)) {
      return typeText;
    }

    return printCanonicalType(statement.type, file);
  } catch {
    return typeText;
  }
}

const compareTypeText = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

const printCanonicalType = (node: ts.TypeNode, file: ts.SourceFile): string => {
  // Unions and intersections are both commutative, and both are what
  // TypeScript orders by type id.
  if (ts.isUnionTypeNode(node)) {
    return node.types
      .map(member => printCanonicalType(member, file))
      .sort(compareTypeText)
      .join(' | ');
  }

  if (ts.isIntersectionTypeNode(node)) {
    return node.types
      .map(member => printCanonicalType(member, file))
      .sort(compareTypeText)
      .join(' & ');
  }

  if (ts.isParenthesizedTypeNode(node)) {
    return `(${printCanonicalType(node.type, file)})`;
  }

  if (ts.isArrayTypeNode(node)) {
    return `${printCanonicalType(node.elementType, file)}[]`;
  }

  // Tuple elements are positional, so only their own types are rewritten.
  if (ts.isTupleTypeNode(node)) {
    return `[${node.elements
      .map(element => printCanonicalType(element, file))
      .join(', ')}]`;
  }

  if (ts.isOptionalTypeNode(node)) {
    return `${printCanonicalType(node.type, file)}?`;
  }

  if (ts.isRestTypeNode(node)) {
    return `...${printCanonicalType(node.type, file)}`;
  }

  if (ts.isNamedTupleMember(node)) {
    const optional = node.questionToken ? '?' : '';
    return `${node.dotDotDotToken ? '...' : ''}${node.name.text}${optional}: ${printCanonicalType(node.type, file)}`;
  }

  if (ts.isTypeLiteralNode(node)) {
    const members = node.members
      .map(member => printCanonicalMember(member, file))
      .sort(compareTypeText);

    return members.length === 0 ? '{}' : `{${members.join('; ')}}`;
  }

  return node.getText(file);
};

const printCanonicalMember = (
  member: ts.TypeElement,
  file: ts.SourceFile,
): string => {
  if (
    (ts.isPropertySignature(member) ||
      ts.isIndexSignatureDeclaration(member)) &&
    member.type
  ) {
    const modifiers = ts.isPropertySignature(member)
      ? member.modifiers?.map(modifier => `${modifier.getText(file)} `).join('')
      : undefined;
    const name = ts.isPropertySignature(member)
      ? member.name.getText(file)
      : `[${member.parameters.map(parameter => parameter.getText(file)).join(', ')}]`;
    const optional =
      ts.isPropertySignature(member) && member.questionToken ? '?' : '';

    return `${modifiers ?? ''}${name}${optional}: ${printCanonicalType(member.type, file)}`;
  }

  return member.getText(file);
};
