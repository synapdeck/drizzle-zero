import {createSchema} from '@rocicorp/zero';
import {is, Table} from 'drizzle-orm';
import type {
  DrizzleColumnTypeToZeroType,
  DrizzleDataTypeToZeroType,
  MapDrizzle1DataTypeToZero,
  ZeroTypeToTypescriptType,
} from '../drizzle-to-zero';
import {
  createZeroTableBuilder,
  type ZeroTableBuilderSchema,
  type ZeroTableCasing,
} from '../tables';
import type {
  ColumnIndexKeys,
  DefaultTableColumnsConfig,
  FindTableByName,
  Flatten,
  TableColumnsConfig,
} from '../types';
import {debugLog, typedEntries} from '../util';
import type {
  ExtractedRelationships,
  ManyToManyEntry,
  RelationExtractor,
} from './shared';
import {getDrizzleKeyFromTableFn} from './shared';
import {v1Extractor} from './v1';
import {v2Extractor} from './v2';

// ---------------------------------------------------------------------------
// Type utilities (unchanged from original relations.ts)
// ---------------------------------------------------------------------------

type IsAny<T> = 0 extends 1 & T ? true : false;

type SchemaIsAnyError = {
  __error__: 'The schema passed in to `ZeroCustomType` is `any`. Please make sure to pass in a proper schema type, or check your imports to make sure that Typescript can resolve your schema definition.';
};

/**
 * Maps a column definition to its Zero type (string, number, boolean, json).
 */
type DirectZeroType<CD> = CD extends {
  columnType: keyof DrizzleColumnTypeToZeroType;
}
  ? DrizzleColumnTypeToZeroType[CD['columnType']]
  : CD extends {dataType: keyof DrizzleDataTypeToZeroType}
    ? DrizzleDataTypeToZeroType[CD['dataType']]
    : CD extends {dataType: infer DT extends string}
      ? MapDrizzle1DataTypeToZero<DT>
      : never;

/**
 * Maps column types to their default TypeScript types when no custom type is specified.
 */
type DefaultColumnType<CD> =
  DirectZeroType<CD> extends keyof ZeroTypeToTypescriptType
    ? ZeroTypeToTypescriptType[DirectZeroType<CD>]
    : unknown;

/**
 * Direct extraction of the custom type from Drizzle schema. This falls back
 * to the default TypeScript type if no custom type is specified.
 */
type CustomType<
  DrizzleSchema,
  TableKey extends string,
  ColumnKey extends string,
> = TableKey extends keyof DrizzleSchema
  ? DrizzleSchema[TableKey] extends Table
    ? ColumnKey extends keyof DrizzleSchema[TableKey]
      ? DrizzleSchema[TableKey][ColumnKey] extends {_: infer CD}
        ? CD extends {columnType: 'PgCustomColumn'; data: infer TData}
          ? TData
          : CD extends {columnType: 'PgEnumColumn'; data: infer TData}
            ? TData
            : CD extends {columnType: 'PgText'; data: infer TData}
              ? TData extends string
                ? TData
                : string
              : CD extends {columnType: 'PgArray'; data: infer TArrayData}
                ? TArrayData
                : CD extends {$type: infer TType}
                  ? TType
                  : DefaultColumnType<CD>
        : unknown
      : unknown
    : unknown
  : unknown;

/**
 * Type utility to get the Drizzle custom type for a table and column.
 */
type ZeroCustomType<
  ZeroSchema,
  TableName extends string,
  ColumnName extends string,
> =
  IsAny<ZeroSchema> extends true
    ? SchemaIsAnyError
    : ZeroSchema extends {
          tables: Record<
            TableName,
            {columns: Record<ColumnName, {customType: infer T}>}
          >;
        }
      ? T
      : unknown;

// ---------------------------------------------------------------------------
// ManyToMany config types (unchanged from original)
// ---------------------------------------------------------------------------

type ManyTableConfig<
  TDrizzleSchema extends Record<string, unknown>,
  TSourceTableName extends keyof TDrizzleSchema & string,
> = {
  readonly [TRelationName: string]:
    | readonly [keyof TDrizzleSchema, keyof TDrizzleSchema]
    | {
        [K in keyof TDrizzleSchema]: {
          [L in keyof TDrizzleSchema]: readonly [
            {
              readonly destTable: K;
              readonly sourceField: ColumnIndexKeys<
                FindTableByName<TDrizzleSchema, TSourceTableName & string>
              >[];
              readonly destField: ColumnIndexKeys<
                FindTableByName<TDrizzleSchema, K & string>
              >[];
            },
            {
              readonly destTable: L;
              readonly sourceField: ColumnIndexKeys<
                FindTableByName<TDrizzleSchema, K & string>
              >[];
              readonly destField: ColumnIndexKeys<
                FindTableByName<TDrizzleSchema, L & string>
              >[];
            },
          ];
        }[keyof TDrizzleSchema];
      }[keyof TDrizzleSchema];
};

type ManyConfig<TDrizzleSchema extends Record<string, unknown>> = {
  readonly [TSourceTableName in keyof TDrizzleSchema &
    string]?: ManyTableConfig<TDrizzleSchema, TSourceTableName>;
};

// ---------------------------------------------------------------------------
// Output schema type
// ---------------------------------------------------------------------------

type DrizzleToZeroSchema<
  TDrizzleSchema extends {[K in string]: unknown},
  TColumnConfig extends TableColumnsConfig<TDrizzleSchema> =
    DefaultTableColumnsConfig<TDrizzleSchema>,
> = {
  readonly tables: {
    readonly [K in Extract<
      {
        [TTableName in keyof TDrizzleSchema &
          keyof TColumnConfig]: TDrizzleSchema[TTableName] extends Table<any>
          ? [TColumnConfig[TTableName]] extends [false | undefined]
            ? never
            : TTableName
          : never;
      }[keyof TDrizzleSchema & keyof TColumnConfig],
      keyof TDrizzleSchema & string
    >]: TDrizzleSchema[K] extends Table<any>
      ? ZeroTableBuilderSchema<
          K & string,
          TDrizzleSchema[K],
          TColumnConfig[K & keyof TColumnConfig]
        >
      : never;
  };
  readonly relationships: any;
  readonly enableLegacyMutators?: boolean;
  readonly enableLegacyQueries?: boolean;
};

// ---------------------------------------------------------------------------
// Version detection — per-schema, based on the shape of the entries
// ---------------------------------------------------------------------------

/**
 * Detects whether a schema contains Drizzle 1.0 `defineRelations()` entries.
 * These have the shape `{ table: Table, name: string, relations: {...} }`.
 * If none are found, falls back to V1 (which handles `Relations` class instances).
 */
function pickExtractor(schema: Record<string, unknown>): RelationExtractor {
  for (const value of Object.values(schema)) {
    if (
      typeof value === 'object' &&
      value !== null &&
      'table' in value &&
      'name' in value &&
      'relations' in value &&
      typeof (value as any).name === 'string' &&
      typeof (value as any).relations === 'object'
    ) {
      return v2Extractor;
    }
  }
  return v1Extractor;
}

// ---------------------------------------------------------------------------
// drizzleZeroConfig
// ---------------------------------------------------------------------------

/**
 * Creates a Zero schema from a Drizzle schema definition.
 *
 * @see original docstring in the old relations.ts
 */
const drizzleZeroConfig = <
  const TDrizzleSchema extends {[K in string]: unknown},
  const TColumnConfig extends TableColumnsConfig<TDrizzleSchema> =
    DefaultTableColumnsConfig<TDrizzleSchema>,
  const TManyConfig extends ManyConfig<TDrizzleSchema> | undefined = undefined,
  const TCasing extends ZeroTableCasing = undefined,
>(
  schema: TDrizzleSchema,
  config?: {
    readonly tables?: TColumnConfig;
    readonly manyToMany?: TManyConfig;
    readonly casing?: TCasing;
    readonly debug?: boolean;
    readonly suppressDefaultsWarning?: boolean;
  },
): Flatten<DrizzleToZeroSchema<TDrizzleSchema, TColumnConfig>> => {
  const tables: any[] = [];
  const tableColumnNamesForSourceTable = new Map<string, Set<string>>();

  // ---- Build tables ----
  for (const [tableName, tableOrRelations] of typedEntries(schema)) {
    if (!tableOrRelations) {
      throw new Error(
        `drizzle-zero: table or relation with key ${String(tableName)} is not defined`,
      );
    }

    if (is(tableOrRelations, Table)) {
      const tableConfig = config?.tables?.[tableName as keyof TColumnConfig];

      if (
        config?.tables !== undefined &&
        (tableConfig === false || tableConfig === undefined)
      ) {
        debugLog(
          config?.debug,
          `Skipping table ${String(tableName)} - ${
            tableConfig === false
              ? 'explicitly excluded'
              : 'not mentioned in config'
          }`,
        );
        continue;
      }

      const tableSchema = createZeroTableBuilder(
        String(tableName),
        tableOrRelations,
        tableConfig,
        config?.debug,
        config?.casing,
        config?.suppressDefaultsWarning,
      );

      tables.push(tableSchema);

      const columnNames = new Set<string>();
      for (const columnName of Object.keys(tableSchema.schema.columns)) {
        columnNames.add(columnName);
      }
      tableColumnNamesForSourceTable.set(String(tableName), columnNames);
    }
  }

  if (tables.length === 0) {
    throw new Error(
      schema['tables']
        ? '❌ drizzle-zero: No tables found in the input - did you pass in a Zero schema to the `drizzleZeroConfig` function instead of a Drizzle schema?'
        : '❌ drizzle-zero: No tables found in the input - did you export tables and relations from the Drizzle schema passed to the `drizzleZeroConfig` function?',
    );
  }

  // ---- Normalize manyToMany config into the shared format ----
  let manyToMany: Record<string, Record<string, ManyToManyEntry>> | undefined;
  if (config?.manyToMany) {
    manyToMany = {};
    for (const [sourceTableName, manyConfig] of Object.entries(
      config.manyToMany,
    )) {
      if (!manyConfig) continue;
      manyToMany[sourceTableName] = {};
      for (const [relationName, entry] of Object.entries(manyConfig)) {
        manyToMany[sourceTableName]![relationName] = entry as ManyToManyEntry;
      }
    }
  }

  // ---- Extract relationships ----
  const schemaRecord = schema as Record<string, unknown>;
  const relationships: ExtractedRelationships = pickExtractor(
    schemaRecord,
  ).extract({
    schema: schemaRecord,
    debug: config?.debug,
    includedTables: config?.tables as Record<string, unknown> | undefined,
    manyToMany,
    getDrizzleKeyFromTable: getDrizzleKeyFromTableFn,
  });

  // ---- Validate relation names don't collide with column names ----
  for (const [tableName, rels] of Object.entries(relationships)) {
    const columnNames = tableColumnNamesForSourceTable.get(tableName);
    if (!columnNames) continue;
    for (const relationName of Object.keys(rels)) {
      if (columnNames.has(relationName)) {
        throw new Error(
          `drizzle-zero: Invalid relationship name for ${tableName}.${relationName}: there is already a table column with the name ${relationName} and this cannot be used as a relationship name`,
        );
      }
    }
  }

  // ---- Assemble final schema ----
  const finalSchema = createSchema({
    tables,
    relationships: Object.entries(relationships).map(([key, value]) => ({
      name: key,
      relationships: value,
    })),
  } as any) as unknown as DrizzleToZeroSchema<TDrizzleSchema, TColumnConfig>;

  debugLog(
    config?.debug,
    'Output Zero schema',
    JSON.stringify(finalSchema, null, 2),
  );

  return finalSchema;
};

export {
  drizzleZeroConfig,
  type CustomType,
  type DrizzleToZeroSchema,
  type ZeroCustomType,
};
