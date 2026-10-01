// Diagnostic: what does the LIVE database actually look like, as the signed-in
// player sees it? Answers, without the dashboard:
//
//   * the real type of stake_challenges.id (uuid vs text)
//   * which columns the money functions need are missing
//   * why the wallet reset in _test-duel-flow.mjs fails
//
// It signs in to the two existing test accounts (no signup, no email).
//
//   node supabase/_diag-live.mjs
//   or:  $env:ODDZONE_TEST_EMAIL_A="..."; $env:ODDZONE_TEST_EMAIL_B="..."
//        $env:ODDZONE_TEST_PASSWORD="..."; node supabase/_diag-live.mjs

import readline from 'node:readline';

const U = 'https://csrfrzzpduhhzldirdfi.supabase.co';
const K = 'sb_publishable_y_aWz0kwtbJYAcWfVNqGCg_CH4L3MHj';
const H = { apikey: K, Authorization: `Bearer ${K}` };

const prompt = q => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim()); }));
};

async function creds() {
  const { ODDZONE_TEST_EMAIL_A, ODDZONE_TEST_EMAIL_B, ODDZONE_TEST_PASSWORD } = process.env;
  if (ODDZONE_TEST_EMAIL_A && ODDZONE_TEST_EMAIL_B && ODDZONE_TEST_PASSWORD)
    return { emailA: ODDZONE_TEST_EMAIL_A, emailB: ODDZONE_TEST_EMAIL_B, password: ODDZONE_TEST_PASSWORD };
  console.log('=== credentials ===');
  return {
    emailA: await prompt('  Email A: '),
    emailB: await prompt('  Email B: '),
    password: await prompt('  Shared password: ')
  };
}

async function signIn(label, email, password) {
  const r = await fetch(`${U}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) {
    console.log(`>>> COULD NOT SIGN IN AS ${label}: ${JSON.stringify(j).slice(0, 240)}`);
    process.exit(1);
  }
  return { email, id: j.user.id, headers: { ...H, Authorization: `Bearer ${j.access_token}` } };
}

// Filter on a column with a deliberately non-matching value. Postgres rejects the
// value with a message that NAMES THE TYPE, so this tells us uuid vs text for any
// column without needing SQL editor access.
async function typeOf(h, table, column) {
  const r = await fetch(`${U}/rest/v1/${table}?select=id&${column}=eq.__not_a_real_value__`, { headers: h });
  const t = await r.text();
  const m = t.match(/invalid input syntax for type (\w+)/i) || t.match(/uuid|character varying|text/i);
  return `${r.status} ${m ? 'type=' + m[1] : 'no type error (text-like)'}`;
}

async function probeColumns(h) {
  const cols = {
    stake_challenges: ['id', 'refund_amount', 'opponent_id', 'winner_id', 'score', 'created_at'],
    bets: ['id', 'creator_score', 'opponent_score', 'game_title'],
    profiles: ['id', 'wallet_balance', 'is_verified', 'updated_at']
  };
  for (const [t, cs] of Object.entries(cols)) {
    console.log(`\n=== ${t} ===`);
    for (const c of cs) {
      const r = await fetch(`${U}/rest/v1/${t}?select=${c}&limit=1`, { headers: h });
      console.log(`  ${c}: ${r.ok ? 'exists' : (await r.text()).replace(/\s+/g, ' ').slice(0, 110)}`);
    }
  }
  console.log('\n=== column TYPES (filter trick) ===');
  for (const [t, c] of [['stake_challenges', 'id'], ['stake_challenges', 'user_id'], ['bets', 'id'], ['profiles', 'id'], ['profiles', 'wallet_balance']])
    console.log(`  ${t}.${c}: ${await typeOf(h, t, c)}`);
}

async function probeRpc(h) {
  console.log('\n=== rpc visibility (as a signed-in player) ===');
  for (const fn of ['wallet_balance', 'open_duel', 'settle_duel', 'cancel_duel', 'ensure_profile', 'record_deposit']) {
    const r = await fetch(`${U}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify(fn === 'open_duel' ? { p_game_id: 'pacman', p_stake: 200, p_payout: 360 } : {})
    });
    console.log(`  ${fn} -> ${r.status} ${(await r.text()).replace(/\s+/g, ' ').slice(0, 190)}`);
  }
}

async function probeReset(h, label) {
  console.log(`\n=== wallet reset for ${label} (${h ? '' : ''}id=${label === 'A' ? a.id : b.id}) ===`);
  for (const [desc, filter] of [
    ['by wallet_balance=eq.<uuid>  (what the test does today)', `wallet_balance=eq.${label === 'A' ? a.id : b.id}`],
    ['by id=eq.<uuid>            (correct)', `id=eq.${label === 'A' ? a.id : b.id}`]
  ]) {
    const r = await fetch(`${U}/rest/v1/profiles?${filter}`, {
      method: 'PATCH',
      headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ wallet_balance: 0 })
    });
    const t = (await r.text()).replace(/\s+/g, ' ');
    console.log(`  ${desc}\n    -> ${r.status} ${t.slice(0, 220)}`);
  }
  const b = await fetch(`${U}/rest/v1/rpc/wallet_balance`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: '{}' });
  console.log(`  wallet_balance() now: ${await b.text()}`);
}

const c = await creds();
console.log('\n=== signing in (no signup, no email) ===');
const a = await signIn('A', c.emailA, c.password);
const b = await signIn('B', c.emailB, c.password);
console.log(`  A = ${c.emailA}`);
console.log(`  B = ${c.emailB}`);

await probeColumns(a.headers);
await probeRpc(a.headers);
await probeReset(a.headers, 'A');