/**
 * Drizzle 1.0 relation extraction.
 *
 * Only loaded at runtime when drizzle-orm >= 1.0 is installed and the
 * schema contains `defineRelations()` output entries (shape:
 * { table: Table, name: string, relations: { ... } }).
 */
import {is, One, Table} from 'drizzle-orm';
import {One as OneV2} from 'drizzle-orm/relations';
import {getDrizzleColumnKeyFromColumnName} from '../tables';
import {debugLog} from '../util';
import type {
  ExtractionContext,
  ExtractedRelationships,
  RelationExtractor,
} from './shared';

// ---- shape detection ----

interface V2RelationsEntry {
  table: Table;
  name: string;
  relations: Record<string, any>;
}

function isV2Entry(value: unknown): value is V2RelationsEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as any;
  return (
    'table' in v &&
    'name' in v &&
    'relations' in v &&
    is(v.table, Table) &&
    typeof v.name === 'string' &&
    typeof v.relations === 'object' &&
    v.relations !== null
  );
}

// ---- extractor ----

export const v2Extractor: RelationExtractor = {
  detect(schema) {
    for (const value of Object.values(schema)) {
      if (isV2Entry(value)) return true;
    }
    return false;
  },

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

  // Collect V2 entries for junction field resolution
  const v2Entries = new Map<string, V2RelationsEntry>();
  for (const value of Object.values(schema)) {
    if (isV2Entry(value)) {
      v2Entries.set(value.name, value);
    }
  }

  for (const [sourceTableName, relEntries] of Object.entries(manyToMany)) {
    for (const [relationName, entry] of Object.entries(relEntries)) {
      if (typeof entry[0] === 'string' && typeof entry[1] === 'string') {
        // Simple string tuple form — auto-detect junction fields from V2 relations
        const junctionTableName = entry[0];
        const destTableName = entry[1];

        const sourceJunction = findV2FieldsBetween(
          v2Entries,
          sourceTableName,
          junctionTableName,
        );
        const junctionDest = findV2FieldsBetween(
          v2Entries,
          destTableName,
          junctionTableName,
        );

        if (
          !sourceJunction.sourceFieldNames.length ||
          !sourceJunction.destFieldNames.length ||
          !junctionDest.sourceFieldNames.length ||
          !junctionDest.destFieldNames.length
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
              sourceField: sourceJunction.sourceFieldNames,
              destField: sourceJunction.destFieldNames,
              destSchema: junctionTableName,
              cardinality: 'many',
            },
            {
              sourceField: junctionDest.destFieldNames,
              destField: junctionDest.sourceFieldNames,
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
        // Explicit object form — same as V1
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
  {schema, debug, includedTables, getDrizzleKeyFromTable}: ExtractionContext,
  relationships: ExtractedRelationships,
) {
  // Collect all V2 entries for cross-referencing reversed Many relations
  const v2Entries = new Map<string, V2RelationsEntry>();
  for (const value of Object.values(schema)) {
    if (isV2Entry(value)) {
      v2Entries.set(value.name, value);
    }
  }

  for (const [_schemaKey, value] of Object.entries(schema)) {
    if (!isV2Entry(value)) continue;

    const entry = value;
    const tableName = getDrizzleKeyFromTable({
      schema,
      table: entry.table,
      fallbackTableName: entry.name,
    });

    for (const [fieldName, rel] of Object.entries(entry.relations)) {
      const isOne =
        rel.relationType === 'one' || is(rel, One) || is(rel, OneV2);

      let sourceFieldNames = columnsToKeys(rel.sourceColumns ?? []);
      let targetFieldNames = columnsToKeys(rel.targetColumns ?? []);

      // For reversed Many relations, look up the inverse One on the target
      // table to discover the column mapping.
      if (
        !isOne &&
        rel.isReversed &&
        (!sourceFieldNames.length || !targetFieldNames.length)
      ) {
        const targetEntry = v2Entries.get(rel.targetTableName);
        if (targetEntry) {
          for (const inverseRel of Object.values(targetEntry.relations)) {
            const inverseIsOne =
              (inverseRel as any).relationType === 'one' ||
              is(inverseRel, One) ||
              is(inverseRel, OneV2);
            if (!inverseIsOne) continue;

            const inverseTarget = (inverseRel as any).targetTableName ?? '';
            if (inverseTarget !== entry.name) continue;

            // The inverse One's source→target becomes our target→source
            sourceFieldNames = columnsToKeys(
              (inverseRel as any).targetColumns ?? [],
            );
            targetFieldNames = columnsToKeys(
              (inverseRel as any).sourceColumns ?? [],
            );
            break;
          }
        }
      }

      if (!sourceFieldNames.length || !targetFieldNames.length) {
        throw new Error(
          `drizzle-zero: No relationship found for: ${fieldName} (${isOne ? 'One' : 'Many'} from ${String(tableName)} to ${rel.targetTableName}). Could not resolve source/target columns.`,
        );
      }

      const referencedTableKey = getDrizzleKeyFromTable({
        schema,
        table: rel.targetTable,
        fallbackTableName: rel.targetTableName,
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

      if (relationships[tableName]?.[fieldName]) {
        throw new Error(
          `drizzle-zero: Duplicate relationship found for: ${fieldName} (from ${String(tableName)} to ${rel.targetTableName}).`,
        );
      }

      relationships[tableName] = {
        ...relationships[tableName],
        [fieldName]: [
          {
            sourceField: sourceFieldNames,
            destField: targetFieldNames,
            destSchema: referencedTableKey,
            cardinality: isOne ? 'one' : 'many',
          },
        ],
      };
    }
  }
}

// ---- helpers ----

function columnsToKeys(columns: any[]): string[] {
  return columns.map((c: any) =>
    getDrizzleColumnKeyFromColumnName({
      columnName: c.name,
      table: c.table,
    }),
  );
}

/**
 * Find the source/dest field names between two tables using V2 relation
 * entries. Looks for a One relation from `sourceTableName` to
 * `referencedTableName`, or the inverse.
 */
function findV2FieldsBetween(
  v2Entries: Map<string, V2RelationsEntry>,
  sourceTableName: string,
  referencedTableName: string,
): {sourceFieldNames: string[]; destFieldNames: string[]} {
  // Check if the source table has a One pointing at the referenced table
  const sourceEntry = v2Entries.get(sourceTableName);
  if (sourceEntry) {
    for (const rel of Object.values(sourceEntry.relations)) {
      const isOne =
        (rel as any).relationType === 'one' || is(rel, One) || is(rel, OneV2);
      if (!isOne) continue;

      if ((rel as any).targetTableName === referencedTableName) {
        const src = columnsToKeys((rel as any).sourceColumns ?? []);
        const dst = columnsToKeys((rel as any).targetColumns ?? []);
        if (src.length && dst.length) {
          return {sourceFieldNames: src, destFieldNames: dst};
        }
      }
    }
  }

  // Check the inverse: referenced table has a One pointing at source
  const refEntry = v2Entries.get(referencedTableName);
  if (refEntry) {
    for (const rel of Object.values(refEntry.relations)) {
      const isOne =
        (rel as any).relationType === 'one' || is(rel, One) || is(rel, OneV2);
      if (!isOne) continue;

      if ((rel as any).targetTableName === sourceTableName) {
        // Reversed: their source→target becomes our target→source
        const src = columnsToKeys((rel as any).targetColumns ?? []);
        const dst = columnsToKeys((rel as any).sourceColumns ?? []);
        if (src.length && dst.length) {
          return {sourceFieldNames: src, destFieldNames: dst};
        }
      }
    }
  }

  return {sourceFieldNames: [], destFieldNames: []};
}
