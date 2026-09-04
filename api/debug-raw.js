// 一時的なデータ移行確認用。用が済んだら削除する。
const { isConfigured, kvGet, kvSet, checkToken } = require('./_kv');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (!isConfigured() || !checkToken(req)) {
    res.status(403).json({ success: false });
    return;
  }

  if (req.query?.cleanupTestFriend === '1') {
    await kvSet('tennis-monitor:users', ['me']);
    await kvSet('tennis-monitor:favorites:test-friend', { facilityIds: [], notifyFavoritesOnly: false });
    await kvSet('tennis-monitor:push:test-friend', null);
    res.status(200).json({ success: true, cleaned: true });
    return;
  }

  const oldFavorites = await kvGet('tennis-monitor:favorites');
  const users = await kvGet('tennis-monitor:users');
  res.status(200).json({ success: true, oldFavorites, users });
};
