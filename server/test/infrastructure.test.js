import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, sep } from 'node:path';
import { dataDir, dbPath } from '../db.js';
import { startServer } from '../index.js';
import { realDataDbBefore, realDataDbPath } from './setup.js';

test('test database is isolated in an OS temporary directory', () => {
  const relativeTempPath = relative(tmpdir(), dataDir);

  assert.ok(isAbsolute(dataDir));
  assert.ok(relativeTempPath && relativeTempPath !== '..' && !relativeTempPath.startsWith(`..${sep}`));
  assert.ok(dbPath.startsWith(dataDir));
  assert.ok(existsSync(dbPath));
  assert.notEqual(dbPath, realDataDbPath);
  const realDbAfter = existsSync(realDataDbPath) ? readFileSync(realDataDbPath) : null;
  assert.deepEqual(realDbAfter, realDataDbBefore);
});

test('ephemeral server serves default settings and uses the fake OIDC hook', async () => {
  let oidcCalls = 0;
  const instance = await startServer({
    port: 0,
    startup: {
      cryptoBootWarnings: () => {},
      validateOpenIdConfiguration: () => {
        oidcCalls += 1;
      },
    },
  });

  try {
    const response = await fetch(`http://127.0.0.1:${instance.port}/api/settings`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      sql_enabled: true,
      de_enabled: true,
      sql_count: 2,
      de_count: 2,
      sql_dialect: 'PostgreSQL 15',
    });
    assert.equal(oidcCalls, 1);
  } finally {
    await instance.close();
  }

  assert.equal(instance.server.listening, false);
});
