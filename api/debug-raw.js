// 一時的なデータ移行確認用。用が済んだら削除する。
const { isConfigured, kvGet, checkToken } = require('./_kv');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (!isConfigured() || !checkToken(req)) {
    res.status(403).json({ success: false });
    return;
  }
  const oldFavorites = await kvGet('tennis-monitor:favorites');
  const users = await kvGet('tennis-monitor:users');
  res.status(200).json({ success: true, oldFavorites, users });
};
