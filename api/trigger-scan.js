// 「今すぐスキャン」ボタンから呼ばれるエンドポイント。
// GitHub Actions の workflow_dispatch を、サーバー側に保管したPATで代理実行する。
// PATをブラウザに一切渡さないことで、キーの漏洩を防ぐ。

const OWNER = 'kmiura5377';
const REPO = 'tennis-auto-monitor';
const WORKFLOW_FILE = 'monitor.yml';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'POSTのみ対応しています' });
    return;
  }

  const token = process.env.GITHUB_PAT;
  if (!token) {
    res.status(500).json({ success: false, error: 'サーバー側にGITHUB_PATが設定されていません' });
    return;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'tennis-auto-monitor-trigger'
  };

  try {
    // 既に実行中/待機中のワークフローがあれば、二重起動せず知らせる
    const runsRes = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?status=in_progress&per_page=1`,
      { headers }
    );
    const runsData = await runsRes.json();
    if (runsData.total_count > 0) {
      res.status(200).json({ success: true, alreadyRunning: true, message: 'すでにスキャンが実行中です' });
      return;
    }

    const queuedRes = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?status=queued&per_page=1`,
      { headers }
    );
    const queuedData = await queuedRes.json();
    if (queuedData.total_count > 0) {
      res.status(200).json({ success: true, alreadyRunning: true, message: 'すでにスキャンが待機中です' });
      return;
    }

    const dispatchRes = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ ref: 'main' })
      }
    );

    if (dispatchRes.status !== 204) {
      const errText = await dispatchRes.text();
      res.status(502).json({ success: false, error: `GitHub API error: ${dispatchRes.status} ${errText}` });
      return;
    }

    res.status(200).json({ success: true, alreadyRunning: false, message: 'スキャンを開始しました' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
