import { createRequire } from 'module';
const require = createRequire('C:/Users/owner/.vscode/extensions/danielsanmedium.dscodegpt-3.24.75/standalone/');
const { chromium } = require('patchright');
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));

// Write results into a DOM node: DOM is shared across execution worlds, so
// this works regardless of which world page.evaluate runs in.
async function probe(body) {
  await page.evaluate((b) => {
    let n = document.getElementById('__probe_node');
    if (!n) { n = document.createElement('textarea'); n.id = '__probe_node'; document.body.appendChild(n); }
    n.value = '';
    const s = document.createElement('script');
    s.textContent = '(function(){var n=document.getElementById("__probe_node");' +
      'try{n.value=JSON.stringify({ok:1,result:(function(){' + b + '})()});}' +
      'catch(e){n.value=JSON.stringify({ok:0,err:e.message,stack:(e.stack||"").split("\\n").slice(0,4)});}})();';
    document.body.appendChild(s);
  }, body);
  return page.evaluate(() => {
    const raw = (document.getElementById('__probe_node') || {}).value || '';
    try { return JSON.parse(raw); } catch (e) { return { ok: 0, err: 'parse', raw: raw.slice(0, 200) }; }
  });
}

await page.goto('http://localhost:8123/', { waitUntil: 'load' });
await page.waitForTimeout(2500);

console.log(JSON.stringify({
  declarations: await probe(`
    var r = {};
    ["GAME_CATALOG","GAME_PLAYER_BASES","STORAGE_KEYS","RAKE_PERCENT","MATCH_DURATION_MS"].forEach(function(n){
      try { var v = eval(n); r[n] = (v && typeof v === "object") ? Object.keys(v).length : String(v); }
      catch(e){ r[n] = "ERR: " + e.message; }
    });
    return r;
  `),
  functions: await probe(`
    return { switchTab: typeof switchTab, openGameOptions: typeof openGameOptions,
             startStakeChallenge: typeof startStakeChallenge, finishTimedMatch: typeof finishTimedMatch,
             verifyDepositWithServer: typeof verifyDepositWithServer,
             refreshWallet: typeof window.refreshWalletFromServer,
             renderActive: typeof window.renderActiveChallenges };
  `),
  errs,
}, null, 2));
await browser.close();
