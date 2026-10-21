import { API_BASE, DEMO_ENABLED } from './runtime-config.js';

let accessToken = '', user = null, revision = 0, sessionGeneration = 0, refreshPromise = null;
export const connected = Boolean(API_BASE);
export const demoEnabled = DEMO_ENABLED;
export const currentUser = () => user;

// Refresh cookies are shared by every tab at this frontend origin. Web Locks
// serialize rotations and login/logout across tabs without exposing any token.
function sessionRequest(path, body) {
  const request = () => api(path, 'POST', body, false);
  return globalThis.navigator?.locks?.request
    ? navigator.locks.request(`nexus-session:${API_BASE}`, request)
    : request();
}

export async function api(path, method = 'GET', body, retry = true) {
  const requestToken = accessToken;
  const requestGeneration = sessionGeneration;
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(requestToken ? { Authorization: `Bearer ${requestToken}` } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
  } catch (cause) {
    throw new Error('Could not reach the server. Check your connection and try again.', { cause });
  }
  if (requestGeneration !== sessionGeneration) throw new Error('Your session changed. Sign in again.');
  // Several parallel reads may expire together. Rotate once and reuse the new
  // token, including for a late 401 received after another request has refreshed.
  if (response.status === 401 && retry && !path.startsWith('/api/auth/')) {
    if (!accessToken || accessToken === requestToken) await refresh();
    return api(path, method, body, false);
  }
  let data;
  try { data = await response.json(); }
  catch {
    throw Object.assign(new Error(response.ok
      ? 'The server returned an unreadable response. Please try again.'
      : `Request failed (${response.status}). Please try again.`), { status: response.status });
  }
  if (!response.ok) throw Object.assign(new Error(
    typeof data?.error === 'string' ? data.error : `Request failed (${response.status}).`
  ), { status: response.status });
  return data;
}

export function refresh() {
  if (refreshPromise) return refreshPromise;
  const generation = sessionGeneration;
  refreshPromise = (async () => {
    try {
      const data = await sessionRequest('/api/auth/refresh', {});
      if (generation !== sessionGeneration) throw new Error('Your session changed. Sign in again.');
      accessToken = data.accessToken;
      user = data.user;
      return user;
    } catch (error) {
      if (error.status === 401 && generation === sessionGeneration) {
        accessToken = '';
        user = null;
        revision = 0;
      }
      throw error;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function signIn(mode, data) {
  const generation = ++sessionGeneration;
  if (refreshPromise) await refreshPromise.catch(() => {});
  const result = await sessionRequest(`/api/auth/${mode}`, data);
  if (result.accessToken && generation === sessionGeneration) {
    accessToken = result.accessToken;
    user = result.user;
    revision = 0;
  }
  return result;
}

export async function signOut() {
  sessionGeneration++;
  accessToken = '';
  user = null;
  revision = 0;
  // A refresh response may set a newer cookie. Let it settle before revoking the
  // session so that logout cannot be undone by that response arriving later.
  if (refreshPromise) await refreshPromise.catch(() => {});
  await sessionRequest('/api/auth/logout', {});
}

export async function loadRemote() {
  const data = await api('/api/workspace');
  revision = data.revision;
  return data.state;
}
export async function saveRemote(state) {
  const result = await api('/api/workspace', 'PUT', { state, revision });
  revision = result.revision;
  return result.state;
}
