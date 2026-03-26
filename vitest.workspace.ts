import tsconfigPaths from 'vite-tsconfig-paths';
import {defineProject} from 'vitest/config';
import {drizzleTestAlias} from './tests/drizzle-test-alias';

const sharedPlugins = [drizzleTestAlias() as any, tsconfigPaths()];

const sharedTestConfig = {
  testTimeout: 30000,
  hookTimeout: 30000,
  coverage: {
    include: ['src/**/*.ts'],
    exclude: ['src/cli/index.ts'],
  },
  fileParallelism: true,
} as const;

/**
 * Two workspace projects so that v0 test files typecheck against
 * drizzle-orm-v0 types (via tsconfig.test.json path mapping) while
 * v1 test files typecheck against the real drizzle-orm 1.0 types.
 */
export default [
  defineProject({
    plugins: sharedPlugins,
    test: {
      ...sharedTestConfig,
      name: 'v0',
      include: ['tests/**/*.test.ts'],
      exclude: ['tests/types-v1.test.ts'],
      typecheck: {
        enabled: true,
        tsconfig: 'tests/tsconfig.test.json',
        include: ['tests/**/*.test.ts'],
        exclude: ['tests/types-v1.test.ts'],
      },
    },
  }),
  defineProject({
    plugins: sharedPlugins,
    test: {
      ...sharedTestConfig,
      name: 'v1',
      include: ['tests/types-v1.test.ts'],
      typecheck: {
        enabled: true,
        tsconfig: 'tsconfig.json',
        include: ['tests/types-v1.test.ts'],
      },
    },
  }),
];
