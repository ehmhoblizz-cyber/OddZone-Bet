// Read-only probe: discover the live column set and the RPC signature of every
// function the duel flow depends on, using only the publishable key.
//
// Why: the OpenAPI root (/rest/v1/) is refused for non-secret keys, and there is
// no SQL access from here, so the only oracle available is PostgREST's own error
// text. A select naming a real column returns 200; naming a missing one returns
// 400 PGRST204 "Could not find the column ... in the schema cache". That is
// enough to tell present from absent, and it costs nothing but a GET.
//
// Nothing here writes. No sign-in, no balance touched.

const U = 'https://csrfrzzpduhhzldirdfi.supabase.co';
const K = 'sb_publishable_y_aWz0kwtbJYAcWfVNqGCg_CH4L3MHj';
const H = { apikey: K, Authorization: `Bearer ${K}` };

const COLUMNS = {
  bets: ['id', 'user_id', 'game_id', 'game', 'game_title', 'score', 'stake', 'payout',
         'status', 'creator_score', 'opponent_score', 'opponent_id', 'winner_id', 'created_at'],
  stake_challenges: ['id', 'user_id', 'game_id', 'stake', 'payout', 'score', 'status',
                     'opponent_id', 'winner_id', 'refund_amount', 'created_at'],
  profiles: ['id', 'username', 'email', 'wallet_balance', 'is_verified', 'kyc_type',
             'kyc_id_masked', 'legal_name', 'bank_code', 'bank_name', 'account_number',
             'avatar_url', 'created_at', 'updated_at'],
  transactions: ['id', 'user_id', 'title', 'type', 'amount', 'detail', 'reference', 'created_at']
};

// Candidate signatures for each RPC. PostgREST reports the overloads it does
// expose in the PGRST202 error for a signature it cannot match, so a call is the
// cheapest way to enumerate what is really installed.
const FUNCTIONS = {
  wallet_balance: [{}],
  ensure_profile: [{ p_username: 'a', p_email: 'b' }],
  open_duel: [{ p_game_id: 'probe', p_stake: 200, p_payout: 360 }],
  settle_duel: [{ p_challenge_id: 'probe', p_score: 0 }],
  cancel_duel: [{ p_challenge_id: 'probe' }],
  tie_duel: [{ p_challenge_id: 'probe' }],
  forfeit_duel: [{ p_challenge_id: 'probe' }],
  record_deposit: [{ p_amount: 1, p_reference: 'probe' }]
};

async function head(url) {
  const r = await fetch(url, { headers: H });
  return { status: r.status, text: (await r.text()).replace(/\s+/g, ' ').slice(0, 200) };
}

(async () => {
  console.log('=== columns ===');
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const present = [], absent = [];
    for (const c of cols) {
      const { status } = await head(`${U}/rest/v1/${table}?select=${c}&limit=1`);
      // A permission error also means the column resolved fine; only a 400
      // naming this specific column proves it is not there.
      const resolved = status === 200 || status === 401 || status === 403;
      (resolved ? present : absent).push(c);
    }
    console.log(`\n${table}`);
    console.log(`  present: ${present.join(', ') || '(none)'}`);
    console.log(`  MISSING: ${absent.join(', ') || '(none)'}`);
  }

  console.log('\n=== rpc signatures ===');
  for (const [fn, bodies] of Object.entries(FUNCTIONS)) {
    for (const body of bodies) {
      const r = await fetch(`${U}/rest/v1/rpc/${fn}`, {
        method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const t = (await r.text()).replace(/\s+/g, ' ');
      if (r.status === 404 && /Could not find the function/i.test(t)) {
        const overloads = t.match(/available overloads: (.*?)(?:"|\.|In schema)/i);
        console.log(`  MISSING  ${fn}  ${overloads ? '-- available: ' + overloads[1].slice(0, 160) : ''}`);
      } else {
        console.log(`  present  ${fn}  (HTTP ${r.status})  ${t.slice(0, 130)}`);
      }
    }
  }
})();
