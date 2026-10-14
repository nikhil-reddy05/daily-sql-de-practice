import { startServer } from './index.js';
import { redirectUri } from './auth.js';

// In development the browser is served by Vite. OAuth returns through Vite's
// loopback-only /api proxy, then lands back on the visible development UI.
const appUrl = 'http://127.0.0.1:5173';

startServer({ appUrl })
  .then(({ port }) => {
    console.log(`daily-sql-de-practice dev API listening on http://127.0.0.1:${port}`);
    console.log(`Sign-in callback: ${redirectUri(port, appUrl)}`);
  })
  .catch((err) => {
    console.error(`Could not start server: ${err.message}`);
    process.exitCode = 1;
  });
