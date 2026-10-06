// ─────────────────────────────────────────────
// Two-player duel simulation against the live Supabase project.
//
// WHY THIS USES EXISTING ACCOUNTS
//
// The first version called /auth/v1/signup to create its own two players. That
// exhausted the project's "over_email_send_rate_limit", because Supabase sends
// a confirmation email per signup. It could not get past that from a client.
//
// This version therefore signs IN to two accounts you created yourself, so no
// email is ever sent and the limit is never touched.
//
// HOW TO SET UP (once)
//
//   1. Supabase -> Authentication -> Users -> Add user
//   2. Create TWO users (e.g. duel1@... and duel2@...)
//   3. Tick "Auto Confirm User" on each -- otherwise sign-in is rejected
//      with "Email not confirmed"
//   4. Give both the same password (the test only needs to sign in)
//
// HOW TO SUPPLY CREDENTIALS (pick ONE -- never paste them into a chat)
//
//   A. Interactive prompt -- nothing stored, safest of all:
//        node supabase/migrations/_test-duel-flow.mjs
//
//   B. Environment variables (best for CI):
//        $env:ODDZONE_TEST_EMAIL_A = "duel1@you.com"
//        $env:ODDZONE_TEST_EMAIL_B = "duel2@you.com"
//        $env:ODDZONE_TEST_PASSWORD = "your-password"
//        node supabase/migrations/_test-duel-flow.mjs
//
// CLEANUP
//
// This spends and refunds real balance on two throwaway accounts. It resets
// both wallets to 0 at the end, but delete the accounts afterwards.
// ─────────────────────────────────────────────

const U = 'https://csrfrzzpduhhzldirdfi.supabase.co';
const K = 'sb_publishable_y_aWz0kwtbJYAcWfVNqGCg_CH4L3MHj';
const H = { apikey: K, Authorization: `Bearer ${K}` };

import readline from 'node:readline';

// ── Credential resolution: env first, then an interactive prompt ────────────

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  });
}

async function getCredentials() {
  const { ODDZONE_TEST_EMAIL_A, ODDZONE_TEST_EMAIL_B, ODDZONE_TEST_PASSWORD } = process.env;
  if (ODDZONE_TEST_EMAIL_A && ODDZONE_TEST_EMAIL_B && ODDZONE_TEST_PASSWORD) {
    return {
      emailA: ODDZONE_TEST_EMAIL_A,
      emailB: ODDZONE_TEST_EMAIL_B,
      password: ODDZONE_TEST_PASSWORD,
      source: 'environment variables'
    };
  }

  console.log('=== credentials ===');
  console.log('No env vars found, so asking for two pre-created test accounts.');
  console.log('Create them in Supabase -> Authentication -> Users -> Add user,');
  console.log('with "Auto Confirm User" ticked. Both must share one password.');
  console.log('');
  const emailA = await prompt('  Email A: ');
  const emailB = await prompt('  Email B: ');
  const password = await prompt('  Shared password: ');
  return { emailA, emailB, password, source: 'interactive prompt' };
}

// ── Auth: sign in to an existing account. No signup, so no email is sent. ───

async function signIn(label, email, password) {
  const r = await fetch(`${U}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const j = await r.json().catch(() => ({}));

  if (!j.access_token) {
    console.log(`\n>>> COULD NOT SIGN IN AS PLAYER ${label} (${email}).`);
    console.log(`>>> Response: ${JSON.stringify(j).slice(0, 260)}`);
    if (/not confirmed/i.test(JSON.stringify(j))) {
      console.log('>>>\n>>> That account has not been confirmed. In Supabase ->');
      console.log('>>> Authentication -> Users, open it and set Email Confirmed,');
      console.log('>>> or re-create it with "Auto Confirm User" ticked.');
    } else if (/invalid login credentials/i.test(JSON.stringify(j))) {
      console.log('>>>\n>>> Wrong email or password. Both accounts must share the');
      console.log('>>> same password for this script to work.');
    }
    process.exit(1);
  }
  return { email, headers: { ...H, Authorization: `Bearer ${j.access_token}` } };
}

// ── RPC helpers ─────────────────────────────────────────────────────────────

async function rpc(h, fn, body) {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, body: j ?? t };
}

async function balance(h) {
  const r = await rpc(h, 'wallet_balance', {});
  return r.status === 200 ? Number(r.body) : `ERR(${r.status}: ${JSON.stringify(r.body).slice(0, 90)})`;
}

// The wallet is server-owned, so a repeatable run resets it through the
// profiles row the signed-in user is allowed to update.
//
// The filter MUST be on profiles.id. It used to be
// `?wallet_balance=eq.<uuid>`, which asks Postgres to find the row whose
// wallet_balance equals a UUID. wallet_balance is a bigint, so that raised
// "invalid input syntax for type bigint", the PATCH matched zero rows, and the
// script reported FAIL on every reset while the real balance sat untouched.
async function resetWallet(h) {
  const me = await fetch(`${U}/auth/v1/user`, { headers: h });
  const uj = await me.json().catch(() => ({}));
  if (!uj.id) return false;
  const r = await fetch(`${U}/rest/v1/profiles?id=eq.${uj.id}`, {
    method: 'PATCH',
    headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ wallet_balance: 0 })
  });
  if (!r.ok) console.log(`    (reset failed: ${r.status} ${(await r.text()).replace(/\s+/g, ' ').slice(0, 120)})`);
  return r.ok;
}

// PostgREST rejects the whole request when it names a column that does not
// exist, so a 200 is a reliable "yes, that column is really there".
async function columnExists(h, table, column) {
  const r = await fetch(`${U}/rest/v1/${table}?select=${column}&limit=1`, { headers: h });
  return r.ok;
}

// Set a wallet to an EXACT amount, so a run is repeatable and every arithmetic
// check below has a known starting point.
//
// record_deposit() is deliberately not granted to the browser role, so a test
// cannot mint a balance the way a real deposit would. Writing the profiles row
// directly is the same mechanism resetWallet used, and is fine for a throwaway
// account -- it is NOT how money enters the app.
async function setBalance(h, amount) {
  const me = await fetch(`${U}/auth/v1/user`, { headers: h });
  const uj = await me.json().catch(() => ({}));
  if (!uj.id) return false;
  const r = await fetch(`${U}/rest/v1/profiles?id=eq.${uj.id}`, {
    method: 'PATCH',
    headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ wallet_balance: amount })
  });
  if (!r.ok) console.log(`    (setBalance failed: ${r.status} ${(await r.text()).replace(/\s+/g, ' ').slice(0, 120)})`);
  return r.ok;
}

// PostgREST resolves an rpc call against the schema cache by EXACT argument
// names. A typo or a renamed parameter therefore does not fail the migration --
// it fails at call time with:
//
//   PGRST202: Could not find the function public.settle_duel(text, bigint) in
//             the schema cache
//
// Checking for the columns the money functions write (below) is not enough on
// its own: the columns can all be present while one rpc is missing or has the
// wrong parameters, and the scenarios that use it then die mid-run with an
// opaque 404. This walks every function with the exact payload the client
// sends, so a mismatch is reported up front with the server's own wording.
// Check one rpc against the exact parameter names the browser sends it. The
// call is unauthenticated on purpose: all that matters is whether PostgREST
// resolved the function, and reaching the function body returns a 400 "You
// must be signed in" which proves it resolved. A PGRST202 means it did not.
async function rpcSignatureResolves(fn, body) {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: K, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const t = await r.text();
  if (/PGRST202|Could not find the function/i.test(t)) return { ok: false, detail: t.replace(/\s+/g, ' ').slice(0, 150) };
  if (r.status === 404) return { ok: false, detail: `HTTP 404 :: ${t.replace(/\s+/g, ' ').slice(0, 150)}` };
  return { ok: true, detail: `HTTP ${r.status}` };
}

// Every function the duel flow depends on. wallet_balance takes no arguments, so
// an empty body is the correct probe for it; the rest are called with the same
// keys index.html and matchmaking.js use, because PostgREST matches on the
// argument NAMES and not their order.
const EXPECTED_RPCS = [
  ['wallet_balance', {}],
  ['ensure_profile', { p_username: 'probe', p_email: 'probe' }],
  ['open_duel', { p_game_id: 'pacman', p_stake: 1000, p_payout: 1800 }],
  ['settle_duel', { p_challenge_id: 'probe', p_score: 0 }],
  ['cancel_duel', { p_challenge_id: 'probe' }],
  ['tie_duel', { p_challenge_id: 'probe' }],
  ['forfeit_duel', { p_challenge_id: 'probe' }]
];

// ── The scenarios ───────────────────────────────────────────────────────────

(async () => {
  const creds = await getCredentials();
  if (!creds.emailA || !creds.emailB || !creds.password) {
    console.log('\n>>> Missing emailA, emailB or password. Aborting.');
    process.exit(1);
  }

  console.log('\n=== signing in (no signup, no email) ===');
  console.log(`  credentials from: ${creds.source}`);
  const A = await signIn('A', creds.emailA, creds.password);
  const B = await signIn('B', creds.emailB, creds.password);
  console.log(`  A = ${creds.emailA}`);
  console.log(`  B = ${creds.emailB}`);

  const fails = [];
  const check = (label, ok, detail) => {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
    if (!ok) fails.push(label);
  };

  const GAME = 'pacman', STAKE = 1000, PAYOUT = 1800;

  // The two account uuids, so assertions later can name an exact winner rather
  // than just checking a column is non-null. `/auth/v1/user` is the only way to
  // learn these from the client.
  const uidA = (await (await fetch(`${U}/auth/v1/user`, { headers: A.headers })).json()).id;
  const uidB = (await (await fetch(`${U}/auth/v1/user`, { headers: B.headers })).json()).id;
  console.log(`  A uid = ${uidA}`);
  console.log(`  B uid = ${uidB}`);

  // Resolve every function BEFORE the first scenario spends anything. A
  // PGRST202 found here is unambiguous, whereas the same fault surfacing in
  // scenario 3 looks like a settlement bug, and the money movement that came
  // before it has already happened.
  console.log('\n=== rpc signature pre-flight ===');
  for (const [fn, body] of EXPECTED_RPCS) {
    const r = await rpcSignatureResolves(fn, body);
    check(`${fn}(${Object.keys(body).join(', ')}) resolves`, r.ok, r.detail);
  }
  if (fails.length) {
    console.log('\n>>> A function is missing or has the wrong parameters.');
    console.log('>>> No money has moved. Apply the current');
    console.log('>>> 20261001000000_reconcile_live_schema.sql, then re-run.');
    console.log(`\n${'='.repeat(52)}`);
    console.log(`${fails.length} CHECK(S) FAILED:\n - ${fails.join('\n - ')}`);
    process.exit(0);
  }

  // A loses its 1000 stake in scenario 3, so by scenario 7 A has nothing left
  // and by scenario 9 it needs another 300. Each scenario below therefore sets
  // the wallet it depends on to an exact figure FIRST. Without this the run dies
  // with "Insufficient balance" and every later scenario never runs.
  console.log('\n=== 0. fund both wallets at exactly 1000 ===');
  check('A funded to 1000', await setBalance(A.headers, 1000));
  check('B funded to 1000', await setBalance(B.headers, 1000));
  check('A balance = 1000', (await balance(A.headers)) === 1000, `got ${await balance(A.headers)}`);
  check('B balance = 1000', (await balance(B.headers)) === 1000, `got ${await balance(B.headers)}`);

  console.log('\n=== 1. open_duel debits the stake ===');
  const o1 = await rpc(A.headers, 'open_duel', { p_game_id: GAME, p_stake: STAKE, p_payout: PAYOUT });
  if (o1.status !== 200) {
    console.log(`  open_duel -> HTTP ${o1.status}`);
    console.log(`  ${JSON.stringify(o1.body).slice(0, 300)}`);
    if (/must be signed in/i.test(JSON.stringify(o1.body))) console.log('>>> auth.uid() was null inside the function.');
    else if (/No wallet found/i.test(JSON.stringify(o1.body))) console.log('>>> No profiles row for this user.');
    else if (/Insufficient balance/i.test(JSON.stringify(o1.body))) {
      console.log('>>> The wallet is short. Scenario 0 should have funded it --');
      console.log('>>> if this fires, the funding PATCH in section 0 was blocked by RLS.');
    }
    else if (/42804|is of type uuid but expression is of type text/i.test(JSON.stringify(o1.body)))
      console.log('>>> stake_challenges.id is uuid but the function inserted a text id.');
    else if (/does not exist/i.test(JSON.stringify(o1.body)))
      console.log('>>> A COLUMN THE FUNCTION WRITES IS MISSING (see the columnExists check).');
    else console.log('>>> MIGRATION NOT APPLIED? Run 20261001000000_reconcile_live_schema.sql.');
    process.exit(0);
  }
  const cid = o1.body.challenge_id;
  check('challenge_id returned', !!cid, cid);
  check('A debited 1000 -> 0', (await balance(A.headers)) === 0, `got ${await balance(A.headers)}`);

  console.log('\n=== 2. second player stakes the same amount ===');
  const o2 = await rpc(B.headers, 'open_duel', { p_game_id: GAME, p_stake: STAKE, p_payout: PAYOUT });
  check('B opened a duel', o2.status === 200, JSON.stringify(o2.body).slice(0, 120));
  const cid2 = o2.body?.challenge_id;
  check('B debited 1000 -> 0', (await balance(B.headers)) === 0, `got ${await balance(B.headers)}`);

  console.log('\n=== 3. settle: A scores 500, B scores 900 (B should win) ===');
  const s1 = await rpc(A.headers, 'settle_duel', { p_challenge_id: cid, p_score: 500 });
  check('A submitted a score', s1.status === 200, JSON.stringify(s1.body).slice(0, 140));
  const s2 = await rpc(B.headers, 'settle_duel', { p_challenge_id: cid2, p_score: 900 });
  check('B matched the duel', s2.body?.matched === true, JSON.stringify(s2.body).slice(0, 160));
  check('B won', s2.body?.won === true);
  check('opponent_score = A score (500)', Number(s2.body?.opponent_score) === 500, `got ${s2.body?.opponent_score}`);

  console.log('\n=== 4. payouts moved correctly ===');
  const balA = await balance(A.headers), balB = await balance(B.headers);
  check('A balance = 0 (lost stake)', balA === 0, `got ${balA}`);
  check('B balance = 1800 (won, 10% rake held)', balB === 1800, `got ${balB}`);

  console.log('\n=== 5. double-settle is rejected ===');
  const again = await rpc(A.headers, 'settle_duel', { p_challenge_id: cid, p_score: 500 });
  check('re-settle blocked', again.status >= 400, `HTTP ${again.status} :: ${JSON.stringify(again.body).slice(0, 80)}`);

  console.log('\n=== 6. cancel_duel refunds 80% ===');
  const o3 = await rpc(B.headers, 'open_duel', { p_game_id: 'breakout', p_stake: 500, p_payout: 900 });
  check('B opened a 500 duel', o3.status === 200);
  check('B debited 500 -> 1300', (await balance(B.headers)) === 1300, `got ${await balance(B.headers)}`);
  const c = await rpc(B.headers, 'cancel_duel', { p_challenge_id: o3.body?.challenge_id });
  check('cancelled', c.body?.cancelled === true, JSON.stringify(c.body).slice(0, 120));
  check('refunded exactly 400 (80% of 500)', Number(c.body?.refunded) === 400, `got ${c.body?.refunded}`);
  // 1700, not 1800. cancel_duel() returns 80% of the stake and retains a 20%
  // cancellation fee, so B is deliberately 100 (20% of 500) down on the 1800 it
  // won. The old assertion expected 1800 and treated the correctly-retained fee
  // as a shortfall, then carried that same -100 error into step 7 as well.
  check('B balance back to 1700 (100 fee retained)', (await balance(B.headers)) === 1700, `got ${await balance(B.headers)}`);

  console.log('\n=== 7. tie refunds both stakes in full ===');
  // A lost its stake in scenario 3, so fund it for exactly this stake.
  //
  // 500, not 200: open_duel() enforces a MEMBERSHIP test against the approved
  // presets {100, 500, 1000, 2000, 5000} (20261001000000 section 6a). 200 is
  // not one of them, so open_duel raised, t1.body.challenge_id was undefined,
  // and the settle call went out carrying only {p_score: 777} -- which
  // PostgREST reports as a missing p_challenge_id, i.e. "could not find the
  // function". That cascade made a rejected stake look like a broken RPC
  // signature for several rounds.
  check('A funded to 500', await setBalance(A.headers, 500));
  const t1 = await rpc(A.headers, 'open_duel', { p_game_id: 'hextris', p_stake: 500, p_payout: 900 });
  const t2 = await rpc(B.headers, 'open_duel', { p_game_id: 'hextris', p_stake: 500, p_payout: 900 });
  check('both hextris duels opened',
    t1.status === 200 && t2.status === 200,
    `t1 HTTP ${t1.status} ${JSON.stringify(t1.body).slice(0, 80)} | t2 HTTP ${t2.status} ${JSON.stringify(t2.body).slice(0, 80)}`);
  await rpc(A.headers, 'settle_duel', { p_challenge_id: t1.body?.challenge_id, p_score: 777 });
  const ts2 = await rpc(B.headers, 'settle_duel', { p_challenge_id: t2.body?.challenge_id, p_score: 777 });
  check('tie detected', ts2.body?.is_tie === true, JSON.stringify(ts2.body).slice(0, 140));

  // A drawn duel has no winner, so the bets mirror MUST record a null
  // winner_id. The previous assertion treated any null as a failure, which is
  // exactly backwards: for a tie, null is the only correct value and naming
  // either player would be a lie about who won.
  const tieMirror = (await (await fetch(
    `${U}/rest/v1/bets?select=creator_score,opponent_score,winner_id&game_id=eq.hextris&order=created_at.desc&limit=1`,
    { headers: H }
  )).json())[0];
  check('tie mirror row written', !!tieMirror, JSON.stringify(tieMirror));
  if (tieMirror) {
    check('tie mirror winner_id is null (no winner on a draw)',
      tieMirror.winner_id === null || tieMirror.winner_id === undefined,
      `got ${tieMirror.winner_id}`);
    check('tie mirror records both sides at the tied score',
      Number(tieMirror.creator_score) === 777 && Number(tieMirror.opponent_score) === 777,
      `creator=${tieMirror.creator_score} opponent=${tieMirror.opponent_score}`);
  }
  check('A refunded to 500', (await balance(A.headers)) === 500, `got ${await balance(A.headers)}`);
  // 1700, not 1800: B opened 500 (-> 1200) and the tie refunded it in full
  // (-> 1700). The 100 gap from step 6 is the cancellation fee, which is never
  // returned. See the note there.
  check('B refunded to 1700 (fee from step 6 not returned)', (await balance(B.headers)) === 1700, `got ${await balance(B.headers)}`);

  console.log('\n=== 8. overdraft is rejected ===');
  const poor = await rpc(A.headers, 'open_duel', { p_game_id: GAME, p_stake: 99999, p_payout: 1 });
  check('insufficient balance rejected', poor.status >= 400, `HTTP ${poor.status} :: ${JSON.stringify(poor.body).slice(0, 70)}`);

  // tie_duel() and forfeit_duel() are the two draw/quit paths a client can call
  // on a duel that is still waiting. Both were undefined, so a client calling
  // them got PGRST202. They are exercised here for real, because both move money.
  console.log('\n=== 8b. tie_duel refunds both stakes in full ===');
  // Stake 500 and real game ids: open_duel() rejects any stake outside the
  // approved presets {100, 500, 1000, 2000, 5000}, and any game_id outside the
  // nine real ids. 'snake' and 'tetris' were both rejected, so this scenario
  // silently skipped itself for as long as those values were here.
  check('A funded to 500', await setBalance(A.headers, 500));
  check('B funded to 500', await setBalance(B.headers, 500));
  const td1 = await rpc(A.headers, 'open_duel', { p_game_id: 'pacman', p_stake: 500, p_payout: 900 });
  const td2 = await rpc(B.headers, 'open_duel', { p_game_id: 'pacman', p_stake: 500, p_payout: 900 });
  const openedOk = td1.status === 200 && td2.status === 200;
  check('both duels opened', openedOk,
    `td1 HTTP ${td1.status} | td2 HTTP ${td2.status} ${JSON.stringify(td2.body).slice(0, 90)}`);
  if (!openedOk) {
    console.log('>>> Skipping the tie_duel call: one of the duels did not open,');
    console.log('>>> so there is no challenge_id to tie.');
  } else {
    const tied = await rpc(A.headers, 'tie_duel', { p_challenge_id: td1.body.challenge_id });
    // The deployed tie_duel() does not return settle_duel's 'is_tie' key. It
    // reports the draw as 'tie'/'tied' (with 'ok'/'matched'/'success' as the
    // acceptance flags), so assert on what it actually returns.
    check('tie accepted',
      tied.body?.tie === true || tied.body?.tied === true || tied.body?.is_tie === true,
      JSON.stringify(tied.body).slice(0, 130));
    check('A refunded to 500', (await balance(A.headers)) === 500, `got ${await balance(A.headers)}`);
    check('B refunded to 500', (await balance(B.headers)) === 500, `got ${await balance(B.headers)}`);
  }

  console.log('\n=== 8c. forfeit_duel pays the opponent, forfeiter gets nothing ===');
  check('A funded to 500', await setBalance(A.headers, 500));
  check('B funded to 500', await setBalance(B.headers, 500));
  const fd1 = await rpc(A.headers, 'open_duel', { p_game_id: 'neon-serpent', p_stake: 500, p_payout: 900 });
  // Opened but never settled: forfeit_duel() pairs against any waiting
  // challenge of the same game and stake, so B's does not need to be settled.
  const fd2 = await rpc(B.headers, 'open_duel', { p_game_id: 'neon-serpent', p_stake: 500, p_payout: 900 });
  const fOpenedOk = fd1.status === 200 && fd2.status === 200;
  check('both duels opened', fOpenedOk, `fd1 HTTP ${fd1.status} | fd2 HTTP ${fd2.status}`);
  if (!fOpenedOk) {
    console.log('>>> Skipping the forfeit_duel call: one of the duels did not open.');
  } else {
    const ff = await rpc(A.headers, 'forfeit_duel', { p_challenge_id: fd1.body.challenge_id });
    check('forfeit accepted', ff.body?.forfeited === true, JSON.stringify(ff.body).slice(0, 130));
    check('A keeps nothing (forfeited the stake)', (await balance(A.headers)) === 0, `got ${await balance(A.headers)}`);
    check('B won the payout 900', (await balance(B.headers)) === 900, `got ${await balance(B.headers)}`);
  }

  console.log('\n=== 9. different stakes do NOT match ===');
  // THIS IS THE REGRESSION TEST FOR THE STAKE-FILTER HOLE.
  //
  // The hand-patched settle_duel() that was live on production matched on
  // opponent_id alone, so two players who staked DIFFERENT amounts were matched
  // and settled against each other. 300 vs 700 returned matched=true. With the
  // restored function the `and c.stake = mine.stake` predicate makes that
  // impossible, so both rows must come back unmatched and each player keeps
  // waiting.
  //
  // 500 and 1000 are the two cheapest DISTINCT approved presets, so the wallets
  // only have to cover 500 each and the scenario stays cheap to run.
  check('A funded to 500', await setBalance(A.headers, 500));
  check('B funded to 1000', await setBalance(B.headers, 1000));
  const d1 = await rpc(A.headers, 'open_duel', { p_game_id: 'piano-tiles', p_stake: 500, p_payout: 900 });
  const d2 = await rpc(B.headers, 'open_duel', { p_game_id: 'piano-tiles', p_stake: 1000, p_payout: 1800 });

  // Assert both opens succeeded BEFORE settling either.
  //
  // Without this the run produced this baffling error:
  //   PGRST202: Could not find the function public.settle_duel with parameter
  //             p_score or with a single unnamed json/jsonb parameter
  // which reads like a broken function signature but is not one. When
  // open_duel() fails, d2.body.challenge_id is undefined, JSON.stringify DROPS
  // undefined keys, so the settle call goes out carrying only {p_score: 10} --
  // and PostgREST reports a missing p_challenge_id as "could not find the
  // function". A missing wallet balance therefore presented as a broken RPC
  // signature, which sent the investigation down the wrong path entirely.
  if (d1.status !== 200 || d2.status !== 200) {
    check('both piano-tiles duels opened', false,
      `d1 HTTP ${d1.status} ${JSON.stringify(d1.body).slice(0, 90)} | d2 HTTP ${d2.status} ${JSON.stringify(d2.body).slice(0, 90)}`);
    console.log('>>> Cannot run step 9: an open_duel call failed, so there is');
    console.log('>>> no challenge_id to settle. Check the balances above.');
  } else {
    check('both piano-tiles duels opened', true);
    await rpc(A.headers, 'settle_duel', { p_challenge_id: d1.body.challenge_id, p_score: 1000 });
    const dm = await rpc(B.headers, 'settle_duel', { p_challenge_id: d2.body.challenge_id, p_score: 10 });
    check('unmatched (stakes differ)', dm.body?.matched === false, JSON.stringify(dm.body).slice(0, 140));
  }

  console.log('\n=== 10. bets feed is readable for Live Results ===');
  const br = await fetch(`${U}/rest/v1/bets?select=id,game_title,score,stake&order=created_at.desc&limit=3`, { headers: H });
  const brows = JSON.parse(await br.text());
  check('bets query returns 200', br.status === 200, `${brows.length} row(s)`);

  // The settle_duel() mirror into bets had two bugs. First it passed `winner_id`
  // -- a COLUMN name -- as a VALUE in an INSERT ... VALUES list, which has no
  // FROM clause, so it raised 42703 and the settlement failed AFTER the wallets
  // had been paid. Second it recorded p_score as creator_score, so the row
  // described whoever settled LAST rather than whose stake it was, which made
  // creator_score and opponent_score the same number and left winner_id null on
  // a decisive result.
  //
  // The mirror is anchored to the challenge owner, so both of these checks are
  // written against the OWNER's two scores, not the caller's.
  console.log('\n=== 11. settle_duel wrote its bets mirror row ===');
  const bm = await fetch(
    `${U}/rest/v1/bets?select=id,user_id,opponent_id,score,stake,creator_score,opponent_score,winner_id&game_id=eq.${GAME}&order=created_at.desc&limit=5`,
    { headers: H }
  );
  const bmrows = JSON.parse(await bm.text());
  check('bets mirror query returns 200', bm.status === 200, JSON.stringify(bmrows).slice(0, 90));

  // Match on the pair of scores rather than one of them. The old assertion
  // looked for score===500 alone, which also matched the stale row left behind
  // by a previous run and so passed or failed for reasons unrelated to this one.
  const mirror = bmrows.find(
    r => Number(r.creator_score) === 500 && Number(r.opponent_score) === 900
  );
  check('mirror row for the 500-vs-900 duel exists', !!mirror, JSON.stringify(bmrows).slice(0, 200));
  if (mirror) {
    check('mirror stake = 1000', Number(mirror.stake) === STAKE, `got ${mirror.stake}`);
    check('mirror score is the higher of the two', Number(mirror.score) === 900, `got ${mirror.score}`);

    // B scored 900 and won, so winner_id must be B's uuid. Asserting only
    // `!!winner_id` would have passed on the old broken null; asserting it is a
    // non-null uuid that is NOT player A is what actually pins the value down.
    check('mirror winner_id is a uuid', /^[0-9a-f-]{36}$/i.test(mirror.winner_id || ''), `got ${mirror.winner_id}`);
    check('mirror winner_id is player B, who scored 900', mirror.winner_id === uidB, `got ${mirror.winner_id}, expected ${uidB}`);
    check('mirror winner_id is not the losing player A', mirror.winner_id !== uidA, `got ${mirror.winner_id}`);

    // The row must describe exactly the two players in this duel, not a
    // leftover from an earlier run.
    check('mirror participants are A and B',
      [mirror.user_id, mirror.opponent_id].sort().join() === [uidA, uidB].sort().join(),
      `user=${mirror.user_id} opponent=${mirror.opponent_id}`);
  }

  // The rpc signatures were already proven above, before any scenario ran, so
  // reaching this point means they all resolve.
  console.log('\n=== schema pre-flight ===');
  for (const [t, c] of [
    ['stake_challenges', 'refund_amount'], ['stake_challenges', 'winner_id'],
    ['stake_challenges', 'opponent_id'], ['bets', 'creator_score'],
    ['bets', 'opponent_score'], ['bets', 'winner_id'], ['transactions', 'title']
  ]) check(`${t}.${c} exists`, await columnExists(A.headers, t, c));

  console.log('\n=== cleanup: resetting both wallets to 0 ===');
  await resetWallet(A.headers);
  await resetWallet(B.headers);
  console.log(`  A = ${await balance(A.headers)}   B = ${await balance(B.headers)}`);

  console.log(`\n${'='.repeat(52)}`);
  console.log(fails.length
    ? `${fails.length} CHECK(S) FAILED:\n - ${fails.join('\n - ')}`
    : 'ALL CHECKS PASSED -- every financial scenario behaved correctly');
  console.log('Delete these two test accounts when you are done.');
})();
