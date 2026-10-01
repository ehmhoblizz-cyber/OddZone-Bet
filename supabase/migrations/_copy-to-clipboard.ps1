$ErrorActionPreference = 'Stop'
$root = 'c:\Users\owner\Desktop\ODDDZONE _PROJECT'
$f = Join-Path $root 'supabase\migrations\20261001000000_reconcile_live_schema.sql'

Write-Output ('PowerShell: ' + $PSVersionTable.PSVersion)

# Read the file as explicit UTF-8 bytes rather than Get-Content, so nothing
# depends on the console or PowerShell's default encoding guess.
$bytes = [System.IO.File]::ReadAllBytes($f)
$text = [System.Text.Encoding]::UTF8.GetString($bytes)

Write-Output ('file bytes      : ' + $bytes.Length)
Write-Output ('file chars      : ' + $text.Length)
$nonAscii = ([regex]::Matches($text, '[^\x00-\x7F]')).Count
Write-Output ('non-ascii chars : ' + $nonAscii)

Set-Clipboard -Value $text
$clip = Get-Clipboard -Raw

Write-Output ''
Write-Output '--- round trip ---'
Write-Output ('clipboard chars : ' + $clip.Length)
Write-Output ('exact match (case-sensitive ordinal): ' + ($clip -ceq $text))

Write-Output ''
Write-Output '--- integrity markers ---'
# The three fixes must be present...
Write-Output ('fix 1  settles winner (not winner_id): ' + $text.Contains('opp_id, winner)'))
Write-Output ('fix 2  tie_duel defined              : ' + $text.Contains('create or replace function public.tie_duel'))
Write-Output ('fix 2  forfeit_duel defined          : ' + $text.Contains('create or replace function public.forfeit_duel'))
# ...and the original bug must be gone.
Write-Output ('stale winner_id in VALUES gone      : ' + (-not $text.Contains('opp_id, winner_id)')))

Write-Output ''
Write-Output '--- encoding ---'
$enDash = [char]0x2013
$box = [char]0x2500
Write-Output ('no U+FFFD replacement char : ' + (-not $clip.Contains([char]0xFFFD)))
Write-Output ('en-dash U+2013 survived    : ' + $clip.Contains($enDash))
Write-Output ('box-drawing U+2500 survived: ' + $clip.Contains($box))

Write-Output ''
Write-Output '--- structure ---'
$dq = ([regex]::Matches($text, '\$\$')).Count
Write-Output ('dollar-quote tokens: ' + $dq + ' (even = balanced)')
Write-Output ('begins with BEGIN marker: ' + $text.TrimStart().ToLower().Contains('begin;'))
Write-Output ('ends with COMMIT marker : ' + $text.TrimEnd().ToLower().EndsWith('commit;'))
Write-Output ('function definitions    : ' + ([regex]::Matches($text, 'create or replace function')).Count)
