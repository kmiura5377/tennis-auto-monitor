// お気に入り施設の共有保存先。
// GET: 誰でも閲覧可（非機密データ）。GitHub Actions もここを読みに来る。
// POST: 簡易トークンで保護（本格的な認証ではなく、悪戯防止程度のもの）。

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KEY = 'tennis-monitor:favorites';

async function kvGet() {
  const res = await fetch(`${KV_URL}/get/${KEY}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const data = await res.json();
  if (!data.result) return { facilityIds: [], notifyFavoritesOnly: false };
  return JSON.parse(data.result);
}

async function kvSet(value) {
  await fetch(`${KV_URL}/set/${KEY}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(value)
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Favorites-Token');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (!KV_URL || !KV_TOKEN) {
    res.status(500).json({ success: false, error: 'KVストレージが設定されていません' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const data = await kvGet();
      res.status(200).json({ success: true, ...data });
      return;
    }

    if (req.method === 'POST') {
      const expectedToken = process.env.FAVORITES_API_TOKEN;
      const providedToken = req.headers['x-favorites-token'];
      if (expectedToken && providedToken !== expectedToken) {
        res.status(403).json({ success: false, error: 'トークンが一致しません' });
        return;
      }

      const body = req.body || {};
      const facilityIds = Array.isArray(body.facilityIds) ? body.facilityIds : [];
      const notifyFavoritesOnly = Boolean(body.notifyFavoritesOnly);
      await kvSet({ facilityIds, notifyFavoritesOnly });
      res.status(200).json({ success: true, facilityIds, notifyFavoritesOnly });
      return;
    }

    res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
