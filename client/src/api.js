const URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

async function request(path, options = {}) {
  const res = await fetch(`${URL}${path}`, {
    credentials: 'include', // send cookies
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(body?.error || `Request failed: ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const api = {
  // Auth
  signup: (email, password, displayName) =>
    request('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, displayName }) }),
  signin: (email, password) =>
    request('/auth/signin', { method: 'POST', body: JSON.stringify({ email, password }) }),
  signout: () => request('/auth/signout', { method: 'POST' }),
  me: () => request('/auth/me'),
  verifyEmail: (token) => request('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }),
  resendVerification: () => request('/auth/resend-verification', { method: 'POST' }),
  requestPasswordReset: (email) =>
    request('/auth/request-reset', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token, password) =>
    request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
  updateProfile: (displayName) =>
    request('/auth/me', { method: 'PATCH', body: JSON.stringify({ displayName }) }),
  history: () => request('/auth/me/history'),
  googleStatus: () => request('/auth/status'),
  // Server URL exposed for OAuth redirect
  serverUrl: URL,
};