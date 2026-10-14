const DEFAULT_VITE_ORIGIN = 'http://127.0.0.1:5173';

function normalizedOrigin(value) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isLoopbackOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

// The Vite server is a separate local origin in development. It is an explicit
// allow-list entry, never a pattern or a caller-provided Origin.
export function configuredDevOrigin(value = process.env.VITE_ORIGIN || DEFAULT_VITE_ORIGIN) {
  const origin = normalizedOrigin(value);
  return origin && isLoopbackOrigin(origin) ? origin : null;
}

export function canonicalOrigin(port) {
  return `http://127.0.0.1:${port}`;
}

function requestOriginIsAllowed(req, allowedOrigins) {
  const origin = normalizedOrigin(req.get('origin'));
  return origin !== null && allowedOrigins.has(origin);
}

function noOriginRequestIsLocal(req) {
  const site = (req.get('sec-fetch-site') || '').toLowerCase();
  // Browsers attach Fetch Metadata.  A request that identifies itself as
  // cross-site (or same-site but not same-origin) is never a trusted CLI.
  // Header-less requests are deliberately supported for local scripts/tests.
  return !site || site === 'same-origin' || site === 'none';
}

function deny(res) {
  return res.status(403).json({ error: 'Forbidden' });
}

/**
 * Apply the local HTTP boundary before any route has a chance to mutate data
 * or trigger an AI request. The bound socket is loopback-only; Host checking
 * additionally prevents a loopback DNS-rebinding request from being treated
 * as a request from this app's origin.
 */
export function localHttpSecurity({ getPort, devOrigin = configuredDevOrigin() } = {}) {
  if (typeof getPort !== 'function') throw new Error('localHttpSecurity requires getPort');

  return (req, res, next) => {
    const canonical = canonicalOrigin(getPort());
    const expectedHost = new URL(canonical).host;
    if ((req.get('host') || '').toLowerCase() !== expectedHost) return deny(res);

    const allowedOrigins = new Set([canonical]);
    if (devOrigin) allowedOrigins.add(devOrigin);

    const isUnsafeMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    const isSideEffectingToday = req.method === 'GET' && req.path === '/api/today';
    if (!isUnsafeMethod && !isSideEffectingToday) return next();

    if (req.get('origin')) {
      return requestOriginIsAllowed(req, allowedOrigins) ? next() : deny(res);
    }
    return noOriginRequestIsLocal(req) ? next() : deny(res);
  };
}
