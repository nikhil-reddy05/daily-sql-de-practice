import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Loaded with --import before any test module imports db.js.
const repositoryRoot = join(import.meta.dirname, '..', '..');
export const realDataDbPath = join(repositoryRoot, 'data', 'app.db');
export const realDataDbBefore = existsSync(realDataDbPath) ? readFileSync(realDataDbPath) : null;
const testDataDir = mkdtempSync(join(tmpdir(), 'daily-sql-de-practice-'));
process.env.SQL_PRACTICE_DATA_DIR = testDataDir;
process.env.TOKENS_KEY = 'test-only-key-do-not-use';
process.env.SESSION_SECRET = 'test-only-session-secret-do-not-use';

process.on('exit', () => {
  rmSync(testDataDir, { recursive: true, force: true });
});
