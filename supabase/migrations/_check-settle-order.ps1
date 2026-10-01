# Static check of the settle_duel body: confirm the operations happen in the
# intended order and that no stale p_score survives downstream of the match.

$f = 'c:\Users\owner\Desktop\ODDDZONE _PROJECT\supabase\migrations\20261001000000_reconcile_live_schema.sql'
$t = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($f))

Write-Output ('dollar-quotes : ' + ([regex]::Matches($t, '\$\$')).Count + '  (must be even)')
Write-Output ('functions     : ' + ([regex]::Matches($t, 'create or replace function')).Count)
Write-Output ''

# Isolate the settle_duel body.
$s = $t.IndexOf('create or replace function public.settle_duel')
$e = $t.IndexOf('$$;', $s)
if ($s -lt 0 -or $e -lt 0) { Write-Output 'could not locate settle_duel body'; exit 1 }
$body = $t.Substring($s, $e - $s)

Write-Output '--- settle_duel: order of operations (offset must increase) ---'
$steps = @(
  'my_score := greatest',
  'select * into opp_row',
  'Refusing to self-match',
  'set score  = my_score',
  'if my_score > opp_row.score',
  'insert into public.bets'
)
$prev = -1
foreach ($k in $steps) {
  $i = $body.IndexOf($k)
  $ok = if ($i -gt $prev) { 'ok' } else { 'OUT OF ORDER' }
  Write-Output ('  {0,6}  {1,-32} {2}' -f $i, $k, $ok)
  $prev = $i
}

Write-Output ''
Write-Output '--- declarations ---'
Write-Output ('  my_score declared : ' + $body.Contains('my_score bigint;'))

Write-Output ''
Write-Output '--- self-match guards ---'
Write-Output ('  c.user_id <> me       : ' + $body.Contains('c.user_id <> me'))
Write-Output ('  c.id::text <> param   : ' + $body.Contains('c.id::text <> p_challenge_id'))
Write-Output ('  explicit self-match raise : ' + $body.Contains('Refusing to self-match'))

Write-Output ''
Write-Output '--- stale p_score after the match point (must be none) ---'
$tail = $body.Substring($body.IndexOf('opp_id := opp_row.user_id;'))
$hits = $tail -split "`n" | Select-String -Pattern 'p_score'
if ($hits) { $hits | ForEach-Object { '    STALE: ' + $_.ToString().Trim() } } else { '    none - all downstream reads use my_score' }

Write-Output ''
Write-Output '--- queueing path still writes the score (critical) ---'
Write-Output ('  update on the no-opponent path : ' + $body.Contains('set score  = my_score'))
Write-Output ('  that update precedes the early return : ' +
  ($body.IndexOf('set score  = my_score') -lt $body.IndexOf("'matched', false")))

Write-Output ''
Write-Output '--- the single matched UPDATE ---'
$u = $body.IndexOf('set status      = ''matched''')
if ($u -ge 0) {
  $seg = $body.Substring($u, 400)
  Write-Output ($seg -split "`n" | Select-Object -First 6 | ForEach-Object { '    ' + $_.Trim() } | Out-String).Trim()
}
