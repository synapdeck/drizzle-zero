/**
 * Cross-version type compatibility for drizzle-orm 0.x and 1.0.
 *
 * The `Table` types from each version are structurally incompatible
 * (1.0 added `dialect` to `Table._`). This module provides a union
 * so code that accepts tables from either version can be typed cleanly.
 */
import type {Table as V1Table} from 'drizzle-orm-v0';
import type {Table as V2Table} from 'drizzle-orm';

export type AnyTable = V1Table | V2Table;
