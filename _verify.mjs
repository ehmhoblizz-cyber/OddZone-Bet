const U = 'https://csrfrzzpduhhzldirdfi.supabase.co';
const K = 'sb_publishable_y_aWz0kwtbJYAcWfVNqGCg_CH4L3MHj';
const H = { apikey: K, Authorization: `Bearer ${K}` };

(async () => {
  // The exact fallback query renderRemoteScores() now issues.
  const q = 'id, game_title, game_id, score, stake, status, created_at, user_id';
  const r = await fetch(`${U}/rest/v1/bets?select=${encodeURIComponent(q)}&order=created_at.desc&limit=10`, { headers: H });
  console.log(`bets fallback query -> HTTP ${r.status}`);
  console.log(`  ${(await r.text()).slice(0, 200)}`);

  // The first query it tries.
  const q2 = 'id, game_id, score, stake, status, created_at, user_id';
  const r2 = await fetch(`${U}/rest/v1/stake_challenges?select=${encodeURIComponent(q2)}&score=not.is.null&score=gt.0&order=created_at.desc&limit=10`, { headers: H });
  console.log(`\nstake_challenges query -> HTTP ${r2.status}`);
  console.log(`  ${(await r2.text()).slice(0, 200)}`);

  // The profile insert shape (no longer sends is_verified).
  const r3 = await fetch(`${U}/rest/v1/profiles?select=*&limit=1`, { headers: H });
  const rows = JSON.parse(await r3.text());
  console.log(`\nprofiles select=* -> HTTP ${r3.status}, cols: ${Object.keys(rows[0] || {}).join(', ')}`);
})();
