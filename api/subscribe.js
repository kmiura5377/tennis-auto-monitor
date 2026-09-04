// 利用者ごとのWeb Push購読情報の保存先。
// POST: 簡易トークンで保護。?u=<userId> で対象ユーザーを指定（省略時は "me"）。

const { isConfigured, kvSet, checkToken, sanitizeUserId, registerUser } = require('./_kv');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Favorites-Token');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (!isConfigured()) {
    res.status(500).json({ success: false, error: 'KVストレージが設定されていません' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  if (!checkToken(req)) {
    res.status(403).json({ success: false, error: 'トークンが一致しません' });
    return;
  }

  const userId = sanitizeUserId(req.query?.u);
  const body = req.body || {};

  if (!body.subscription || !body.subscription.endpoint) {
    res.status(400).json({ success: false, error: 'subscriptionが不正です' });
    return;
  }

  try {
    await kvSet(`tennis-monitor:push:${userId}`, body.subscription);
    await registerUser(userId);
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
