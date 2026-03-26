import path from 'node:path';

const testsDir = path.resolve(import.meta.dirname);

/**
 * Vite plugin that rewrites `drizzle-orm` imports to `drizzle-orm-v0`
 * (the 0.x pnpm alias) **only** for files under tests/.
 *
 * This lets the existing 0.x test schemas keep working while src/ code
 * continues to resolve drizzle-orm to the installed 1.0 version.
 */
export function drizzleTestAlias() {
  return {
    name: 'drizzle-test-alias',
    enforce: 'pre' as const,
    async resolveId(this: any, source: string, importer: string | undefined) {
      if (!importer || !importer.startsWith(testsDir)) return null;
      const match = source.match(/^drizzle-orm(\/.*)?$/);
      if (!match) return null;
      const subpath = match[1] ?? '';
      return this.resolve(`drizzle-orm-v0${subpath}`, importer, {
        skipSelf: true,
      });
    },
  };
}
