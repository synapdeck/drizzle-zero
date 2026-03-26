/**
 * Drizzle 0.x relation extraction.
 *
 * Only loaded at runtime when the installed drizzle-orm exposes the
 * legacy `Relations` class (drizzle-orm < 1.0).
 *
 * We import from `drizzle-orm-v0` (a pnpm alias for drizzle-orm@0.45)
 * so this file gets real 0.x types at compile time.
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
import {debugLog, typedEntries} from '../util';
import type {
  ExtractionContext,
  ExtractedRelationships,
  RelationExtractor,
} from './shared';

// ---- extractor ----

export const v1Extractor: RelationExtractor = {
  extract(ctx) {
    const relationships: ExtractedRelationships = {};
    extractManyToMany(ctx, relationships);
    extractDirectRelations(ctx, relationships);
    return relationships;
  },
};

// ---- manyToMany ----

function extractManyToMany(
  {schema, debug, includedTables, manyToMany}: ExtractionContext,
  relationships: ExtractedRelationships,
) {
  if (!manyToMany) return;

  for (const [sourceTableName, relEntries] of Object.entries(manyToMany)) {
    for (const [relationName, entry] of Object.entries(relEntries)) {
      if (typeof entry[0] === 'string' && typeof entry[1] === 'string') {
        // Simple string tuple form — auto-detect junction fields from relations
        const junctionTableName = entry[0];
        const destTableName = entry[1];

        const sourceTable = findTable(schema, sourceTableName);
        const destTable = findTable(schema, destTableName);
        const junctionTable = findTable(schema, junctionTableName);

        if (!sourceTable || !destTable || !junctionTable) {
          throw new Error(
            `drizzle-zero: Invalid many-to-many configuration for ${sourceTableName}.${relationName}: Could not find ${!sourceTable ? 'source' : !destTable ? 'destination' : 'junction'} table`,
          );
        }

        const sourceJunctionFields = findRelationSourceAndDestFields(schema, {
          sourceTable,
          referencedTableName: getTableName(junctionTable),
          referencedTable: junctionTable,
        });

        const junctionDestFields = findRelationSourceAndDestFields(schema, {
          sourceTable: destTable,
          referencedTableName: getTableName(junctionTable),
          referencedTable: junctionTable,
        });

        if (
          !sourceJunctionFields.sourceFieldNames.length ||
          !sourceJunctionFields.destFieldNames.length ||
          !junctionDestFields.sourceFieldNames.length ||
          !junctionDestFields.destFieldNames.length
        ) {
          throw new Error(
            `drizzle-zero: Invalid many-to-many configuration for ${sourceTableName}.${relationName}: Could not find relationships in junction table ${junctionTableName}`,
          );
        }

        if (
          includedTables &&
          (!includedTables[junctionTableName] ||
            !includedTables[sourceTableName] ||
            !includedTables[destTableName])
        ) {
          debugLog(
            debug,
            `Skipping many-to-many relationship - tables not in schema config:`,
            {junctionTableName, sourceTableName, destTableName},
          );
          continue;
        }

        relationships[sourceTableName] = {
          ...relationships[sourceTableName],
          [relationName]: [
            {
              sourceField: sourceJunctionFields.sourceFieldNames,
              destField: sourceJunctionFields.destFieldNames,
              destSchema: junctionTableName,
              cardinality: 'many',
            },
            {
              sourceField: junctionDestFields.destFieldNames,
              destField: junctionDestFields.sourceFieldNames,
              destSchema: destTableName,
              cardinality: 'many',
            },
          ],
        };

        debugLog(debug, `Added many-to-many relationship:`, {
          sourceTable: sourceTableName,
          relationName,
          relationship: relationships[sourceTableName]?.[relationName],
        });
      } else {
        // Explicit object form
        const junction = entry[0] as {
          destTable: string;
          sourceField: string[];
          destField: string[];
        };
        const dest = entry[1] as {
          destTable: string;
          sourceField: string[];
          destField: string[];
        };

        if (
          !junction.sourceField ||
          !junction.destField ||
          !dest.sourceField ||
          !dest.destField ||
          !junction.destTable ||
          !dest.destTable
        ) {
          throw new Error(
            `drizzle-zero: Invalid many-to-many configuration for ${sourceTableName}.${relationName}: Not all required fields were provided.`,
          );
        }

        if (
          includedTables &&
          (!includedTables[junction.destTable] ||
            !includedTables[sourceTableName] ||
            !includedTables[dest.destTable])
        ) {
          continue;
        }

        relationships[sourceTableName] = {
          ...relationships[sourceTableName],
          [relationName]: [
            {
              sourceField: junction.sourceField,
              destField: junction.destField,
              destSchema: junction.destTable,
              cardinality: 'many',
            },
            {
              sourceField: dest.sourceField,
              destField: dest.destField,
              destSchema: dest.destTable,
              cardinality: 'many',
            },
          ],
        };
      }
    }
  }
}

// ---- direct relations ----

function extractDirectRelations(
  {schema, includedTables, getDrizzleKeyFromTable, debug}: ExtractionContext,
  relationships: ExtractedRelationships,
) {
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
        debugLog(debug, `Skipping relation - tables not in schema config:`, {
          sourceTable: tableName,
          referencedTable: referencedTableKey,
        });
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
}

// ---- helpers ----

function findTable(
  schema: Record<string, unknown>,
  tableName: string,
): Table | undefined {
  const entry = typedEntries(schema).find(
    ([key, value]) => is(value, Table) && key === tableName,
  );
  return entry ? (entry[1] as Table) : undefined;
}

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
