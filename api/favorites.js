// 利用者ごとのお気に入り設定。
// GET: 誰でも閲覧可（非機密データ）。?u=<userId> で対象ユーザーを指定（省略時は "me"）。
// POST: 簡易トークンで保護（本格的な認証ではなく、悪戯防止程度のもの）。

const { isConfigured, kvGet, kvSet, checkToken, sanitizeUserId, registerUser } = require('./_kv');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

  const userId = sanitizeUserId(req.query?.u);
  const key = `tennis-monitor:favorites:${userId}`;

  try {
    if (req.method === 'GET') {
      const data = (await kvGet(key)) || { facilityIds: [], notifyFavoritesOnly: false };
      res.status(200).json({ success: true, ...data });
      return;
    }

    if (req.method === 'POST') {
      if (!checkToken(req)) {
        res.status(403).json({ success: false, error: 'トークンが一致しません' });
        return;
      }

      const body = req.body || {};
      const facilityIds = Array.isArray(body.facilityIds) ? body.facilityIds : [];
      const notifyFavoritesOnly = Boolean(body.notifyFavoritesOnly);
      await kvSet(key, { facilityIds, notifyFavoritesOnly });
      await registerUser(userId);
      res.status(200).json({ success: true, facilityIds, notifyFavoritesOnly });
      return;
    }

    res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
