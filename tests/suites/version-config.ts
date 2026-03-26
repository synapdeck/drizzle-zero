import path from 'node:path';

const testsDir = path.resolve(import.meta.dirname, '..');

/**
 * Configuration for parameterized test suites that run against both
 * Drizzle 0.x and 1.0 schema fixtures.
 */
export interface VersionConfig {
  /** Display name for the describe block, e.g. 'v0' or 'v1'. */
  name: string;
  /** Path prefix for schema imports, relative to tests/. */
  schemasDir: string;
  /** tsconfig path for ts-morph Project instances. */
  tsconfigPath: string;
  /** Version-specific error messages that differ between v0 and v1. */
  errors: {
    duplicateRelationship: string;
    missingNamedRelation: string;
    missingOneRelation: string;
    relationNameConflictsColumn: string;
  };
  /** Version-specific warning substrings for unsupported column types. */
  warnings: {
    interval: string;
    cidr: string;
    macaddr: string;
    inet: string;
    point: string;
    line: string;
    geometry: string;
  };
}

export const v0Config: VersionConfig = {
  name: 'v0 (drizzle-orm 0.x)',
  schemasDir: path.join(testsDir, 'schemas'),
  tsconfigPath: path.join(testsDir, 'tsconfig.test.json'),
  errors: {
    duplicateRelationship:
      'drizzle-zero: Duplicate relationship found for: usersToGroups (from users to users_to_group).',
    missingNamedRelation:
      'drizzle-zero: No relationship found for: author (Many from users to posts). Did you forget to define a named relation "author"?',
    missingOneRelation:
      'drizzle-zero: No relationship found for: author (Many from users to posts). Did you forget to define an opposite One relation?',
    relationNameConflictsColumn:
      'drizzle-zero: Invalid relationship name for users.posts: there is already a table column with the name posts and this cannot be used as a relationship name',
  },
  warnings: {
    interval:
      '🚨  drizzle-zero: Unsupported column type: interval - PgInterval (string)',
    cidr: '🚨  drizzle-zero: Unsupported column type: cidr - PgCidr (string)',
    macaddr:
      '🚨  drizzle-zero: Unsupported column type: macaddr - PgMacaddr (string)',
    inet: '🚨  drizzle-zero: Unsupported column type: inet - PgInet (string)',
    point:
      '🚨  drizzle-zero: Unsupported column type: point - PgPointTuple (array)',
    line: '🚨  drizzle-zero: Unsupported column type: line - PgLine (array)',
    geometry:
      '🚨  drizzle-zero: Unsupported column type: location - PgGeometryObject (json)',
  },
};

export const v1Config: VersionConfig = {
  name: 'v1 (drizzle-orm 1.0)',
  schemasDir: path.join(testsDir, 'schemas-v1'),
  tsconfigPath: path.resolve(testsDir, '..', 'tsconfig.json'),
  errors: {
    duplicateRelationship:
      'drizzle-zero: Duplicate relationship found for: usersToGroups (from users to usersToGroups).',
    missingNamedRelation:
      'relations -> users: { author: r.many.posts(...) }: not enough data provided to build the relation - "from"/"to" are not defined, and there is no reverse relation of table "posts" with alias "author"',
    missingOneRelation:
      'relations -> users: { author: r.many.posts(...) }: not enough data provided to build the relation - "from"/"to" are not defined, and no reverse relation of table "posts" with target table "users" was found',
    relationNameConflictsColumn:
      'relations -> users: { posts: r.many.posts(...) }: relation name collides with column "posts" of table "users"',
  },
  warnings: {
    interval:
      '🚨  drizzle-zero: Unsupported column type: interval - PgInterval (string interval)',
    cidr: '🚨  drizzle-zero: Unsupported column type: cidr - PgCidr (string cidr)',
    macaddr:
      '🚨  drizzle-zero: Unsupported column type: macaddr - PgMacaddr (string macaddr)',
    inet: '🚨  drizzle-zero: Unsupported column type: inet - PgInet (string inet)',
    point:
      '🚨  drizzle-zero: Unsupported column type: point - PgPointTuple (array point)',
    line: '🚨  drizzle-zero: Unsupported column type: line - PgLine (array line)',
    geometry:
      '🚨  drizzle-zero: Unsupported column type: location - PgGeometryObject (object geometry)',
  },
};
