import {is, Table} from 'drizzle-orm';
import {getDrizzleColumnKeyFromColumnName} from '../tables';
import {type AnyTable, getTableName, getTableUniqueName} from './compat';
import {typedEntries} from '../util';

/**
 * A single resolved relationship edge (one hop in a relation chain).
 */
export interface ResolvedRelationEdge {
  sourceField: string[];
  destField: string[];
  destSchema: string;
  cardinality: 'one' | 'many';
}

/**
 * Extracted relationships keyed by source table name, then by relation field name.
 * Each relation is an array of edges (one for direct, two for many-to-many).
 */
export type ExtractedRelationships = Record<
  string,
  Record<string, ResolvedRelationEdge[]>
>;

/**
 * Parsed manyToMany entry — either a simple string tuple or explicit field objects.
 */
export type ManyToManyEntry =
  | readonly [string, string]
  | readonly [
      {destTable: string; sourceField: string[]; destField: string[]},
      {destTable: string; sourceField: string[]; destField: string[]},
    ];

/**
 * The contract that V1 and V2 relation extractors implement.
 *
 * Given the full Drizzle schema and config context, scan for relation
 * definitions (including manyToMany) and return the resolved relationship map.
 */
export interface RelationExtractor {
  /**
   * Extract all relationships from the schema, including manyToMany.
   */
  extract(ctx: ExtractionContext): ExtractedRelationships;
}

export type GetDrizzleKeyFromTable = (args: {
  schema: Record<string, unknown>;
  table?: AnyTable;
  fallbackTableName?: string;
}) => string;

export interface ExtractionContext {
  schema: Record<string, unknown>;
  debug?: boolean | undefined;
  /** Which tables are included in the config (for skipping). undefined = all. */
  includedTables?: Record<string, unknown> | undefined;
  /** manyToMany config keyed by source table name → relation name → entry. */
  manyToMany?: Record<string, Record<string, ManyToManyEntry>> | undefined;
  getDrizzleKeyFromTable: GetDrizzleKeyFromTable;
}

/**
 * Resolve a Drizzle Table instance (or fallback name) to its key in the schema object.
 */
export const getDrizzleKeyFromTableFn: GetDrizzleKeyFromTable = ({
  schema,
  table,
  fallbackTableName,
}) => {
  if (table) {
    const directMatch = typedEntries(schema).find(
      ([_name, v]) => is(v, Table) && v === table,
    )?.[0];

    if (directMatch) {
      return directMatch;
    }

    const uniqueName = getTableUniqueName(table);
    const uniqueMatch = typedEntries(schema).find(
      ([_name, v]) =>
        is(v, Table) && getTableUniqueName(v as AnyTable) === uniqueName,
    )?.[0];

    if (uniqueMatch) {
      return uniqueMatch;
    }
  }

  if (fallbackTableName) {
    const fallbackMatch = typedEntries(schema).find(
      ([_name, v]) =>
        is(v, Table) && getTableName(v as AnyTable) === fallbackTableName,
    )?.[0];

    if (fallbackMatch) {
      return fallbackMatch;
    }
  }

  throw new Error(
    `drizzle-zero: Unable to resolve table key for ${table ? getTableUniqueName(table) : fallbackTableName}`,
  );
};

export {getDrizzleColumnKeyFromColumnName};
