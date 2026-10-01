// Read-only: try to retrieve the DEFINITION of the live settle_duel().
//
// The bets rows in the database do not match what the migration file on disk
// says settle_duel() does: the observed rows have creator_score equal to
// opponent_score and a null winner_id, and one exists for a duel the test
// reported as UNMATCHED. The insert in the file returns early when there is no
// opponent, so it cannot have produced that row.
//
// Rather than keep guessing which version is deployed, this probes the
// read-only SQL escape hatches an admin sometimes exposes. If none answer, the
// deployed source has to be read from the Supabase dashboard.
//
// Nothing here writes.

const U = 'https://csrfrzzpduhhzldirdfi.supabase.co';
const K = 'sb_publishable_y_aWz0kwtbJYAcWfVNqGCg_CH4L3MHj';
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };

// Ways a project sometimes exposes the live schema definition.
const ATTEMPTS = [
  // Supabase's own helper, if enabled.
  ['rpc/exec_sql', { query: "select prosrc from pg_proc where proname = 'settle_duel'" }],
  ['rpc/execute_sql', { query: "select prosrc from pg_proc where proname = 'settle_duel'" }],
  ['rpc/run_sql', { sql: "select prosrc from pg_proc where proname = 'settle_duel'" }],
  ['rpc/query', { query: "select prosrc from pg_proc where proname = 'settle_duel'" }],
  ['rpc/sql', { query: "select prosrc from pg_proc where proname = 'settle_duel'" }],
  // The migration ledger, if the table is readable.
  ['rpc/get_migrations', {}]
];

(async () => {
  for (const [path, body] of ATTEMPTS) {
    const r = await fetch(`${U}/rest/v1/${path}`, {
      method: 'POST', headers: H, body: JSON.stringify(body)
    });
    const t = (await r.text()).replace(/\s+/g, ' ').slice(0, 220);
    const notThere = /Could not find the function|PGRST202|does not exist/i.test(t);
    console.log(
      `${notThere ? 'absent   ' : 'ANSWERED '} ${path.padEnd(22)} HTTP ${r.status}  ${t}`
    );
  }

  // Regardless of the above, report what the ledger says if it is readable, and
  // confirm the current state of the mirror rows so the next step is unambiguous.
  console.log('\n=== current bets mirror rows (raw) ===');
  const r = await fetch(
    `${U}/rest/v1/bets?select=game_id,score,creator_score,opponent_score,winner_id,opponent_id,user_id&order=created_at.desc&limit=5`,
    { headers: H }
  );
  const rows = await r.json();
  for (const b of rows) {
    console.log(
      `  ${String(b.game_id).padEnd(12)} score=${String(b.score).padEnd(5)} ` +
      `creator=${String(b.creator_score).padEnd(5)} opponent=${String(b.opponent_score).padEnd(5)} ` +
      `winner=${b.winner_id || 'NULL'}`
    );
  }
})();
