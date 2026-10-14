import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  nodeMajor,
  supportedNodeVersion,
  versionMessage,
} from '../../scripts/verify-node-version.mjs';

test('Node 24 version diagnostics accept only the documented LTS line', () => {
  assert.equal(nodeMajor('24.11.1'), 24);
  assert.equal(supportedNodeVersion('24.0.0'), true);
  assert.equal(supportedNodeVersion('20.19.0'), false);
  assert.equal(supportedNodeVersion('25.0.0'), false);
  assert.match(versionMessage('20.19.0'), /requires Node 24 LTS/);
  assert.match(versionMessage('20.19.0'), /nvm install 24/);
});

test('root check runs server tests before the frontend build and propagates failures', () => {
  const rootPackage = JSON.parse(
    readFileSync(join(fileURLToPath(new URL('../..', import.meta.url)), 'package.json'), 'utf8')
  );
  assert.equal(rootPackage.scripts.check, 'npm run test --prefix server && npm run build');
});
