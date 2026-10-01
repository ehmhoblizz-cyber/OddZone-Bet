# Cancel stale open test challenges via the SERVICE ROLE, because the browser
# role cannot write to stake_challenges at all.
#
# Why the browser role cannot: the only policy on public.stake_challenges is
#   for select to authenticated using (...)
# There is no INSERT, UPDATE or DELETE policy, so a PATCH from the publishable
# key matches zero rows and returns HTTP 200 with an empty body. That is a silent
# no-op -- the request succeeds and nothing happens, which is the worst possible
# failure mode for a cleanup script.
#
# That is not a defect. stake_challenges is only ever meant to be written by the
# security-definer RPCs (open_duel / settle_duel / cancel_duel / tie_duel /
# forfeit_duel), which run as the function owner and bypass RLS. The design is
# correct and is left alone.
#
# The cleanup below therefore needs the service_role key, which is NOT in the
# repo. It is read from the environment and never written anywhere.
#
#   $env:SUPABASE_SERVICE_ROLE_KEY = "sb_secret_..."
#   powershell -NoProfile -ExecutionPolicy Bypass -File supabase\migrations\_clear-stale-challenges.ps1
#
# Safety: only rows in ('queued','playing') owned by the two named test
# accounts are touched, and they are set to 'cancelled' rather than deleted, so
# the audit trail and the refundable stake both survive.

$ErrorActionPreference = 'Stop'

$base = 'https://csrfrzzpduhhzldirdfi.supabase.co'
$key  = $env:SUPABASE_SERVICE_ROLE_KEY

if (-not $key) {
  Write-Output '>>> SUPABASE_SERVICE_ROLE_KEY is not set.'
  Write-Output '>>> Set it in your shell, then re-run:'
  Write-Output '>>>   $env:SUPABASE_SERVICE_ROLE_KEY = "sb_secret_..."'
  Write-Output '>>> Find it at Supabase -> Project Settings -> API Keys.'
  Write-Output '>>> Do NOT paste it into a chat or commit it to the repo.'
  exit 1
}

$hdr = @{ apikey = $key; Authorization = "Bearer $key"; 'Content-Type' = 'application/json' }

# The two throwaway test accounts.
$testA = '075dbb2e-ccaf-42b4-bc46-1cb61abb62c5'
$testB = '83e95146-b792-4e8f-ab29-13da2a36a155'

$uri = "$base/rest/v1/stake_challenges" +
       "?status=in.(queued,playing)" +
       "&user_id=in.($testA,$testB)" +
       "&order=created_at.asc"

$rows = Invoke-RestMethod -Uri $uri -Headers $hdr
Write-Output ("stale open challenges for the two test accounts: " + @($rows).Count)
foreach ($r in $rows) {
  $ts = '?'; if ($r.created_at) { $ts = $r.created_at.Substring(11, 8) }
  Write-Output ("  " + $ts + "  " + $r.game_id.PadRight(12) + " stake=" + $r.stake + " score=" + $r.score + "  " + $r.status)
}

if (@($rows).Count -eq 0) { Write-Output 'nothing to cancel.'; exit 0 }

$patchHdr = $hdr.Clone()
$patchHdr['Prefer'] = 'return=representation'
$res = Invoke-RestMethod -Method Patch -Uri $uri -Headers $patchHdr -Body '{"status":"cancelled"}'
Write-Output ''
Write-Output ("cancelled: " + @($res).Count + " row(s)")

$after = Invoke-RestMethod -Uri "$base/rest/v1/stake_challenges?select=id&status=in.(queued,playing)&user_id=in.($testA,$testB)" -Headers $hdr
Write-Output ("still open for the test accounts: " + @($after).Count)

$all = Invoke-RestMethod -Uri "$base/rest/v1/stake_challenges?select=id&status=in.(queued,playing)" -Headers $hdr
Write-Output ("open challenges across ALL accounts: " + @($all).Count)
