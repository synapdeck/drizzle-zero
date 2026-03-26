import path from 'node:path';

const testsDir = path.resolve(import.meta.dirname);
const schemasV1Dir = path.join(testsDir, 'schemas-v1');

/**
 * Vite plugin that rewrites `drizzle-orm` imports to `drizzle-orm-v0`
 * (the 0.x pnpm alias) **only** for v0 test files under tests/.
 *
 * Files under tests/schemas-v1/ and test files ending in -v1.test.ts
 * are excluded — they target Drizzle 1.0 and should resolve the real
 * drizzle-orm package.
 */
export function drizzleTestAlias() {
  return {
    name: 'drizzle-test-alias',
    enforce: 'pre' as const,
    async resolveId(this: any, source: string, importer: string | undefined) {
      if (!importer || !importer.startsWith(testsDir)) return null;
      // Don't alias v1 schemas or v1 test files
      if (importer.startsWith(schemasV1Dir)) return null;
      if (importer.includes('-v1.test.ts')) return null;
      const match = source.match(/^drizzle-orm(\/.*)?$/);
      if (!match) return null;
      const subpath = match[1] ?? '';
      return this.resolve(`drizzle-orm-v0${subpath}`, importer, {
        skipSelf: true,
      });
    },
  };
}
