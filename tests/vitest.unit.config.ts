import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

// The functions resolve packages from src/functions, the tests from the root.
// Pin both to one file so vi.mock replaces what the handler imports.
const fromFunctions = createRequire(new URL('../src/functions/package.json', import.meta.url));
const mocked = [
  'stripe',
  '@aws-sdk/client-dynamodb',
  '@aws-sdk/lib-dynamodb',
  '@aws-sdk/client-secrets-manager',
  '@aws-sdk/client-ses',
];

export default defineConfig({
  resolve: {
    alias: mocked.map((name) => ({
      find: new RegExp(`^${name}$`),
      replacement: fromFunctions.resolve(name),
    })),
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
});
