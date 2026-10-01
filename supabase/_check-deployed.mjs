// Which of the migration's functions/columns are actually live RIGHT NOW?
// Answered by calling each rpc and reading the error. No credentials needed for
// the 404 "not in schema cache" cases, which is the signal that matters.
//
//   node supabase/_check-deployed.mjs

const U = 'https://csrfrzzpduhhzldirdfi.supabase.co';
const K = 'sb_publishable_y_aWz0kwtbJYAcWfVNqGCg_CH4L3MHj';
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };

async function rpc(fn, body) {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const t = (await r.text()).replace(/\s+/g, ' ');
  return { status: r.status, t };
}

console.log('=== functions: does the signature exist at all? ===');
// Each function is called with its REAL required arguments. An empty body is
// useless as a probe: PostgREST answers PGRST202 ("no match in schema cache")
// for a function with required params EVEN WHEN THE FUNCTION EXISTS, because it
// is really saying "no overload takes no arguments".
const probes = [
  ['wallet_balance', {}],
  ['open_duel', { p_game_id: 'pacman', p_stake: 200, p_payout: 360 }],
  ['settle_duel', { p_challenge_id: '00000000-0000-0000-0000-000000000000', p_score: 1 }],
  ['cancel_duel', { p_challenge_id: '00000000-0000-0000-0000-000000000000' }],
  ['ensure_profile', { p_username: 'probe', p_email: 'probe@test.com' }],
  ['record_deposit', { p_amount: 1, p_reference: 'probe' }]
];
for (const [fn, body] of probes) {
  const { status, t } = await rpc(fn, body);
  if (/PGRST202/.test(t)) console.log(`  ${fn.padEnd(16)} ABSENT  (no matching signature)`);
  else if (/permission denied/i.test(t)) console.log(`  ${fn.padEnd(16)} EXISTS, not granted to this role`);
  else if (/must be signed in|sign in/i.test(t)) console.log(`  ${fn.padEnd(16)} EXISTS (reached auth check)`);
  else console.log(`  ${fn.padEnd(16)} EXISTS   -> HTTP ${status} ${t.slice(0, 110)}`);
}

console.log('\n=== columns settle_duel / cancel_duel depend on ===');
for (const [t, c] of [
  ['stake_challenges', 'refund_amount'], ['stake_challenges', 'winner_id'],
  ['stake_challenges', 'opponent_id'], ['bets', 'creator_score'], ['bets', 'opponent_score'],
  ['transactions', 'title'], ['transactions', 'detail'], ['transactions', 'reference'],
  ['profiles', 'updated_at'], ['profiles', 'is_verified']
]) {
  const r = await fetch(`${U}/rest/v1/${t}?select=${c}&limit=1`, { headers: H });
  console.log(`  ${t}.${c.padEnd(14)} ${r.ok ? 'exists' : 'MISSING'}`);
}

console.log('\n=== is there a transaction from my new open_duel? (ledger write works?) ===');
const tx = await fetch(`${U}/rest/v1/transactions?select=title,type,amount&order=created_at.desc&limit=3`, { headers: H });
console.log('  ' + (await tx.text()).slice(0, 300));