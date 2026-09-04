// GitHub Actions（scripts/scrape.js）専用。登録済み全ユーザーのお気に入り設定と
// Web Push購読情報をまとめて返す。全員分の購読情報を一括で含むため、
// お気に入りAPIと違い常にトークン必須で保護する。

const { isConfigured, kvGet, checkToken } = require('./_kv');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (!isConfigured()) {
    res.status(500).json({ success: false, error: 'KVストレージが設定されていません' });
    return;
  }

  if (!process.env.FAVORITES_API_TOKEN || !checkToken(req)) {
    res.status(403).json({ success: false, error: 'トークンが一致しません' });
    return;
  }

  try {
    const userIds = (await kvGet('tennis-monitor:users')) || ['me'];
    const users = [];
    for (const userId of userIds) {
      const favorites = (await kvGet(`tennis-monitor:favorites:${userId}`)) || { facilityIds: [], notifyFavoritesOnly: false };
      const subscription = await kvGet(`tennis-monitor:push:${userId}`);
      users.push({ id: userId, ...favorites, subscription: subscription || null });
    }
    res.status(200).json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
