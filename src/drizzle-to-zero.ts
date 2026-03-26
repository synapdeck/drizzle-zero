import type {ReadonlyJSONValue} from '@rocicorp/zero';

/**
 * Represents the basic data types supported by Drizzle ORM (0.x).
 * These are the fundamental types that can be used in table column definitions.
 */
type DrizzleDataType = 'number' | 'bigint' | 'boolean' | 'date';

/**
 * Maps Drizzle 0.x data types to their corresponding Zero schema types.
 * This is a constant mapping that ensures type safety when converting between the two systems.
 */
export const drizzleDataTypeToZeroType = {
  number: 'number',
  bigint: 'number',
  boolean: 'boolean',
  date: 'number',
} as const satisfies Record<DrizzleDataType, string>;

/**
 * Type representation of the Drizzle to Zero type mapping.
 * Extracts the type information from the drizzleDataTypeToZeroType constant.
 */
export type DrizzleDataTypeToZeroType = typeof drizzleDataTypeToZeroType;

// ---------------------------------------------------------------------------
// Drizzle 1.0 compound dataType support
// ---------------------------------------------------------------------------
// In Drizzle 1.0, `column.dataType` changed from simple values like 'string'
// to compound values like 'string uuid', 'object date', 'bigint int64', etc.
// The base type (first word) determines the JS runtime type, while the
// constraint (second word) provides additional semantic info.

/**
 * The base (first word) of a Drizzle 1.0 compound dataType.
 */
type Drizzle1BaseDataType =
  | 'array'
  | 'bigint'
  | 'boolean'
  | 'custom'
  | 'number'
  | 'object'
  | 'string';

/**
 * Maps Drizzle 1.0 base data types to their corresponding Zero schema types.
 */
export const drizzle1BaseTypeToZeroType = {
  array: 'json',
  bigint: 'number',
  boolean: 'boolean',
  custom: null, // requires fallback to getSQLType()
  number: 'number',
  object: 'json',
  string: 'string',
} as const satisfies Record<Drizzle1BaseDataType, string | null>;

type Drizzle1BaseTypeToZeroType = typeof drizzle1BaseTypeToZeroType;

/**
 * Extracts the base type (first word) from a Drizzle 1.0 compound dataType.
 * e.g. 'string uuid' → 'string', 'object date' → 'object'
 */
export type ExtractBaseType<T extends string> =
  T extends `${infer Base} ${string}` ? Base : T;

/**
 * Extracts the constraint (second word) from a Drizzle 1.0 compound dataType.
 * e.g. 'string uuid' → 'uuid', 'object date' → 'date'
 */
export type ExtractConstraint<T extends string> =
  T extends `${string} ${infer Constraint}` ? Constraint : never;

/** Constraints that indicate a timestamp/date type (maps to number in Zero). */
type TimestampConstraints = 'date' | 'timestamp' | 'timestamptz';

/** Constraints that indicate a numeric string type (maps to number in Zero). */
type NumericStringConstraints = 'numeric' | 'time';

/**
 * Detects whether a Drizzle 1.0 compound dataType represents a timestamp.
 * These are mapped to 'number' in Zero (epoch millis).
 */
export type IsTimestampDataType<T extends string> =
  ExtractConstraint<T> extends TimestampConstraints ? true : false;

/**
 * Detects whether a Drizzle 1.0 compound dataType represents a bigint.
 */
export type IsBigIntDataType<T extends string> =
  ExtractBaseType<T> extends 'bigint' ? true : false;

/**
 * Detects whether a Drizzle 1.0 compound dataType represents a string numeric.
 */
export type IsStringNumericDataType<T extends string> =
  ExtractBaseType<T> extends 'string'
    ? ExtractConstraint<T> extends NumericStringConstraints
      ? true
      : false
    : false;

/**
 * Maps a Drizzle 1.0 compound dataType to its Zero type.
 * Special-cases timestamps (object date, string timestamp) → number,
 * bigint → number, string numeric → number.
 */
export type MapDrizzle1DataTypeToZero<T extends string> =
  IsTimestampDataType<T> extends true
    ? 'number'
    : IsBigIntDataType<T> extends true
      ? 'number'
      : IsStringNumericDataType<T> extends true
        ? 'number'
        : ExtractBaseType<T> extends keyof Drizzle1BaseTypeToZeroType
          ? Drizzle1BaseTypeToZeroType[ExtractBaseType<T>]
          : never;

/**
 * Runtime: extracts the base type from a compound dataType string.
 */
export function extractBaseType(dataType: string): string {
  const spaceIndex = dataType.indexOf(' ');
  return spaceIndex === -1 ? dataType : dataType.slice(0, spaceIndex);
}

/**
 * Runtime: extracts the constraint from a compound dataType string.
 */
export function extractConstraint(dataType: string): string | undefined {
  const spaceIndex = dataType.indexOf(' ');
  return spaceIndex === -1 ? undefined : dataType.slice(spaceIndex + 1);
}

/** Constraints that map to 'number' in Zero regardless of base type. */
const timestampConstraints = new Set<string>([
  'date',
  'timestamp',
  'timestamptz',
]);
const numericStringConstraints = new Set<string>(['numeric', 'time']);

/**
 * Runtime: maps a Drizzle 1.0 compound dataType to its Zero type.
 * Returns null if the type is 'custom' or unknown (fallback to getSQLType).
 */
export function mapDrizzle1DataTypeToZero(dataType: string): string | null {
  const base = extractBaseType(dataType);
  const constraint = extractConstraint(dataType);

  // Special cases: timestamps/dates always map to number
  if (constraint && timestampConstraints.has(constraint)) {
    return 'number';
  }

  // String numerics/time map to number
  if (
    base === 'string' &&
    constraint &&
    numericStringConstraints.has(constraint)
  ) {
    return 'number';
  }

  // Bigint always maps to number
  if (base === 'bigint') {
    return 'number';
  }

  return (
    drizzle1BaseTypeToZeroType[
      base as keyof typeof drizzle1BaseTypeToZeroType
    ] ?? null
  );
}

/**
 * Represents specific Postgres column types supported by Zero.
 */
type DrizzleColumnType =
  | 'PgText'
  | 'PgChar'
  | 'PgVarchar'
  | 'PgUUID'
  | 'PgEnumColumn'
  | 'PgJsonb'
  | 'PgJson'
  | 'PgNumeric'
  | 'PgDateString'
  | 'PgTime'
  | 'PgTimestampString'
  | 'PgArray';

/**
 * Maps Postgres-specific Drizzle column types to their corresponding Zero schema types.
 * Handles special cases where Postgres types need specific Zero type representations.
 */
export const drizzleColumnTypeToZeroType = {
  PgText: 'string',
  PgChar: 'string',
  PgVarchar: 'string',
  PgUUID: 'string',
  PgEnumColumn: 'string',
  PgJsonb: 'json',
  PgJson: 'json',
  PgNumeric: 'number',
  PgDateString: 'number',
  PgTime: 'number',
  PgTimestampString: 'number',
  PgArray: 'json',
} as const satisfies Record<DrizzleColumnType, string>;

/**
 * Type representation of the Postgres-specific Drizzle to Zero type mapping.
 * Extracts the type information from the drizzleColumnTypeToZeroType constant.
 */
export type DrizzleColumnTypeToZeroType = typeof drizzleColumnTypeToZeroType;

/**
 * Maps PostgreSQL SQL type names to their corresponding Zero schema types.
 */
export const postgresTypeToZeroType = {
  // string-like
  'text': 'string',
  'char': 'string',
  'character': 'string',
  'varchar': 'string',
  'character varying': 'string',
  'uuid': 'string',
  'enum': 'string', // enums are emitted via zero.enumeration([...]) and are strings

  // json-like
  'jsonb': 'json',
  'json': 'json',

  // number-like (all numeric types)
  'numeric': 'number',
  'decimal': 'number',
  'int': 'number',
  'integer': 'number',
  'smallint': 'number',
  'bigint': 'number',
  'int2': 'number',
  'int4': 'number',
  'int8': 'number',
  'real': 'number',
  'float4': 'number',
  'float8': 'number',
  'double precision': 'number',
  'serial': 'number',
  'bigserial': 'number',

  // date/time mapped to number (epoch millis)
  'date': 'number',
  'time': 'number',
  'time without time zone': 'number',
  'time with time zone': 'number',
  'timetz': 'number',
  'timestamp': 'number',
  'timestamp without time zone': 'number',
  'timestamp with time zone': 'number',
  'timestamptz': 'number',

  // boolean
  'boolean': 'boolean',
  'bool': 'boolean',
} as const satisfies Record<string, string>;

/**
 * Type representation of the Postgres-specific Drizzle to Zero type mapping.
 * Extracts the type information from the postgresTypeToZeroType constant.
 */
export type PostgresTypeToZeroType = typeof postgresTypeToZeroType;

/**
 * Maps Zero schema types to their corresponding TypeScript types.
 */
export type ZeroTypeToTypescriptType = {
  number: number;
  boolean: boolean;
  date: string;
  string: string;
  json: ReadonlyJSONValue;
};
