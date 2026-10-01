// Confirms, without SQL-editor access, the root cause of the HTTP 400 from
// open_duel(): stake_challenges.id is uuid in this project, but the migration
// inserted a text literal ('CHLG-...').
//
// Trick: PostgREST will reject a non-uuid value used as a *value* on a uuid
// column, and a non-numeric value on a bigint column. The error message names
// the type, so the schema can be read out of the error text.
//
//   node supabase/_check-types.mjs

const U = 'https://csrfrzzpduhhzldirdfi.supabase.co';
const K = 'sb_publishable_y_aWz0kwtbJYAcWfVNqGCg_CH4L3MHj';
const H = { apikey: K, Authorization: `Bearer ${K}` };

async function typeVia(table, column, probeValue) {
  const r = await fetch(`${U}/rest/v1/${table}?select=id&${column}=eq.${encodeURIComponent(probeValue)}`, { headers: H });
  const t = (await r.text()).replace(/\s+/g, ' ');
  const m = t.match(/invalid input syntax for type (\w+)/i);
  if (m) return `TYPE ${m[1]}`;
  if (/PGRST100|parsing error/i.test(t)) return `TYPE (non-numeric: ${t.slice(0, 70)})`;
  return `text-or-unknown 200/204 ${t.slice(0, 60)}`;
}

console.log('=== column types, read out of Postgres error text ===');
const rows = [
  ['stake_challenges', 'id',      'CHLG-123',  'text id  -> errors as uuid?'],
  ['stake_challenges', 'user_id', 'CHLG-123',  'uuid'],
  ['bets',              'id',      'CHLG-123',  'uuid'],
  ['pending_bets',      'id',      'CHLG-123',  'uuid'],
  ['profiles',          'id',      'CHLG-123',  'uuid'],
  ['profiles',          'wallet_balance', 'not-a-number', 'bigint']
];
for (const [t, c, v, note] of rows)
  console.log(`  ${t}.${c.padEnd(15)} ${(await typeVia(t, c, v)).padEnd(38)} (expected: ${note})`);

console.log('\n=== does a text value work as a filter on stake_challenges.id? ===');
console.log('  A 200/204 means the column accepts text (type text).');
console.log('  A 22P02 error means it does not (type uuid) -> that is the bug.');

console.log('\n=== columns cancel_duel/settle_duel depend on ===');
for (const [t, c] of [['stake_challenges', 'refund_amount'], ['stake_challenges', 'winner_id'], ['bets', 'creator_score'], ['transactions', 'title']]) {
  const r = await fetch(`${U}/rest/v1/${t}?select=${c}&limit=1`, { headers: H });
  console.log(`  ${t}.${c}: ${r.ok ? 'exists' : (await r.text()).replace(/\s+/g, ' ').slice(0, 90)}`);
}