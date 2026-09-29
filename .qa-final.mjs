import { createRequire } from 'module';
const require = createRequire('C:/Users/owner/.vscode/extensions/danielsanmedium.dscodegpt-3.24.75/standalone/');
const { chromium } = require('patchright');

const out = {};
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message + ' @@ ' + (e.stack || '').split('\n').slice(0, 4).join(' | ')));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 200)); });

// Syntax-check every JS file the browser loads
out.syntax = {};
for (const f of ['index.html', 'matchmaking.js', 'supabaseClient.js', 'supabase-config.js']) {
  const txt = await (await fetch('http://localhost:8123/' + f)).text();
  if (f.endsWith('.html')) {
    const scripts = [...txt.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    out.syntax[f] = scripts.map((s, i) => {
      try { new Function(s); return `inline#${i} OK`; } catch (e) { return `inline#${i} FAIL: ${e.message}`; }
    });
  } else {
    try { new Function(txt.replace(/^\s*(import|export)\s.*$/gm, '')); out.syntax[f] = 'OK'; }
    catch (e) { out.syntax[f] = 'FAIL: ' + e.message; }
  }
}

await page.goto('http://localhost:8123/', { waitUntil: 'load' });
await page.waitForTimeout(2500);

// Did the top-level script actually finish? A TDZ error here means it did not.
out.topLevel = (await inPage(`
  return {
    catalogLen: (typeof GAME_CATALOG !== 'undefined') ? GAME_CATALOG.length : 'TDZ/undeclared',
    playerBases: (typeof GAME_PLAYER_BASES !== 'undefined') ? Object.keys(GAME_PLAYER_BASES).length : 'TDZ/undeclared',
    lastConst: (typeof STORAGE_KEYS !== 'undefined') ? Object.keys(STORAGE_KEYS).length : 'TDZ/undeclared',
    hasLaterCode: (typeof finishTimedMatch !== 'undefined')
  };
`));

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

out.boot = (await inPage(`
  return { switchTab: typeof switchTab, catalog: (typeof GAME_CATALOG !== 'undefined') ? GAME_CATALOG.length : -1,
    refreshWallet: typeof window.refreshWalletFromServer, renderActive: typeof window.renderActiveChallenges,
    verifyDeposit: typeof verifyDepositWithServer,
    mm: { loadPendingBets: typeof window.loadPendingBets, joinPendingBet: typeof window.joinPendingBet } };
`)).result;

await inPage(`[...document.querySelectorAll('button')].find(x=>/continue as guest/i.test(x.textContent))?.click(); return 1;`);
await page.waitForTimeout(1500);

const _g = await inPage(`
  try { openGameOptions('breakout'); selectStakeAmount(200); startStakeChallenge(); }
  catch(e) { return { caught: e.message, stack: (e.stack||'').split('\\n').slice(0,5) }; }
  return { err: document.getElementById('stake-error-status').innerText, isGuest: activeUser.isGuest };
`);
out.guest = _g;
console.error('DEBUG guest=' + JSON.stringify(_g));

// All tabs still render, no NaN
out.tabs = (await inPage(`
  const r = {};
  ['home','games','rewards','friends','wallet','profile'].forEach(function(t){
    switchTab(t);
    r[t] = { len: document.body.innerText.length, bad: /NaN|\\[object Object\\]/.test(document.body.innerText) };
  });
  return r;
`)).result;

// Full game run still works
await inPage(`switchTab('games'); openGameOptions('pacman'); playOddZoneScorePractice(); return 1;`);
await page.waitForTimeout(3000);
await inPage(`startArenaMatchNow(); return 1;`);
await page.waitForTimeout(2500);
out.game = (await inPage(`
  const f = document.getElementById('oddzone-game-frame');
  return { live: f.contentWindow.__oddzoneReadScore(), isOver: typeof f.contentWindow.__oddzoneIsOver,
           timer: document.getElementById('match-timer').innerText, inMatch: !!activeTimedMatch };
`)).result;

// Challenge board renders (driven by matchmaking.js)
out.board = await page.evaluate(() => {
  const el = document.getElementById('pending-bets-panel');
  return el ? el.innerText.slice(0, 120) : 'MISSING';
});

out.errors = errors;
await browser.close();
console.log(JSON.stringify(out, null, 2));
