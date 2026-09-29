import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // SQLite files and temp dirs are per-test; keep them isolated.
    pool: 'forks',
    /*
     * scrypt is deliberately slow -- it is what makes a stored password hard to
     * attack -- and the tests that exercise sign-in run it once per attempt,
     * five attempts to a test. The 5s default is not sized for that: with 23
     * forks sharing a CPU, `auth.test.ts` and the DNS guard test time out while
     * passing comfortably on their own. This is a budget for a known cost
     * rather than a way to hide a hang -- a real hang now has four times longer
     * to show itself, and it still fails.
     */
    testTimeout: 20_000,
  },
});
