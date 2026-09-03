// 東京都立公園テニスコート 空き状況スクレイパー
// GitHub Actions から実行される想定。実ブラウザ(Playwright)で予約サイトを操作し、
// 週表示カレンダーを直近5週間分ページ送りしてデータを取得する。
// 月表示APIはヘッドレスブラウザからの応答が得られなかったため使用しない。

const { chromium } = require('playwright');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

// index.html に埋め込まれている公開鍵と同一のもの（公開鍵なので秘匿不要）
const VAPID_PUBLIC_KEY = 'BNpuNfvpkX-8XMwnvBU4K7cykGDCEh6uSR7IwtKEfQJh4E-qus2N1PigdmjcnPIs-G7bvgO_2dNjKSQS9FRgVI8';

const BASE_URL = 'https://kouen.sports.metro.tokyo.lg.jp/web/index.jsp';
const WEEKS_TO_FETCH = 5;

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
  } catch (error) {
    console.error(`[${facility.id}] ERROR: ${error.message}`);
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

function formatSlotLine(slot) {
  const d = new Date(slot.date + 'T00:00:00+09:00');
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${weekday}) ${slot.time} ${slot.facility}`;
}

async function sendPushNotification(newSlots) {
  const subscriptionJson = process.env.PUSH_SUBSCRIPTION;
  const privateKey = process.env.PUSH_VAPID_PRIVATE_KEY;
  if (!subscriptionJson || !privateKey || newSlots.length === 0) return;

  let subscription;
  try {
    subscription = JSON.parse(subscriptionJson);
  } catch (e) {
    console.error('PUSH_SUBSCRIPTION is not valid JSON:', e.message);
    return;
  }

  webpush.setVapidDetails('mailto:example@example.com', VAPID_PUBLIC_KEY, privateKey);

  newSlots.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  const title = `🎾 新しい空きが見つかりました！（${newSlots.length}件）`;
  const body = newSlots.slice(0, 3).map(formatSlotLine).join('\n')
    + (newSlots.length > 3 ? `\n他 ${newSlots.length - 3}件` : '');

  try {
    await webpush.sendNotification(subscription, JSON.stringify({ title, body, url: '/' }));
    console.log('Push notification sent');
  } catch (e) {
    console.error('Push notification failed:', e.statusCode, e.message);
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

const FAVORITES_API_URL = 'https://tennis-auto-monitor.vercel.app/api/favorites';

async function getFavoritesConfig() {
  try {
    const res = await fetch(FAVORITES_API_URL, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'unknown error');
    return { facilityIds: data.facilityIds || [], notifyFavoritesOnly: Boolean(data.notifyFavoritesOnly) };
  } catch (e) {
    console.error('お気に入り設定の取得に失敗（全施設を通知対象として続行）:', e.message);
    return { facilityIds: [], notifyFavoritesOnly: false };
  }
}

(async () => {
  const outDir = path.join(__dirname, '..', 'data');
  const outPath = path.join(outDir, 'availability.json');
  const logPath = path.join(outDir, 'activity-log.json');
  const previousData = loadPreviousData(outPath);

  const browser = await chromium.launch({ headless: true });
  const days = {};

  for (const facility of FACILITIES) {
    await scrapeFacility(browser, facility, days);
    await sleep(2000); // 施設間で間隔を空ける
  }

  await browser.close();

  const generatedAt = new Date().toISOString();
  const newlyAvailable = detectNewlyAvailable(previousData.days || {}, days);
  console.log('NEWLY_AVAILABLE', newlyAvailable.length);

  const favoritesConfig = await getFavoritesConfig();
  const toNotify = favoritesConfig.notifyFavoritesOnly
    ? newlyAvailable.filter(item => favoritesConfig.facilityIds.includes(item.facilityId))
    : newlyAvailable;
  console.log('TO_NOTIFY', toNotify.length, '(favoritesOnly=' + favoritesConfig.notifyFavoritesOnly + ')');
  await sendPushNotification(toNotify);

  fs.mkdirSync(outDir, { recursive: true });
  if (newlyAvailable.length > 0) {
    appendActivityLog(logPath, newlyAvailable, generatedAt);
  }

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
