export interface ReviewerWorkerEnv {
  API_ORIGIN: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const reviewerProxyPath = /^\/api\/v1\/(reviewer|admin)(\/|$)/;
const guestProxyPath = /^\/api\/v1\/guest(\/|$)/;

export async function handleReviewerRequest(request: Request, env: ReviewerWorkerEnv): Promise<Response> {
  const sourceUrl = new URL(request.url);
  const guestHost = sourceUrl.hostname.startsWith('guest.');
  if (!sourceUrl.pathname.startsWith('/api/')) {
    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers); headers.set('Cache-Control', 'no-store'); headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
  }
  if (!(guestHost ? guestProxyPath : reviewerProxyPath).test(sourceUrl.pathname)) {
    return Response.json({ error: { code: 'NOT_FOUND', message: 'Private route not found.' } }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!assertion) {
    return Response.json({ error: { code: 'ACCESS_REQUIRED', message: 'Authentication is required.' } }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const targetUrl = new URL(sourceUrl.pathname.slice(4) + sourceUrl.search, env.API_ORIGIN);
  const headers = new Headers(request.headers);
  headers.delete('Cookie');
  headers.delete('Host');
  headers.set('Cf-Access-Jwt-Assertion', assertion);
  return fetch(new Request(targetUrl, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  }));
}

export default { fetch: handleReviewerRequest };
