import {getTableName, getTableUniqueName, is, Table} from 'drizzle-orm';
import {getDrizzleColumnKeyFromColumnName} from '../tables';
import type {AnyTable} from './compat';
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
 * The contract that V1 and V2 relation extractors implement.
 *
 * Given the full Drizzle schema object and debug flag, scan for relation
 * definitions and return the resolved relationship map.
 *
 * `getDrizzleKeyFromTable` is provided so extractors can resolve table
 * instances back to their schema key names.
 */
export interface RelationExtractor {
  /**
   * Returns true if this extractor can handle the given schema.
   * Checked entry-by-entry: at least one entry must match.
   */
  detect(schema: Record<string, unknown>): boolean;

  /**
   * Extract relationships from the schema.
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
  debug?: boolean;
  /** Which tables are included in the config (for skipping). undefined = all. */
  includedTables?: Record<string, unknown>;
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
  // Cast to the 1.0 Table type for getTableUniqueName/getTableName calls.
  // At runtime both 0.x and 1.0 Table instances are duck-type compatible.
  const t = table as Table | undefined;

  if (t) {
    const directMatch = typedEntries(schema).find(
      ([_name, v]) => is(v, Table) && v === t,
    )?.[0];

    if (directMatch) {
      return directMatch;
    }

    const uniqueName = getTableUniqueName(t);
    const uniqueMatch = typedEntries(schema).find(
      ([_name, v]) => is(v, Table) && getTableUniqueName(v) === uniqueName,
    )?.[0];

    if (uniqueMatch) {
      return uniqueMatch;
    }
  }

  if (fallbackTableName) {
    const fallbackMatch = typedEntries(schema).find(
      ([_name, v]) => is(v, Table) && getTableName(v) === fallbackTableName,
    )?.[0];

    if (fallbackMatch) {
      return fallbackMatch;
    }
  }

  throw new Error(
    `drizzle-zero: Unable to resolve table key for ${t ? getTableUniqueName(t) : fallbackTableName}`,
  );
};

export {getDrizzleColumnKeyFromColumnName};
