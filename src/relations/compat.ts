/**
 * Cross-version type compatibility for drizzle-orm 0.x and 1.0.
 *
 * The `Table` types from each version are structurally incompatible
 * (1.0 added `dialect` to `Table._`). This module provides union
 * types and widened function wrappers so code that accepts tables or
 * columns from either version stays clean without per-call-site casts.
 */
import type {SQL} from 'drizzle-orm';
import type {Table as V1Table} from 'drizzle-orm-v0';
import type {Table as V2Table} from 'drizzle-orm';
import {
  getTableColumns as _getTableColumns,
  getTableName as _getTableName,
  getTableUniqueName as _getTableUniqueName,
} from 'drizzle-orm';

export type AnyTable = V1Table | V2Table;

/**
 * The intersection of column properties that drizzle-zero reads,
 * compatible with both 0.x and 1.0 Column types.
 */
export interface AnyColumn {
  readonly name: string;
  readonly keyAsName: boolean;
  readonly primary: boolean;
  readonly notNull: boolean;
  readonly hasDefault: boolean;
  readonly default: unknown | SQL | undefined;
  readonly defaultFn: (() => unknown | SQL) | undefined;
  readonly columnType: string;
  readonly dataType: string;
  readonly enumValues: readonly [string, ...string[]] | undefined;
  readonly table: AnyTable;
  getSQLType(): string;
}

/**
 * Widened versions of drizzle-orm utility functions that accept AnyTable.
 * The runtime functions work identically on both 0.x and 1.0 Table
 * instances — only the TypeScript signatures are incompatible.
 */
export const getTableColumns = _getTableColumns as (
  table: AnyTable,
) => Record<string, AnyColumn>;

export const getTableName = _getTableName as (table: AnyTable) => string;

export const getTableUniqueName = _getTableUniqueName as (
  table: AnyTable,
) => string;
