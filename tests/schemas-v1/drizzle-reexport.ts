/**
 * Re-exports drizzle-orm, drizzle-orm/pg-core, and drizzle-orm/mysql-core.
 *
 * This file exists so that test suites can dynamically import drizzle
 * APIs from a path that the Vite alias plugin resolves to the correct
 * version (v0 for tests/schemas/, v1 for tests/schemas-v1/).
 */
export * from 'drizzle-orm/pg-core';
export {mysqlTable, text as textMysql} from 'drizzle-orm/mysql-core';
export {sql} from 'drizzle-orm';
export type {SQL} from 'drizzle-orm';
