// Upstash(Vercel KV)への簡易アクセスヘルパー。api/配下の各エンドポイントから共有で使う。

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

function isConfigured() {
  return Boolean(KV_URL && KV_TOKEN);
}

async function kvGet(key) {
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function kvSet(key, value) {
  await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(value)
  });
}

function checkToken(req) {
  const expected = process.env.FAVORITES_API_TOKEN;
  if (!expected) return true; // トークン未設定なら保護なし（開発時のみ想定）
  const provided = req.headers['x-favorites-token'];
  return provided === expected;
}

function sanitizeUserId(raw) {
  const id = (raw || 'me').toString().trim();
  // キー衝突・注入対策として英数とハイフン・アンダースコアのみ許可
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id) ? id : 'me';
}

async function registerUser(userId) {
  const users = (await kvGet('tennis-monitor:users')) || [];
  if (!users.includes(userId)) {
    users.push(userId);
    await kvSet('tennis-monitor:users', users);
  }
}

module.exports = { isConfigured, kvGet, kvSet, checkToken, sanitizeUserId, registerUser };
