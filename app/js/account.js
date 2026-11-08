// The 128bit family account: the same Supabase project and sign-in as
// 128bit Play, Tracker and FIT (plain fetch to Supabase Auth, like FIT's
// lib/family/client.ts), so one email + password works in every 128bit app.

export const FAMILY = {
  url: 'https://wvflpwtaszpstmjpkrhu.supabase.co',
  key: 'sb_publishable_dO8uP74cTV1tbuqESgxysw_323C7lWh', // publishable: safe in the app
};

const KEY = 'bitrecipe.session';
let session = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } })();
const store = (s) => { session = s; try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* private mode */ } };

export const signedIn = () => !!session?.refresh_token;
export const accountEmail = () => session?.email || null;

function friendly(status, body) {
  const msg = (body?.error_description || body?.msg || body?.message || body?.error || '').toString();
  if (/invalid login credentials/i.test(msg)) return 'That email and password don’t match a 128bit account.';
  if (/email not confirmed/i.test(msg)) return 'Confirm your email first — check your inbox for the 128bit link, then sign in.';
  if (/already registered|already been registered|user already exists/i.test(msg)) return 'That email already has a 128bit account. Sign in instead.';
  if (/password.*(at least|short|weak)/i.test(msg)) return msg;
  if (/rate limit|too many/i.test(msg) || status === 429) return 'Too many tries. Wait a minute and try again.';
  if (status === 401 || status === 403) return 'Signed out. Sign in again.';
  return msg || `The 128bit server answered ${status}.`;
}

async function auth(path, body) {
  let res;
  try {
    res = await fetch(`${FAMILY.url}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: FAMILY.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch { throw new Error('Can’t reach the 128bit server. Check your connection.'); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendly(res.status, json));
  return json;
}

function keep(json, email) {
  store({
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + (json.expires_in || 3600) * 1000,
    email: json.user?.email || email,
    user_id: json.user?.id,
  });
}

export async function signIn(email, password) {
  const e = email.trim();
  if (!e || !password) throw new Error('Enter your email and password.');
  keep(await auth('token?grant_type=password', { email: e, password }), e);
}

// Returns 'signed-in', or 'confirm' when the server wants the email confirmed first.
export async function signUp(email, password) {
  const e = email.trim();
  if (!e || !password) throw new Error('Enter an email and a password.');
  if (password.length < 6) throw new Error('Use a password of at least 6 characters.');
  const json = await auth('signup', { email: e, password });
  if (json.access_token) { keep(json, e); return 'signed-in'; }
  return 'confirm';
}

export async function resetPassword(email) {
  if (!email.trim()) throw new Error('Type your email first.');
  await auth('recover', { email: email.trim() });
}

export async function signOut() {
  const s = session;
  store(null);
  if (s?.access_token) fetch(`${FAMILY.url}/auth/v1/logout`, { method: 'POST', headers: { apikey: FAMILY.key, Authorization: `Bearer ${s.access_token}` } }).catch(() => {});
}

let refreshing = null;
async function token() {
  if (!session) throw new Error('Sign in first.');
  if (Date.now() < session.expires_at - 60000) return session.access_token;
  refreshing ||= auth('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
    .then((json) => keep(json, session.email))
    .catch((e) => { if (/Signed out|match|invalid|not found/i.test(e.message)) store(null); throw e; })
    .finally(() => { refreshing = null; });
  await refreshing;
  return session.access_token;
}

// Signed-in call to the database API (REST tables + rpc functions).
export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const go = async () => fetch(`${FAMILY.url}/rest/v1/${path}`, {
    method,
    headers: { apikey: FAMILY.key, Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', ...headers },
    body: body == null ? undefined : JSON.stringify(body),
  });
  let res;
  try { res = await go(); } catch (e) { if (/Sign in/.test(e.message)) throw e; throw new Error('Can’t reach the 128bit server. Check your connection.'); }
  if (res.status === 401 && session) { session.expires_at = 0; res = await go(); }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.message || '';
    if (/bitrecipe_items|bitrecipe_push|does not exist|schema cache/i.test(msg)) throw new Error('The 128bit server isn’t set up for bitrecipe yet (run supabase/bitrecipe-sync.sql).');
    throw new Error(friendly(res.status, json));
  }
  return json;
}
