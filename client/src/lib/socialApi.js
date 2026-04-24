/**
 * Social posts fetchers — thin client-side wrappers around the
 * server's /api/social/* endpoints. The server does the heavy lifting
 * (paging, retries, rate-limit slot) so these stay simple.
 *
 * Every fetcher returns posts already normalized into the canonical
 * shape defined in socialAnalytics.js :: normalizePost, so every
 * downstream consumer (page, store, analytics) works with one shape.
 */

import { normalizePost } from './socialAnalytics';

async function post(endpoint, body) {
  const res = await fetch(endpoint, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

/* Verify a Meta token: returns discoverable Pages (each with its
   linked Instagram business account, if any) and the list of missing
   scopes so the Setup UI can tell the user exactly what to regenerate. */
export async function verifySocialToken(token, apiVersion = 'v21.0') {
  return post('/api/social/verify', { token, apiVersion });
}

export async function pullInstagram({ token, apiVersion = 'v21.0', igUserId, brandId, limit = 200, sinceDays = 90, includeComments = true }) {
  const { posts = [], stats = null } = await post('/api/social/pull-ig', { token, apiVersion, igUserId, limit, sinceDays, includeComments });
  const normalized = posts.map(raw => normalizePost('instagram', raw, { brandId }));
  normalized._stats = stats;
  return normalized;
}

export async function pullFacebook({ pageAccessToken, apiVersion = 'v21.0', pageId, brandId, limit = 200, sinceDays = 90, includeComments = true }) {
  const { posts = [], stats = null } = await post('/api/social/pull-fb', { pageAccessToken, apiVersion, pageId, limit, sinceDays, includeComments });
  const normalized = posts.map(raw => normalizePost('facebook', raw, { brandId }));
  normalized._stats = stats;
  return normalized;
}
