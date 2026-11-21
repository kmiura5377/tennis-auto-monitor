// 豊中市スポーツ施設情報システム（OPAS）テニスコート 空き状況スクレイパー
// GitHub Actions（monitor-toyonaka.yml）から実行される。都立公園用の scrape.js とは独立して動く
// （片方のサイトが不調でも、もう片方に影響しないようにするため）。
//
// ログインなし（ゲスト）の「空き状況照会」で、テニスコート6施設を一度に表示できる。
// 1画面に全施設の7日分が出るので、「次の7日分」を押して WEEKS_TO_FETCH 週分を取得する。
// 1回の実行で開く画面は10枚程度（各操作の間に1.5秒以上あける）。

const { chromium } = require('playwright');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const VAPID_PUBLIC_KEY = 'BNpuNfvpkX-8XMwnvBU4K7cykGDCEh6uSR7IwtKEfQJh4E-qus2N1PigdmjcnPIs-G7bvgO_2dNjKSQS9FRgVI8';
const START_URL = 'https://reserve.opas.jp/toyonaka/';
const WEEKS_TO_FETCH = 4;
const NOTIFY_TARGETS_URL = 'https://tennis-auto-monitor.vercel.app/api/notify-targets';
const ACTIVITY_LOG_MAX_ENTRIES = 200;

// 施設名（予約サイトの表示名）→ このアプリでのID。IDは都立公園と重ならないよう toyonaka_ を付ける
const FACILITIES = [
  { id: 'toyonaka_toyoshima', name: '豊島公園庭球場（豊中）', site: '豊島公園庭球場' },
  { id: 'toyonaka_senri_higashimachi', name: '千里東町公園庭球場（豊中）', site: '千里東町公園庭球場' },
  { id: 'toyonaka_nobata', name: '野畑庭球場（豊中）', site: '野畑庭球場' },
  { id: 'toyonaka_fureai', name: 'ふれあい緑地庭球場（豊中）', site: 'ふれあい緑地庭球場' },
  { id: 'toyonaka_green', name: 'グリーンスポーツセンター庭球場（豊中）', site: 'グリーンスポーツセンター庭球場' },
  { id: 'toyonaka_green_roof', name: 'グリーンスポーツセンター屋根付庭球場（豊中）', site: 'グリーンスポーツセンター屋根付庭球場' }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// クリックで画面が切り替わる（フォーム送信）操作。切り替わりを待ってから少し間をあける
async function clickAndWait(page, selector) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }),
    page.locator(selector).first().click({ timeout: 15000 })
  ]);
  await sleep(1500);
}

// 表示中の画面（7日分×全施設）を読み取る。
// 戻り値: { facilities: [{ site, dates: ['M/D',...], rows: [{ time, cells: [{available, remaining, total}] }] }] }
async function parseScreen(page) {
  return page.evaluate(() => {
    const facilities = [];
    document.querySelectorAll('td.shisetu_name').forEach(nameCell => {
      const site = nameCell.innerText.trim();
      const table = nameCell.closest('table');
      const dates = [...table.querySelectorAll('p.day')].map(p => {
        const m = p.innerText.replace(/\s+/g, '').match(/(\d+)月(\d+)日/);
        return m ? `${m[1]}/${m[2]}` : null;
      });
      const rows = [...table.querySelectorAll('tr')]
        .filter(tr => tr.querySelector('td.facmdstime'))
        .map(tr => {
          const tds = [...tr.querySelectorAll('td')];
          const time = tds[0].innerText.replace(/\s+/g, '').replace('～', '-');
          const cells = tds.slice(1).map(td => {
            const img = td.querySelector('img');
            const src = img ? img.getAttribute('src') : '';
            const m = td.innerText.match(/(\d+)\((\d+)\)/);
            return {
              available: /\/maru\./.test(src),
              remaining: m ? Number(m[1]) : null,
              total: m ? Number(m[2]) : null
            };
          });
          return { time, cells };
        });
      facilities.push({ site, dates, rows });
    });
    return { facilities };
  });
}

// 列見出しの「M月D日」に年を補って 'YYYY-MM-DD' にする。
// 年は日本時間の今日を基準にし、今日の月より2か月以上前の月は翌年とみなす（12月→1月の年またぎ）。
// （画面上部の「表示開始日」の選択欄は実際の表示と食い違うことがあったため使わない）
function labelToDate(label) {
  const [m, d] = label.split('/').map(Number);
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  let y = now.getUTCFullYear();
  if (m < now.getUTCMonth() + 1 - 1) y += 1;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// 画面の内容を days（{ 'YYYY-MM-DD': [{facilityId, facility, timeSlots}] }）に書き込む
function mergeScreen(days, screen) {
  let count = 0;
  for (const f of screen.facilities) {
    const facility = FACILITIES.find(x => x.site === f.site);
    if (!facility) { console.log(`未知の施設をスキップ: ${f.site}`); continue; }
    f.dates.forEach((label, i) => {
      if (!label) throw new Error(`列見出しの日付が読めない（${f.site} ${i + 1}列目）`);
      const dateStr = labelToDate(label);
      if (!days[dateStr]) days[dateStr] = [];
      let entry = days[dateStr].find(e => e.facilityId === facility.id);
      if (!entry) {
        entry = { facilityId: facility.id, facility: facility.name, timeSlots: [] };
        days[dateStr].push(entry);
      }
      for (const row of f.rows) {
        const cell = row.cells[i];
        if (!cell || entry.timeSlots.some(s => s.time === row.time)) continue;
        const slot = { time: row.time, available: cell.available };
        if (cell.remaining !== null) { slot.remaining = cell.remaining; slot.total = cell.total; }
        entry.timeSlots.push(slot);
        count++;
      }
    });
  }
  return count;
}

async function scrapeAll(days, diag) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'ja-JP' });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('dialog', d => d.accept().catch(() => {}));
  try {
    diag.step = 'トップページ';
    await page.goto(START_URL, { waitUntil: 'load' });
    await sleep(1500);
    diag.step = '空き状況照会';
    await clickAndWait(page, 'a[onclick*="Akisyoukai"]');
    diag.step = '施設を指定する';
    await clickAndWait(page, `tr[onclick*="'Enter','1'"]`);
    diag.step = 'テニスコート';
    await clickAndWait(page, 'tr[onclick*="272035_001_06"]');
    diag.step = '全て選択';
    await clickAndWait(page, 'a[onclick*="AllSelect"]');
    diag.step = '次に進む';
    await clickAndWait(page, `a[onclick*="isSubmitDataSet('Enter')"]`);
    diag.step = '利用目的（大分類）';
    await clickAndWait(page, 'tr[onclick*="E00"]');
    diag.step = '利用目的（テニス）';
    await clickAndWait(page, 'tr[onclick*="E04"]');

    diag.weeksFetched = 0;
    for (let w = 0; w < WEEKS_TO_FETCH; w++) {
      diag.step = `${w + 1}週目の読み取り`;
      const screen = await parseScreen(page);
      if (screen.facilities.length === 0) throw new Error('空き状況の表が見つからない');
      const n = mergeScreen(days, screen);
      diag.weeksFetched = w + 1;
      diag.facilitiesSeen = screen.facilities.map(f => f.site);
      console.log(`week ${w + 1}: first=${screen.facilities[0].dates[0]} facilities=${screen.facilities.length} slots=${n}`);
      if (w < WEEKS_TO_FETCH - 1) {
        diag.step = `${w + 2}週目へ`;
        await clickAndWait(page, `a[onclick*="OffsetNext"]`);
      }
    }
    return true;
  } catch (e) {
    diag.error = `[${diag.step}] ${String(e.message).split('\n')[0].slice(0, 200)}`;
    try {
      const text = (await page.locator('body').innerText({ timeout: 3000 })).replace(/\s+/g, ' ').trim();
      diag.pageHint = `${await page.title()} | ${text.slice(0, 160)}`;
    } catch (_) { /* 記録できなければ省略 */ }
    console.error('SCRAPE_ERROR', diag.error, diag.pageHint || '');
    return false;
  } finally {
    await browser.close();
  }
}

// 前回は「空きなし」→今回「空きあり」になった枠。前回見ていなかった日・施設は対象外（初めて見えただけのため）
function detectNewlyAvailable(previousDays, newDays) {
  const found = [];
  for (const [dateStr, facilities] of Object.entries(newDays)) {
    if (!previousDays[dateStr]) continue;
    for (const facility of facilities) {
      const prev = previousDays[dateStr].find(f => f.facilityId === facility.facilityId);
      if (!prev) continue;
      for (const slot of facility.timeSlots) {
        if (!slot.available) continue;
        const prevSlot = prev.timeSlots.find(s => s.time === slot.time);
        if (!(prevSlot && prevSlot.available)) {
          found.push({ date: dateStr, facilityId: facility.facilityId, facility: facility.facility, time: slot.time });
        }
      }
    }
  }
  return found;
}

function formatSlotLine(slot) {
  const [y, m, d] = slot.date.split('-').map(Number);
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d}(${weekday}) ${slot.time} ${slot.facility.replace('（豊中）', '')}`;
}

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

async function sendPush(subscription, newSlots, label) {
  const privateKey = process.env.PUSH_VAPID_PRIVATE_KEY;
  if (!subscription) return { attempted: false, ok: false, skippedReason: 'no_subscription' };
  if (newSlots.length === 0) return { attempted: false, ok: false, skippedReason: 'no_new_slots' };
  if (!privateKey) return { attempted: false, ok: false, skippedReason: 'no_private_key_env' };
  newSlots.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const title = `🎾 豊中で新しい空き（${newSlots.length}件）`;
  const body = newSlots.slice(0, 3).map(formatSlotLine).join('\n')
    + (newSlots.length > 3 ? `\n他 ${newSlots.length - 3}件` : '');
  webpush.setVapidDetails('mailto:example@example.com', VAPID_PUBLIC_KEY, privateKey);
  try {
    await webpush.sendNotification(subscription, JSON.stringify({ title, body, url: '/?area=toyonaka' }));
    console.log(`Push sent (${label})`);
    return { attempted: true, ok: true };
  } catch (e) {
    // 購読切れ(404/410)の後片付けは都立公園側の scrape.js が行うので、ここでは記録だけ
    console.error(`Push failed (${label}):`, e.statusCode, e.message);
    return { attempted: true, ok: false, statusCode: e.statusCode };
  }
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

(async () => {
  const outDir = path.join(__dirname, '..', 'data');
  const outPath = path.join(outDir, 'toyonaka.json');
  const logPath = path.join(outDir, 'toyonaka-activity-log.json');
  const debugPath = path.join(outDir, 'toyonaka-debug.json');
  const previous = readJson(outPath, { days: {} });
  fs.mkdirSync(outDir, { recursive: true });

  const days = {};
  const diag = {};
  const ok = await scrapeAll(days, diag);
  const generatedAt = new Date().toISOString();

  // 1週目も取れなかった場合は、前回の表示データをそのまま残す（古いデータを新しく見せない）
  if (!ok && diag.weeksFetched === 0) {
    fs.writeFileSync(debugPath, JSON.stringify({ generatedAt, ok: false, diag }, null, 2));
    console.error('NO_DATA: データは更新せず前回のまま残す');
    process.exitCode = 1;
    return;
  }

  const newlyAvailable = detectNewlyAvailable(previous.days || {}, days);
  console.log('NEWLY_AVAILABLE', newlyAvailable.length);

  const users = newlyAvailable.length > 0 ? await getNotifyTargets() : [];
  const perUser = [];
  for (const user of users) {
    const toNotify = filterForUser(newlyAvailable, user);
    perUser.push({ userId: user.id, toNotifyCount: toNotify.length, pushResult: await sendPush(user.subscription, toNotify, user.id) });
  }

  if (newlyAvailable.length > 0) {
    const log = readJson(logPath, []);
    const entries = newlyAvailable.map(s => ({ detectedAt: generatedAt, date: s.date, time: s.time, facility: s.facility }));
    fs.writeFileSync(logPath, JSON.stringify([...entries, ...log].slice(0, ACTIVITY_LOG_MAX_ENTRIES), null, 2));
  }

  fs.writeFileSync(outPath, JSON.stringify({
    generatedAt,
    area: 'toyonaka',
    facilities: FACILITIES.map(f => ({ id: f.id, name: f.name })),
    days
  }, null, 2));
  fs.writeFileSync(debugPath, JSON.stringify({ generatedAt, ok, diag, newlyAvailableCount: newlyAvailable.length, perUser }, null, 2));
  console.log('SCRAPE_COMPLETE', Object.keys(days).length, 'dates written');
})().catch(e => {
  console.error('FATAL', e);
  process.exit(1);
});
