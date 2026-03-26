/**
 * Drizzle 0.x relation extraction.
 *
 * Only loaded at runtime when the installed drizzle-orm exposes the
 * legacy `Relations` class (drizzle-orm < 1.0).
 *
 * We import from `drizzle-orm-v0` (a pnpm alias for drizzle-orm@0.45)
 * so this file gets real 0.x types at compile time.  At runtime, the
 * bundled JS just does `require("drizzle-orm")` — the alias only
 * exists in the dev workspace.
 */
import type {Many, One} from 'drizzle-orm-v0';
import {
  createTableRelationsHelpers,
  getTableName,
  getTableUniqueName,
  is,
  One as OneClass,
  Relations,
  Table,
} from 'drizzle-orm-v0';
import {getDrizzleColumnKeyFromColumnName} from '../tables';
import {typedEntries} from '../util';
import type {
  ExtractionContext,
  ExtractedRelationships,
  RelationExtractor,
} from './shared';

// ---- extractor ----

export const v1Extractor: RelationExtractor = {
  detect(schema) {
    for (const value of Object.values(schema)) {
      if (is(value, Relations)) return true;
    }
    return false;
  },

  extract(ctx) {
    return extractV1Relations(ctx);
  },
};

// ---- implementation ----

function extractV1Relations({
  schema,
  includedTables,
  getDrizzleKeyFromTable,
}: ExtractionContext): ExtractedRelationships {
  const relationships: ExtractedRelationships = {};

  for (const [_schemaKey, tableOrRelations] of typedEntries(schema)) {
    if (!is(tableOrRelations, Relations)) continue;

    const actualTableName = getTableName(tableOrRelations.table);
    const tableName = getDrizzleKeyFromTable({
      schema,
      table: tableOrRelations.table,
      fallbackTableName: actualTableName,
    });

    const relationsConfig = getRelationsConfig(tableOrRelations);

    for (const relation of Object.values(relationsConfig)) {
      let sourceFieldNames: string[] = [];
      let destFieldNames: string[] = [];

      if (is(relation, OneClass)) {
        sourceFieldNames =
          relation?.config?.fields?.map(f =>
            getDrizzleColumnKeyFromColumnName({
              columnName: f?.name,
              table: f.table,
            }),
          ) ?? [];
        destFieldNames =
          relation?.config?.references?.map(f =>
            getDrizzleColumnKeyFromColumnName({
              columnName: f?.name,
              table: f.table,
            }),
          ) ?? [];
      }

      if (!sourceFieldNames.length || !destFieldNames.length) {
        if (relation.relationName) {
          const found = findNamedSourceAndDestFields(schema, relation);
          sourceFieldNames = found.sourceFieldNames;
          destFieldNames = found.destFieldNames;
        } else {
          const found = findRelationSourceAndDestFields(schema, relation);
          sourceFieldNames = found.sourceFieldNames;
          destFieldNames = found.destFieldNames;
        }
      }

      if (!sourceFieldNames.length || !destFieldNames.length) {
        throw new Error(
          `drizzle-zero: No relationship found for: ${relation.fieldName} (${is(relation, OneClass) ? 'One' : 'Many'} from ${String(tableName)} to ${relation.referencedTableName}). Did you forget to define ${relation.relationName ? `a named relation "${relation.relationName}"` : `an opposite ${is(relation, OneClass) ? 'Many' : 'One'} relation`}?`,
        );
      }

      const referencedTableKey = getDrizzleKeyFromTable({
        schema,
        table: relation.referencedTable,
        fallbackTableName: relation.referencedTableName,
      });

      if (
        includedTables !== undefined &&
        (!includedTables[tableName] || !includedTables[referencedTableKey])
      ) {
        continue;
      }

      if (relationships[tableName]?.[relation.fieldName]) {
        throw new Error(
          `drizzle-zero: Duplicate relationship found for: ${relation.fieldName} (from ${String(tableName)} to ${relation.referencedTableName}).`,
        );
      }

      relationships[tableName] = {
        ...relationships[tableName],
        [relation.fieldName]: [
          {
            sourceField: sourceFieldNames,
            destField: destFieldNames,
            destSchema: referencedTableKey,
            cardinality: is(relation, OneClass) ? 'one' : 'many',
          },
        ],
      };
    }
  }

  return relationships;
}

// ---- V1 helpers (unchanged logic from the original relations.ts) ----

const getReferencedTableName = (
  rel:
    | One
    | Many<any>
    | {
        sourceTable: Table;
        referencedTableName?: string;
        referencedTable?: Table;
      },
) => {
  if ('referencedTable' in rel && rel.referencedTable) {
    return getTableUniqueName(rel.referencedTable);
  }
  if ('referencedTableName' in rel && rel.referencedTableName) {
    return rel.referencedTableName;
  }
  return undefined;
};

const findRelationSourceAndDestFields = (
  schema: Record<string, unknown>,
  relation:
    | {
        sourceTable: Table;
        referencedTableName?: string;
        referencedTable?: Table;
      }
    | One
    | Many<any>,
) => {
  const sourceTableName = getTableUniqueName(relation.sourceTable);
  const referencedTableName = getReferencedTableName(relation);

  for (const tableOrRelations of Object.values(schema)) {
    if (!is(tableOrRelations, Relations)) continue;

    const relationsConfig = getRelationsConfig(tableOrRelations);

    for (const relationConfig of Object.values(relationsConfig)) {
      if (!is(relationConfig, OneClass)) continue;

      const foundSourceName = getTableUniqueName(relationConfig.sourceTable);
      const foundReferencedName = getReferencedTableName(relationConfig);

      if (
        foundSourceName === referencedTableName &&
        foundReferencedName === sourceTableName
      ) {
        const sourceFieldNames =
          relationConfig.config?.references?.map(f =>
            getDrizzleColumnKeyFromColumnName({
              columnName: f.name,
              table: f.table,
            }),
          ) ?? [];

        const destFieldNames =
          relationConfig.config?.fields?.map(f =>
            getDrizzleColumnKeyFromColumnName({
              columnName: f.name,
              table: f.table,
            }),
          ) ?? [];

        if (sourceFieldNames.length && destFieldNames.length) {
          return {sourceFieldNames, destFieldNames};
        }
      }

      if (
        foundSourceName === sourceTableName &&
        foundReferencedName === referencedTableName
      ) {
        const sourceFieldNames =
          relationConfig.config?.fields?.map(f =>
            getDrizzleColumnKeyFromColumnName({
              columnName: f.name,
              table: f.table,
            }),
          ) ?? [];

        const destFieldNames =
          relationConfig.config?.references?.map(f =>
            getDrizzleColumnKeyFromColumnName({
              columnName: f.name,
              table: f.table,
            }),
          ) ?? [];

        if (sourceFieldNames.length && destFieldNames.length) {
          return {sourceFieldNames, destFieldNames};
        }
      }
    }
  }

  return {sourceFieldNames: [] as string[], destFieldNames: [] as string[]};
};

const findNamedSourceAndDestFields = (
  schema: Record<string, unknown>,
  relation: One | Many<any>,
) => {
  for (const tableOrRelations of Object.values(schema)) {
    if (!is(tableOrRelations, Relations)) continue;

    const relationsConfig = getRelationsConfig(tableOrRelations);

    for (const relationConfig of Object.values(relationsConfig)) {
      if (
        is(relationConfig, OneClass) &&
        relationConfig.relationName === relation.relationName
      ) {
        return {
          destFieldNames:
            relationConfig.config?.fields?.map(f =>
              getDrizzleColumnKeyFromColumnName({
                columnName: f.name,
                table: f.table,
              }),
            ) ?? [],
          sourceFieldNames:
            relationConfig.config?.references?.map(f =>
              getDrizzleColumnKeyFromColumnName({
                columnName: f.name,
                table: f.table,
              }),
            ) ?? [],
        };
      }
    }
  }

  return {sourceFieldNames: [] as string[], destFieldNames: [] as string[]};
};

const getRelationsConfig = (relations: Relations) =>
  relations.config(createTableRelationsHelpers(relations.table)) as Record<
    string,
    One | Many<any>
  >;
