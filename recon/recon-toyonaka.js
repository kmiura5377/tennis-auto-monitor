// 豊中市 施設予約サイト(OPAS)の画面構造を調べるための一時スクリプト。
// 予約サイトへの負荷を抑えるため、1回の実行で開くのは最大10画面・各3秒以上の間隔。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'out');
const START_URLS = [
  'https://reserve.opas.jp/toyonaka/',
  'https://reserve.opas.jp/toyonaka/yoyaku/ShisetsuMultiSelect.cgi',
];
const KEYWORDS = /空き|空室|施設|テニス|庭球|検索|スポーツ|屋外|次へ|表示|ログインせず|ゲスト|一覧/;
const MAX_PAGES = 10;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function dump(page, name) {
  const html = await page.content();
  fs.writeFileSync(path.join(OUT, `${name}.html`), html);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => {});
  const info = await page.evaluate(() => {
    const els = [...document.querySelectorAll('a, button, input[type=submit], input[type=button], input[type=image], [onclick]')];
    return {
      url: location.href,
      title: document.title,
      clickables: els.slice(0, 300).map((e, i) => ({
        i,
        tag: e.tagName,
        text: (e.innerText || e.value || e.alt || e.title || '').trim().slice(0, 60),
        href: e.getAttribute('href'),
        onclick: (e.getAttribute('onclick') || '').slice(0, 200),
        id: e.id, name: e.getAttribute('name'),
      })),
      forms: [...document.forms].map(f => ({
        action: f.getAttribute('action'), method: f.method, name: f.name,
        fields: [...f.elements].slice(0, 200).map(x => ({
          tag: x.tagName, type: x.type, name: x.name, value: (x.value || '').slice(0, 80),
          options: x.tagName === 'SELECT' ? [...x.options].map(o => `${o.value}:${o.text}`).slice(0, 100) : undefined,
        })),
      })),
    };
  });
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(info, null, 2));
  return info;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const log = [];
  let n = 0;

  for (const url of START_URLS) {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
      const info = await dump(page, `p${String(n).padStart(2, '0')}_start`);
      log.push({ n, url, landed: info.url, title: info.title });
      n++;
      await sleep(3000);
    } catch (e) { log.push({ n, url, error: e.message }); }
  }

  // トップページから、キーワードに合う要素を順にクリックして画面をたどる
  await page.goto(START_URLS[0], { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  const visited = new Set();
  while (n < MAX_PAGES) {
    const candidates = await page.locator('a, button, input[type=submit], input[type=button], input[type=image]').all();
    let clicked = false;
    for (const c of candidates) {
      const t = ((await c.innerText().catch(() => '')) || (await c.getAttribute('value')) || (await c.getAttribute('alt')) || '').trim();
      if (!t || !KEYWORDS.test(t) || visited.has(t)) continue;
      visited.add(t);
      try {
        await Promise.all([
          page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}),
          c.click({ timeout: 5000 }),
        ]);
        await sleep(3000);
        const info = await dump(page, `p${String(n).padStart(2, '0')}_${t.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 20)}`);
        log.push({ n, clicked: t, landed: info.url, title: info.title });
        n++;
        clicked = true;
        break;
      } catch (e) { log.push({ n, clicked: t, error: e.message }); }
    }
    if (!clicked) break;
  }

  fs.writeFileSync(path.join(OUT, 'log.json'), JSON.stringify(log, null, 2));
  await browser.close();
})();
