// 豊中市 施設予約サイト(OPAS)の画面構造を調べるための一時スクリプト。
// recon/steps.json の手順を順に実行し、各画面のHTML・スクリーンショット・要素一覧を保存する。
// 予約サイトへの負荷を抑えるため、各操作の間は3秒以上あける。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'out');
const STEPS = JSON.parse(fs.readFileSync(path.join(__dirname, 'steps.json'), 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function dump(page, name) {
  fs.writeFileSync(path.join(OUT, `${name}.html`), await page.content());
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => {});
  const info = await page.evaluate(() => {
    const els = [...document.querySelectorAll('a, button, input[type=submit], input[type=button], input[type=image], input[type=checkbox], input[type=radio], select, [onclick]')]
      .filter(e => !(e.tagName === 'INPUT' && e.type === 'button' && /^.{1}$|Backspace|Close|Enter|Space|Shift/.test(e.value)));
    return {
      url: location.href,
      title: document.title,
      clickables: els.slice(0, 400).map(e => ({
        tag: e.tagName, type: e.type,
        text: (e.innerText || e.value || e.alt || e.title || (e.querySelector && e.querySelector('img') && e.querySelector('img').alt) || '').trim().slice(0, 60),
        href: e.getAttribute('href'),
        onclick: (e.getAttribute('onclick') || '').slice(0, 200),
        id: e.id, name: e.getAttribute('name'), value: e.getAttribute('value'),
        options: e.tagName === 'SELECT' ? [...e.options].map(o => `${o.value}:${o.text}`).slice(0, 150) : undefined,
      })),
      forms: [...document.forms].map(f => ({ action: f.getAttribute('action'), name: f.name,
        hidden: [...f.querySelectorAll('input[type=hidden]')].map(x => `${x.name}=${(x.value || '').slice(0, 60)}`) })),
    };
  });
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(info, null, 2));
  return info;
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept().catch(() => {}));
  const log = [];

  await page.goto('https://reserve.opas.jp/toyonaka/', { waitUntil: 'networkidle', timeout: 45000 });
  await dump(page, 's00');
  for (let i = 0; i < STEPS.length; i++) {
    const s = STEPS[i];
    const name = `s${String(i + 1).padStart(2, '0')}`;
    try {
      const loc = page.locator(s.selector).first();
      if (s.action === 'click') {
        await Promise.all([
          page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}),
          loc.click({ timeout: 10000 }),
        ]);
      } else if (s.action === 'check') {
        await loc.check({ timeout: 10000 });
      } else if (s.action === 'select') {
        await loc.selectOption(s.value, { timeout: 10000 });
      } else if (s.action === 'eval') {
        await Promise.all([
          page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}),
          page.evaluate(s.code),
        ]);
      }
      await sleep(3000);
      const info = await dump(page, name);
      log.push({ step: i + 1, ...s, landed: info.url, title: info.title });
    } catch (e) {
      log.push({ step: i + 1, ...s, error: e.message.slice(0, 300) });
      await dump(page, `${name}_error`).catch(() => {});
      break;
    }
  }
  fs.writeFileSync(path.join(OUT, 'log.json'), JSON.stringify(log, null, 2));
  await browser.close();
})();
