import { createRequire } from 'module';
const require = createRequire('C:/Users/owner/.vscode/extensions/danielsanmedium.dscodegpt-3.24.75/standalone/');
const { chromium } = require('patchright');

const out = {};
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 200)); });

// 1. Syntax check the big inline script standalone, before the browser runs it.
const html = await (await fetch('http://localhost:8123/index.html')).text();
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
out.inlineScriptCount = scripts.length;
out.parse = scripts.map((s, i) => {
  try { new Function(s); return { i, len: s.length, ok: true }; }
  catch (e) { return { i, len: s.length, ok: false, err: e.message }; }
});

await page.goto('http://localhost:8123/', { waitUntil: 'load' });
await page.waitForTimeout(2500);

async function inPage(body) {
  await page.evaluate((b) => {
    let n = document.getElementById('__qa_out');
    if (!n) { n = document.createElement('textarea'); n.id = '__qa_out'; document.body.appendChild(n); }
    n.value = '';
    const s = document.createElement('script');
    s.textContent = `(function(){var n=document.getElementById('__qa_out');try{n.value=JSON.stringify({ok:1,result:(function(){${b}})()});}catch(e){n.value=JSON.stringify({ok:0,err:e.message});}})();`;
    document.body.appendChild(s);
  }, body);
  return page.evaluate(() => {
    const raw = (document.getElementById('__qa_out') || {}).value || '';
    try { return JSON.parse(raw); } catch (e) { return { ok: 0, err: 'parse:' + e.message }; }
  });
}

// 2. App must still boot
out.boot = (await inPage(`
  return { switchTab: typeof switchTab, catalog: (typeof GAME_CATALOG !== 'undefined') ? GAME_CATALOG.length : -1,
           refreshWallet: typeof refreshWalletFromServer, startStake: typeof startStakeChallenge };
`)).result;

await inPage(`[...document.querySelectorAll('button')].find(x=>/continue as guest/i.test(x.textContent))?.click(); return 1;`);
await page.waitForTimeout(1500);

// 3. Guest guard still works
out.guestGuard = (await inPage(`
  openGameOptions('breakout'); selectStakeAmount(200); startStakeChallenge();
  return { err: document.getElementById('stake-error-status').innerText, isGuest: activeUser.isGuest };
`)).result;

// 4. Gameplay still works end to end
await inPage(`switchTab('games'); openGameOptions('breakout'); playOddZoneScorePractice(); return 1;`);
await page.waitForTimeout(3000);
await inPage(`startArenaMatchNow(); return 1;`);
await page.waitForTimeout(3000);
out.match = (await inPage(`
  const f = document.getElementById('oddzone-game-frame');
  return { src: f.getAttribute('src'), timer: document.getElementById('match-timer').innerText,
           live: f.contentWindow.__oddzoneReadScore(), inMatch: !!activeTimedMatch };
`)).result;

out.errors = errors.slice(0, 12);
await browser.close();
console.log(JSON.stringify(out, null, 2));
