// Verify that supabase/migrations/20261004000001_restore_odddzone_duel_functions.sql
// is syntactically valid and self-consistent, by loading it into a real
// PostgreSQL instance. Read-only w.r.t. any Supabase project: the DB is local
// and disposable, and the script creates its own throwaway schema.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

// ── Locate a postgres binary ───────────────────────────────────────────────
const candidates = [
  'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe',
  'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe',
  'C:\\Program Files\\PostgreSQL\\15\\bin\\psql.exe',
  'C:\\Program Files\\PostgreSQL\\14\\bin\\psql.exe',
  'C:\\Program Files\\PostgreSQL\\13\\bin\\psql.exe',
  'C:\\Program Files\\PostgreSQL\\12\\bin\\psql.exe',
  'C:\\Program Files\\PostgreSQL\\11\\bin\\psql.exe',
];
const psql = candidates.find(p => fs.existsSync(p));
if (!psql) {
  console.log('SKIP: no local PostgreSQL found. Checked:');
  candidates.forEach(c => console.log('   ' + c));
  console.log('Install PostgreSQL, or paste the file into the Supabase SQL Editor.');
  process.exit(2);
}

const sqlPath = 'supabase\\migrations\\20261004000001_restore_odddzone_duel_functions.sql';
const sql = fs.readFileSync(sqlPath, 'utf8');

// ── Build a throwaway schema that satisfies the pre-flight ─────────────────
const setup = `
drop schema if exists verify cascade;
create schema verify;
set search_path = verify;

create table profiles (
  id uuid primary key default gen_random_uuid(),
  username text,
  wallet_balance bigint not null default 0
);
create table transactions (
  id bigserial primary key,
  user_id uuid,
  title text,
  type text,
  amount bigint,
  detail text
);
create table bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  game_id text,
  game text,
  game_title text,
  score bigint,
  stake bigint,
  payout bigint,
  status text,
  creator_score bigint,
  opponent_score bigint,
  opponent_id uuid,
  winner_id uuid
);
create table public_profiles (
  user_id uuid primary key,
  username text,
  avatar_url text
);
create table stake_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  game_id text,
  stake bigint,
  payout bigint,
  score bigint,
  status text,
  is_solo boolean not null default false,
  opponent_id uuid,
  opponent_name text,
  opponent_avatar text,
  refund_amount bigint,
  winner_id uuid,
  created_at timestamptz not null default now()
);
create table supabase_realtime_probe (x int);
`;

// The pre-flight checks the supabase_realtime publication, which does not exist
// locally, so strip ONLY that one block for the local parse test. Everything
// else -- all four function bodies -- is checked verbatim.
const withoutPublicationCheck = sql.replace(
  /if not exists \(select 1 from pg_publication_tables[\s\S]*?then[\s\S]*?end if;\n/,
  'null;\n'
);

const run = (label, text) => {
  fs.writeFileSync('verify-tmp.sql', text);
  try {
    execSync(`& "${psql}" -X -q -v ON_ERROR_STOP=1 -f verify-tmp.sql postgres`, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log(`  PASS  ${label}`);
    return true;
  } catch (e) {
    const out = (e.stdout || '').toString() + (e.stderr || '').toString();
    console.log(`  FAIL  ${label}`);
    console.log(out.split('\n').filter(Boolean).slice(0, 12).map(l => '        ' + l).join('\n'));
    return false;
  } finally {
    if (fs.existsSync('verify-tmp.sql')) fs.unlinkSync('verify-tmp.sql');
  }
};

console.log('=== SQL parse + pre-flight verification ===\n');

run('schema fixture + pre-flight passes on a good schema', setup + withoutPublicationCheck);

// ── Now prove the pre-flight actually REJECTS a bad schema ─────────────────
// If this passes, a missing column rolls the whole migration back instead of
// letting a 42703 through.
const badSetup = setup
  .replace('is_solo boolean not null default false,\n  opponent_id uuid,', 'opponent_id uuid,')
  .replace('  opponent_name text,\n  opponent_avatar text,\n', '');
const rejectsBad = (() => {
  fs.writeFileSync('verify-tmp.sql', badSetup + withoutPublicationCheck);
  try {
    execSync(`& "${psql}" -X -q -v ON_ERROR_STOP=1 -f verify-tmp.sql postgres`, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return false; // applied when it should have refused -> pre-flight is useless
  } catch (e) {
    const out = (e.stdout || '').toString() + (e.stderr || '').toString();
    return /PRE-FLIGHT FAILED/.test(out);
  } finally {
    if (fs.existsSync('verify-tmp.sql')) fs.unlinkSync('verify-tmp.sql');
  }
})();

console.log(`  ${rejectsBad ? 'PASS' : 'FAIL'}  pre-flight REJECTS a schema missing is_solo`);
if (!rejectsBad) {
  console.log('        the guard is not firing -- do NOT apply this migration');
}

process.exit(0);
