import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

test.each(['default', 'trailing data slash', 'trailing script slash'])(
  'entrypoint creates script storage without changing repository file ownership (%s)', (variant) => {
    const scratch = fileURLToPath(new URL('../../../tmp/', import.meta.url));
    mkdirSync(scratch, { recursive: true });
    const root = mkdtempSync(join(scratch, 'dashboard-entrypoint-'));
    try {
      const data = join(root, 'data');
      const bin = join(root, 'bin');
      const log = join(root, 'chown.log');
      mkdirSync(data);
      mkdirSync(bin);
      writeFileSync(join(data, 'secret.key'), 'test');
      // Stub privileged commands so this test is safe for both root and ordinary users.
      writeFileSync(join(bin, 'id'), '#!/bin/sh\necho 0\n', { mode: 0o755 });
      writeFileSync(join(bin, 'chown'), '#!/bin/sh\nprintf "%s\\n" "$@" >> "$CHOWN_LOG"\n', { mode: 0o755 });
      writeFileSync(join(bin, 'setpriv'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DATA_DIR: data, CHOWN_LOG: log };
      delete env.SCRIPT_ROOT_CONTAINER;
      if (variant === 'trailing data slash') env.DATA_DIR = `${data}/`;
      if (variant === 'trailing script slash') env.SCRIPT_ROOT_CONTAINER = `${data}/scripts/`;
      const entrypoint = fileURLToPath(new URL('../../../docker-entrypoint.sh', import.meta.url));
      const run = () => spawnSync('sh', [entrypoint, 'true'], { env, encoding: 'utf8' });
      expect(run().status).toBe(0);
      expect(existsSync(join(data, 'scripts'))).toBe(true);
      mkdirSync(join(data, 'scripts', 'repo'));
      const script = join(data, 'scripts', 'repo', 'run.sh');
      writeFileSync(script, 'echo test');
      expect(run().status).toBe(0);
      const ownershipChanges = readFileSync(log, 'utf8');
      expect(ownershipChanges).toContain(join(data, 'secret.key'));
      expect(ownershipChanges).not.toContain('-R');
      expect(ownershipChanges).not.toContain(script);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
