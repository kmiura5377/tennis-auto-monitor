// 東京都立公園テニスコート 空き状況スクレイパー
// GitHub Actions から実行される想定。実ブラウザ(Playwright)で予約サイトを操作し、
// 週表示カレンダーを直近5週間分ページ送りしてデータを取得する。
// 月表示APIはヘッドレスブラウザからの応答が得られなかったため使用しない。

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://kouen.sports.metro.tokyo.lg.jp/web/index.jsp';
const WEEKS_TO_FETCH = 5;

const FACILITIES = [
  { id: 'shakujii', name: '石神井公園（人工芝）', purpose: 'テニス（人工芝）', park: '石神井公園Ｂ' },
  { id: 'nogawa', name: '野川公園（人工芝）', purpose: 'テニス（人工芝）', park: '野川公園' },
  { id: 'inokashira', name: '井の頭恩賜公園（人工芝）', purpose: 'テニス（人工芝）', park: '井の頭恩賜公園' },
  { id: 'ariake_a', name: '有明テニスＡ（ハード）', purpose: 'テニス（ハード）', park: '有明テニスＡ屋外ハードコート' },
  { id: 'oi_a', name: '大井ふ頭海浜公園Ａ（ハード）', purpose: 'テニス（ハード）', park: '大井ふ頭海浜公園Ａ' }
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

(async () => {
  const browser = await chromium.launch({ headless: true });
  const days = {};

  for (const facility of FACILITIES) {
    await scrapeFacility(browser, facility, days);
    await sleep(2000); // 施設間で間隔を空ける
  }

  await browser.close();

  const output = {
    generatedAt: new Date().toISOString(),
    facilities: FACILITIES.map(f => ({ id: f.id, name: f.name })),
    days
  };

  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'availability.json'), JSON.stringify(output, null, 2));

  console.log('SCRAPE_COMPLETE', Object.keys(days).length, 'dates written');
})().catch(e => {
  console.error('FATAL', e);
  process.exit(1);
});
