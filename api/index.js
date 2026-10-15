const path = require('node:path');
const { createRequestHandler } = require('expo-server/adapter/vercel');

const handleRequest = createRequestHandler({
  build: path.join(process.cwd(), 'apps/client/dist/server'),
});

const publicEntries = {
  '/signup': 'activate',
  '/auth': 'sign-in',
  '/forgot-password': 'recover',
  '/reset-password': 'reset',
};

module.exports = (request, response) => {
  // Vercel retains the original URL when routing middleware rewrites to this
  // catch-all function. Resolve public entries before Expo chooses a static page.
  if (request.method === 'GET' || request.method === 'HEAD') {
    const url = new URL(request.url, 'http://adapter.local');
    if (publicEntries[url.pathname]) {
      url.searchParams.set('view', publicEntries[url.pathname]);
      request.url = `/api/auth/entry${url.search}`;
    } else if (
      url.pathname === '/staff-activate' ||
      (url.pathname === '/mfa' && url.searchParams.has('invitation'))
    ) {
      request.url = `/api/auth/staff${url.search}`;
    }
  }
  return handleRequest(request, response);
};
