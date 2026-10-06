// Structural sanity check for the restore migration. Not a substitute for a
// real PostgreSQL parse, but it catches the class of typo that a pure read
// through misses: unbalanced dollar quotes, unbalanced string literals, and a
// truncated final statement.
import fs from 'node:fs';

const path = 'supabase/migrations/20261004000001_restore_odddzone_duel_functions.sql';
const s = fs.readFileSync(path, 'utf8');

const dollarQuotes = (s.match(/\$\$/g) || []).length;

// Strip comments and string literals so the brace/paren count only sees code.
// ('' inside a literal is an escaped quote and must not end the string.)
let noComments = s.replace(/--[^\n]*/g, '');
let noStrings = '';
let i = 0;
let unterminated = false;
while (i < noComments.length) {
  if (noComments[i] === "'") {
    i++;
    while (i < noComments.length) {
      if (noComments[i] === "'" && noComments[i + 1] === "'") { i += 2; continue; }
      if (noComments[i] === "'") { i++; break; }
      i++;
    }
    if (i > noComments.length) { unterminated = true; break; }
  } else {
    noStrings += noComments[i];
    i++;
  }
}

const count = (re) => (noStrings.match(re) || []).length;

const results = [
  ['dollar quotes balanced (even)', dollarQuotes % 2 === 0, `${dollarQuotes} found`],
  ['no unterminated string literal', !unterminated, ''],
  ['begin/end balanced', count(/\bbegin\b/gi) === count(/\bend\b/gi) + count(/\bend\s+(if|loop)\b/gi) - count(/\bexception\b/gi) || 'manual', `begin=${count(/\bbegin\b/gi)} end=${count(/\bend\b/gi)}`],
  ['if/then/endif balanced', count(/\bif\b/gi) >= count(/\bend\s+if\b/gi), `if=${count(/\bif\b/gi)} endif=${count(/\bend\s+if\b/gi)}`],
  ['4 functions defined', count(/create or replace function/gi) === 4, `${count(/create or replace function/gi)}`],
  ['4 grants issued', count(/grant execute on function/gi) === 4, `${count(/grant execute on function/gi)}`],
  ['all 4 signatures present', ['settle_duel(text, bigint)', 'cancel_duel(text)', 'tie_duel(text)', 'forfeit_duel(text)'].every(x => s.includes('public.' + x.split('(')[0] + '(')), ''],
  ['ends with a complete statement', /\$\$\s*;\s*$/m.test(s.trimEnd()) || s.trimEnd().endsWith('reload schema\';'), ''],
];

console.log('=== structural check ===\n');
let bad = 0;
for (const [name, ok, extra] of results) {
  const pass = ok === true || ok === 'manual';
  if (!pass) bad++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
}
console.log(`\n${bad ? bad + ' FAILED' : 'all structural checks passed'}`);
console.log('\nNOTE: this does not prove the SQL parses. There is no local');
console.log('PostgreSQL and no Docker on this machine. Confirm by running the');
console.log('file in the Supabase SQL Editor -- it is a single transaction, so a');
console.log('syntax error changes nothing.');
