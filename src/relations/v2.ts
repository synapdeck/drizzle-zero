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
    return extractV2Relations(ctx);
  },
};

// ---- implementation ----

function extractV2Relations({
  schema,
  includedTables,
  getDrizzleKeyFromTable,
}: ExtractionContext): ExtractedRelationships {
  const relationships: ExtractedRelationships = {};

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

  return relationships;
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
