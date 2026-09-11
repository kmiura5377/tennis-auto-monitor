// 東京都立公園テニスコート 空き状況スクレイパー
// GitHub Actions から実行される想定。実ブラウザ(Playwright)で予約サイトを操作し、
// 週表示カレンダーを直近4週間分ページ送りしてデータを取得する。
// 月表示APIはヘッドレスブラウザからの応答が得られなかったため使用しない。
// 施設は SCRAPE_CONCURRENCY 件ずつ並行処理する（実行時間短縮のため）。

const { chromium } = require('playwright');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

// index.html に埋め込まれている公開鍵と同一のもの（公開鍵なので秘匿不要）
const VAPID_PUBLIC_KEY = 'BNpuNfvpkX-8XMwnvBU4K7cykGDCEh6uSR7IwtKEfQJh4E-qus2N1PigdmjcnPIs-G7bvgO_2dNjKSQS9FRgVI8';

const BASE_URL = 'https://kouen.sports.metro.tokyo.lg.jp/web/index.jsp';
const WEEKS_TO_FETCH = 4;
const SCRAPE_CONCURRENCY = 5;

// この割合以上の施設で取得に失敗したら「予約サイト側からアクセス制限を受けた可能性」と
// みなし、緊急通知を送った上でこの自動実行(GitHub Actionsのスケジュール)自体を無効化する。
const BLOCK_SUSPECTED_THRESHOLD = 0.5;

// テニス（ハード）4施設 + テニス（人工芝）27施設 = 全31施設
// （大井ふ頭海浜公園Ｂは両方の区分に存在するため、別施設として扱う）
const FACILITIES = [
  // ハード
  { id: 'oi_a_hard', name: '大井ふ頭海浜公園Ａ（ハード）', purpose: 'テニス（ハード）', park: '大井ふ頭海浜公園Ａ' },
  { id: 'oi_b_hard', name: '大井ふ頭海浜公園Ｂ（ハード）', purpose: 'テニス（ハード）', park: '大井ふ頭海浜公園Ｂ' },
  { id: 'ariake_a_hard', name: '有明テニスＡ屋外ハードコート', purpose: 'テニス（ハード）', park: '有明テニスＡ屋外ハードコート' },
  { id: 'ariake_b_hard', name: '有明テニスＢインドアコート', purpose: 'テニス（ハード）', park: '有明テニスＢインドアコート' },

  // 人工芝
  { id: 'hibiya', name: '日比谷公園（人工芝）', purpose: 'テニス（人工芝）', park: '日比谷公園' },
  { id: 'shiba', name: '芝公園（人工芝）', purpose: 'テニス（人工芝）', park: '芝公園' },
  { id: 'sarue', name: '猿江恩賜公園（人工芝）', purpose: 'テニス（人工芝）', park: '猿江恩賜公園' },
  { id: 'kameido', name: '亀戸中央公園（人工芝）', purpose: 'テニス（人工芝）', park: '亀戸中央公園' },
  { id: 'kiba', name: '木場公園（人工芝）', purpose: 'テニス（人工芝）', park: '木場公園' },
  { id: 'soshigaya', name: '祖師谷公園（人工芝）', purpose: 'テニス（人工芝）', park: '祖師谷公園' },
  { id: 'higashishirahige', name: '東白鬚公園（人工芝）', purpose: 'テニス（人工芝）', park: '東白鬚公園' },
  { id: 'ukima', name: '浮間公園（人工芝）', purpose: 'テニス（人工芝）', park: '浮間公園' },
  { id: 'johoku', name: '城北中央公園（人工芝）', purpose: 'テニス（人工芝）', park: '城北中央公園' },
  { id: 'akatsuka', name: '赤塚公園（人工芝）', purpose: 'テニス（人工芝）', park: '赤塚公園' },
  { id: 'higashiayase', name: '東綾瀬公園（人工芝）', purpose: 'テニス（人工芝）', park: '東綾瀬公園' },
  { id: 'toneri', name: '舎人公園（人工芝）', purpose: 'テニス（人工芝）', park: '舎人公園' },
  { id: 'shinozaki_a', name: '篠崎公園Ａ（人工芝）', purpose: 'テニス（人工芝）', park: '篠崎公園Ａ' },
  { id: 'oojima_komatsugawa', name: '大島小松川公園（人工芝）', purpose: 'テニス（人工芝）', park: '大島小松川公園' },
  { id: 'shioiri', name: '汐入公園（人工芝）', purpose: 'テニス（人工芝）', park: '汐入公園' },
  { id: 'takaido', name: '高井戸公園（人工芝）', purpose: 'テニス（人工芝）', park: '高井戸公園' },
  { id: 'zenpukuji', name: '善福寺川緑地（人工芝）', purpose: 'テニス（人工芝）', park: '善福寺川緑地' },
  { id: 'hikarigaoka', name: '光が丘公園（人工芝）', purpose: 'テニス（人工芝）', park: '光が丘公園' },
  { id: 'shakujii_b', name: '石神井公園Ｂ（人工芝）', purpose: 'テニス（人工芝）', park: '石神井公園Ｂ' },
  { id: 'inokashira', name: '井の頭恩賜公園（人工芝）', purpose: 'テニス（人工芝）', park: '井の頭恩賜公園' },
  { id: 'musashino_chuo', name: '武蔵野中央公園（人工芝）', purpose: 'テニス（人工芝）', park: '武蔵野中央公園' },
  { id: 'koganei', name: '小金井公園（人工芝）', purpose: 'テニス（人工芝）', park: '小金井公園' },
  { id: 'nogawa', name: '野川公園（人工芝）', purpose: 'テニス（人工芝）', park: '野川公園' },
  { id: 'fuchu_no_mori', name: '府中の森公園（人工芝）', purpose: 'テニス（人工芝）', park: '府中の森公園' },
  { id: 'higashiyamato_minami', name: '東大和南公園（人工芝）', purpose: 'テニス（人工芝）', park: '東大和南公園' },
  { id: 'oi_b_turf', name: '大井ふ頭海浜公園Ｂ（人工芝）', purpose: 'テニス（人工芝）', park: '大井ふ頭海浜公園Ｂ' },
  { id: 'ariake_c_turf', name: '有明テニスＣ人工芝コート', purpose: 'テニス（人工芝）', park: '有明テニスＣ人工芝コート' }
];

// 週表示テーブルの td id は "YYYYMMDD_XX" 形式。XXは30分刻みではなく2時間帯コード。
const SLOT_CODE_TO_TIME = {
  10: '07:00-09:00',
  20: '09:00-11:00',
  30: '11:00-13:00',
  40: '13:00-15:00',
  50: '15:00-17:00',
  60: '17:00-19:00',
  70: '19:00-21:00'
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function closeNoticeDialogs(page) {
  const closeButtons = await page.locator('button:has-text("閉じる")').all();
  for (const btn of closeButtons) {
    try { await btn.click({ timeout: 1000 }); } catch (e) { /* ignore */ }
  }
}

async function waitLoadingHidden(page) {
  await page.waitForSelector('#loadmsg', { state: 'hidden', timeout: 15000 }).catch(() => {});
}

async function waitWeekPopulated(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('#week-info');
    return el && el.innerHTML.trim().length > 50;
  }, { timeout: 25000 });
}

// #week-info の innerHTML から { 'YYYY-MM-DD': [{time, available}] } を抽出
async function parseWeekTable(page) {
  return page.evaluate(() => {
    const table = document.querySelector('#week-info');
    if (!table) return {};
    const cells = table.querySelectorAll('td[id]');
    const result = {};
    cells.forEach(td => {
      const m = td.id.match(/^(\d{8})_(\d+)$/);
      if (!m) return;
      const [, ymd, code] = m;
      const dateStr = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
      const available = td.classList.contains('available');
      if (!result[dateStr]) result[dateStr] = {};
      result[dateStr][code] = available;
    });
    return result;
  });
}

function mergeParsedWeek(days, facility, parsed) {
  for (const [dateStr, codes] of Object.entries(parsed)) {
    if (!days[dateStr]) days[dateStr] = [];
    let entry = days[dateStr].find(e => e.facilityId === facility.id);
    if (!entry) {
      entry = { facilityId: facility.id, facility: facility.name, timeSlots: [] };
      days[dateStr].push(entry);
    }
    for (const [code, available] of Object.entries(codes)) {
      const time = SLOT_CODE_TO_TIME[Number(code)];
      if (!time) continue;
      if (!entry.timeSlots.some(s => s.time === time)) {
        entry.timeSlots.push({ time, available });
      }
    }
  }
}

async function scrapeFacility(browser, facility, days) {
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  try {
    console.log(`[${facility.id}] opening site`);
    await page.goto(BASE_URL, { waitUntil: 'load' });
    await closeNoticeDialogs(page);

    console.log(`[${facility.id}] selecting purpose: ${facility.purpose}`);
    const parkPopulated = page.waitForResponse(r => r.url().includes('Favorite2InfoBuildAjax'), { timeout: 20000 }).catch(() => {});
    await page.selectOption('#purpose-home', { label: facility.purpose });
    await parkPopulated;
    await sleep(1000);

    console.log(`[${facility.id}] selecting park: ${facility.park}`);
    await page.selectOption('#bname-home', { label: facility.park });
    await sleep(1500);

    console.log(`[${facility.id}] searching`);
    await page.click('#btn-go');
    await page.waitForLoadState('load');
    await sleep(2000);
    await waitLoadingHidden(page);

    // 施設(コート)選択: プレースホルダー以外の最初の選択肢を使う
    const facilityOptions = await page.locator('#facility-select option').evaluateAll(els =>
      els.map(e => ({ text: e.textContent, value: e.value })).filter(o => o.value !== '0')
    );
    if (facilityOptions.length === 0) {
      throw new Error('施設の選択肢が見つかりませんでした');
    }
    console.log(`[${facility.id}] selecting facility: ${facilityOptions[0].text}`);
    await page.selectOption('#facility-select', { label: facilityOptions[0].text });
    await waitLoadingHidden(page);
    await sleep(1000);

    await waitWeekPopulated(page);
    let parsed = await parseWeekTable(page);
    mergeParsedWeek(days, facility, parsed);
    let weekHead = await page.locator('#week-head').innerText().catch(() => '');
    console.log(`[${facility.id}] week 1 parsed (${Object.keys(parsed).length} dates, head=${weekHead})`);

    for (let w = 1; w < WEEKS_TO_FETCH; w++) {
      const prevDates = Object.keys(parsed).sort().join(',');
      let newDates = prevDates;
      let attempt = 0;

      while (newDates === prevDates && attempt < 4) {
        attempt++;
        // getWeekInfoAjax(4, 0, 0) is the exact handler bound to the "次週>>" link;
        // calling it directly is far more reliable than clicking the element.
        await page.evaluate(() => { if (typeof getWeekInfoAjax === 'function') getWeekInfoAjax(4, 0, 0); });
        await sleep(1500 + attempt * 500);
        await waitWeekPopulated(page).catch(() => {});
        parsed = await parseWeekTable(page);
        newDates = Object.keys(parsed).sort().join(',');
      }

      weekHead = await page.locator('#week-head').innerText().catch(() => '');
      if (newDates === prevDates) {
        console.log(`[${facility.id}] week ${w + 1} FAILED to advance after ${attempt} attempts, stopping pagination`);
        break;
      }

      mergeParsedWeek(days, facility, parsed);
      console.log(`[${facility.id}] week ${w + 1} parsed (${Object.keys(parsed).length} dates, attempts=${attempt}, head=${weekHead})`);
      await sleep(800);
    }

    console.log(`[${facility.id}] done`);
    return true;
  } catch (error) {
    console.error(`[${facility.id}] ERROR: ${error.message}`);
    return false;
  } finally {
    await page.close();
  }
}

function loadPreviousData(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return { days: {} };
  }
}

// 前回データと比較し、「前回は空きなし/未取得 → 今回は空きあり」になった枠を検出
function detectNewlyAvailable(previousDays, newDays) {
  const found = [];
  for (const [dateStr, facilities] of Object.entries(newDays)) {
    // ローリングウィンドウ（直近5週間分を毎回取得し直す方式）により、
    // 前回はまだ観測していなかった日が新しく取得範囲に入ってくることがある。
    // その日は「空きが増えた」わけではなく単に初めて見えただけなので、通知対象にしない。
    if (!Object.prototype.hasOwnProperty.call(previousDays, dateStr)) continue;

    for (const facility of facilities) {
      const prevFacility = previousDays[dateStr].find(f => f.facilityId === facility.facilityId);
      if (!prevFacility) continue; // この施設も前回未観測ならスキップ

      for (const slot of facility.timeSlots) {
        if (!slot.available) continue;
        const prevSlot = prevFacility.timeSlots.find(s => s.time === slot.time);
        const wasAvailable = prevSlot ? prevSlot.available : false;
        if (!wasAvailable) {
          found.push({ date: dateStr, facilityId: facility.facilityId, facility: facility.facility, time: slot.time });
        }
      }
    }
  }
  return found;
}

// slot.date（"YYYY-MM-DD"、日本時間の暦日）から表示用文字列を作る。
// GitHub Actionsの実行環境はUTCのため、new Date(...).getDate()等の
// ローカルタイムゾーン依存のgetterを使うと日付が1日ずれる。
// Date.UTC()で組み立てて getUTCDay() で読み戻すことで、実行環境の
// タイムゾーンに関係なく常に正しい日付・曜日になる。
function formatSlotLine(slot) {
  const [y, m, d] = slot.date.split('-').map(Number);
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d}(${weekday}) ${slot.time} ${slot.facility}`;
}

async function clearStaleSubscription(userId) {
  const token = process.env.FAVORITES_API_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://tennis-auto-monitor.vercel.app/api/subscribe?u=${encodeURIComponent(userId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Favorites-Token': token },
      body: JSON.stringify({ subscription: null })
    });
    console.log(`Cleared stale push subscription for ${userId}`);
  } catch (e) {
    console.error(`Failed to clear stale subscription for ${userId}:`, e.message);
  }
}

// 戻り値は診断用に呼び出し元へ結果を伝えるための構造体。
// { attempted, ok, statusCode, error, skippedReason }
async function sendRawPush(subscription, title, body, label) {
  const privateKey = process.env.PUSH_VAPID_PRIVATE_KEY;
  if (!subscription) return { attempted: false, ok: false, skippedReason: 'no_subscription' };
  if (!privateKey) return { attempted: false, ok: false, skippedReason: 'no_private_key_env' };

  webpush.setVapidDetails('mailto:example@example.com', VAPID_PUBLIC_KEY, privateKey);

  try {
    await webpush.sendNotification(subscription, JSON.stringify({ title, body, url: '/' }));
    console.log(`Push notification sent (${label})`);
    return { attempted: true, ok: true };
  } catch (e) {
    console.error(`Push notification failed (${label}):`, e.statusCode, e.message);
    // 410 Gone / 404 Not Found は「その端末でこの購読はもう存在しない」ことを意味する。
    // ブラウザ側で通知が解除された等の理由でよく起こるので、次回以降サイレントに
    // 送信し続けないよう、こちらの記録も削除しておく（ボタンは自動的に再表示される）。
    if (e.statusCode === 404 || e.statusCode === 410) {
      await clearStaleSubscription(label);
    }
    return { attempted: true, ok: false, statusCode: e.statusCode, error: e.body || e.message };
  }
}

async function sendRawLine(text) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) return;

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/broadcast', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ messages: [{ type: 'text', text }] })
    });
    if (!res.ok) {
      console.error('LINE broadcast failed:', res.status, await res.text());
    } else {
      console.log('LINE broadcast sent');
    }
  } catch (e) {
    console.error('LINE broadcast error:', e.message);
  }
}

async function sendPushNotification(subscription, newSlots, label) {
  if (!subscription) return { attempted: false, ok: false, skippedReason: 'no_subscription' };
  if (newSlots.length === 0) return { attempted: false, ok: false, skippedReason: 'no_new_slots' };
  newSlots.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const title = `🎾 新しい空きが見つかりました！（${newSlots.length}件）`;
  const body = newSlots.slice(0, 3).map(formatSlotLine).join('\n')
    + (newSlots.length > 3 ? `\n他 ${newSlots.length - 3}件` : '');
  return await sendRawPush(subscription, title, body, label);
}

async function sendLineNotification(newSlots) {
  if (newSlots.length === 0) return;
  newSlots.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const lines = newSlots.slice(0, 10).map(formatSlotLine);
  const text = `🎾 新しい空きが見つかりました！（${newSlots.length}件）\n`
    + lines.join('\n')
    + (newSlots.length > 10 ? `\n他 ${newSlots.length - 10}件` : '');
  await sendRawLine(text);
}

// 大部分の施設で取得失敗＝ボット判定/アクセス制限を受けた可能性がある場合の緊急対応。
// 全利用者に警告を送り、GitHub Actions の定期実行自体を無効化して自動停止する。
async function handleSuspectedBlock(failureCount, totalCount) {
  const message = `⚠️ テニスコート監視システムで異常を検知しました\n\n`
    + `${totalCount}施設中${failureCount}施設で取得に失敗しました。予約サイト側からアクセス制限を受けた可能性があるため、自動実行を停止しました。\n\n`
    + `再開するにはGitHubリポジトリの Actions タブから手動で有効化してください。`;

  console.error('SUSPECTED_BLOCK', message);

  try {
    const users = await getNotifyTargets();
    for (const user of users) {
      if (user.subscription) {
        await sendRawPush(user.subscription, '⚠️ テニスコート監視: 自動停止しました', message, user.id);
      }
    }
    await sendRawLine(message);
  } catch (e) {
    console.error('緊急通知の送信に失敗:', e.message);
  }

  await disableWorkflow();
}

async function disableWorkflow() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY; // "owner/repo" 形式
  const workflowFile = 'monitor.yml';
  if (!token || !repo) {
    console.error('GITHUB_TOKEN/GITHUB_REPOSITORYが無いため、ワークフローを自動無効化できませんでした');
    return;
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/disable`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      }
    );
    if (res.status === 204) {
      console.log('ワークフローを無効化しました（自動停止）');
    } else {
      console.error('ワークフロー無効化に失敗:', res.status, await res.text());
    }
  } catch (e) {
    console.error('ワークフロー無効化エラー:', e.message);
  }
}

const ACTIVITY_LOG_MAX_ENTRIES = 200;

function appendActivityLog(logPath, newSlots, generatedAt) {
  let log = [];
  try {
    log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
  } catch (e) {
    log = [];
  }

  const newEntries = newSlots.map(slot => ({
    detectedAt: generatedAt,
    date: slot.date,
    time: slot.time,
    facility: slot.facility
  }));

  const combined = [...newEntries, ...log].slice(0, ACTIVITY_LOG_MAX_ENTRIES);
  fs.writeFileSync(logPath, JSON.stringify(combined, null, 2));
  return combined;
}

const NOTIFY_TARGETS_URL = 'https://tennis-auto-monitor.vercel.app/api/notify-targets';

// 登録済み全ユーザーの「お気に入り設定」＋「Web Push購読情報」を取得する。
// scrape.js専用の保護されたエンドポイントを叩く（トークン必須）。
async function getNotifyTargets() {
  const token = process.env.FAVORITES_API_TOKEN;
  try {
    const res = await fetch(NOTIFY_TARGETS_URL, {
      headers: token ? { 'X-Favorites-Token': token } : {},
      signal: AbortSignal.timeout(10000)
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'unknown error');
    return data.users || [];
  } catch (e) {
    console.error('利用者一覧の取得に失敗（通知はスキップ）:', e.message);
    return [];
  }
}

function filterForUser(newlyAvailable, user) {
  if (!user.notifyFavoritesOnly) return newlyAvailable;
  return newlyAvailable.filter(item => (user.facilityIds || []).includes(item.facilityId));
}

(async () => {
  const outDir = path.join(__dirname, '..', 'data');
  const outPath = path.join(outDir, 'availability.json');
  const logPath = path.join(outDir, 'activity-log.json');
  const previousData = loadPreviousData(outPath);

  const browser = await chromium.launch({ headless: true });
  const days = {};
  let failureCount = 0;

  // 施設を SCRAPE_CONCURRENCY 件ずつ同時処理する簡易ワーカープール
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < FACILITIES.length) {
      const facility = FACILITIES[nextIndex++];
      const ok = await scrapeFacility(browser, facility, days);
      if (!ok) failureCount++;
    }
  }
  const workerCount = Math.min(SCRAPE_CONCURRENCY, FACILITIES.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  await browser.close();

  const failureRate = failureCount / FACILITIES.length;
  console.log(`FAILURE_RATE ${failureCount}/${FACILITIES.length} (${(failureRate * 100).toFixed(0)}%)`);
  if (failureRate >= BLOCK_SUSPECTED_THRESHOLD) {
    await handleSuspectedBlock(failureCount, FACILITIES.length);
  }

  const generatedAt = new Date().toISOString();
  const newlyAvailable = detectNewlyAvailable(previousData.days || {}, days);
  console.log('NEWLY_AVAILABLE', newlyAvailable.length);

  const users = await getNotifyTargets();
  console.log('REGISTERED_USERS', users.length);

  // 認証なしで閲覧できる data/notify-debug.json に送信試行の結果を記録し、
  // GitHub Actions の詳細ログにアクセスできなくても状況を確認できるようにする。
  const notifyDebug = {
    generatedAt,
    newlyAvailableCount: newlyAvailable.length,
    registeredUsers: users.length,
    perUser: []
  };

  for (const user of users) {
    const toNotify = filterForUser(newlyAvailable, user);
    console.log(`TO_NOTIFY[${user.id}]`, toNotify.length, '(favoritesOnly=' + user.notifyFavoritesOnly + ')');
    const entry = {
      userId: user.id,
      hasSubscription: !!user.subscription,
      notifyFavoritesOnly: !!user.notifyFavoritesOnly,
      toNotifyCount: toNotify.length
    };
    entry.pushResult = await sendPushNotification(user.subscription, toNotify, user.id);
    notifyDebug.perUser.push(entry);
  }

  // LINEはアカウント所有者（"me"）の設定を基準にブロードキャスト配信する
  const owner = users.find(u => u.id === 'me') || { facilityIds: [], notifyFavoritesOnly: false };
  await sendLineNotification(filterForUser(newlyAvailable, owner));

  fs.mkdirSync(outDir, { recursive: true });
  if (newlyAvailable.length > 0) {
    appendActivityLog(logPath, newlyAvailable, generatedAt);
  }

  fs.writeFileSync(path.join(outDir, 'notify-debug.json'), JSON.stringify(notifyDebug, null, 2));

  const output = {
    generatedAt,
    facilities: FACILITIES.map(f => ({ id: f.id, name: f.name })),
    days
  };

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log('SCRAPE_COMPLETE', Object.keys(days).length, 'dates written');
})().catch(e => {
  console.error('FATAL', e);
  process.exit(1);
});
