# ─────────────────────────────────────────────
# apply-migration-and-test.ps1
#
# Pushes supabase/migrations/*.sql to the linked Supabase project, then runs the
# two-player duel simulation against the live database.
#
# SETUP ONCE
#
#   1. Install the CLI:            npm install -g supabase
#      (not required - this script falls back to npx.cmd automatically)
#
#   2. Log in (opens a browser):   supabase login
#
#   3. Set the database password:
#        Project Settings -> Database -> reset the password if needed, then
#        setx SUPABASE_DB_PASSWORD "your-db-password"
#        and CLOSE AND REOPEN this terminal so it picks the variable up.
#
#      This is the database password, NOT your supabase account password.
#
# THEN RUN:  .\supabase\apply-migration-and-test.ps1
#
# The migration is idempotent, so re-running this script is safe.
# ─────────────────────────────────────────────

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Write-Step($m) { Write-Host "=== $m ===" }

# ── Which CLI? ───────────────────────────────────────────────────────────────

$hasGlobal = [bool](Get-Command supabase -ErrorAction SilentlyContinue)

if ($hasGlobal) {
    $cli = @('supabase')
} else {
    if (-not (Get-Command npx.cmd -ErrorAction SilentlyContinue)) {
        Write-Host '  MISSING: npx - install Node.js and retry.' -ForegroundColor Red
        exit 1
    }
    $cli = @('npx.cmd', '--yes', 'supabase@latest')
}

function Invoke-Cli {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CliArgs)
    & $cli[0] @($cli[1..($cli.Count - 1)]) @CliArgs
}

Write-Step 'checking prerequisites'
Invoke-Cli --version
if ($LASTEXITCODE -ne 0) {
    Write-Host '  MISSING: could not run the Supabase CLI.' -ForegroundColor Red
    exit 1
}

# ── Credentials ──────────────────────────────────────────────────────────────

$tokenPath = Join-Path $env:USERPROFILE '.supabase\access-token'
if (-not (Test-Path $tokenPath)) {
    Write-Host ''
    Write-Host '  MISSING: you are not logged in to Supabase.' -ForegroundColor Yellow
    Write-Host '  Run:  supabase login'
    Write-Host '  That opens a browser so you can authorise.'
    exit 1
}

if (-not $env:SUPABASE_DB_PASSWORD) {
    Write-Host ''
    Write-Host '  MISSING: SUPABASE_DB_PASSWORD is not set.' -ForegroundColor Yellow
    Write-Host '  Project Settings -> Database -> reset the password if needed, then:'
    Write-Host '  setx SUPABASE_DB_PASSWORD "your-db-password"'
    Write-Host '  and reopen this terminal.'
    exit 1
}

# ── 1. Push the migration ────────────────────────────────────────────────────

Write-Host ''
Write-Step '1. pushing the migration'
Write-Host '  host db.csrfrzzpduhhzldirdfi.supabase.co'

# Record the highest version on disk BEFORE pushing.
#
# `supabase db push` decides what to run by comparing file VERSIONS (the numeric
# filename prefix) against the versions recorded in
# supabase_migrations.schema_migrations. It does NOT look at file contents. So
# editing a migration that has already run changes nothing: the CLI sees a
# version it already has, skips the file, prints nothing, and still exits 0. A
# corrected migration therefore has to be renamed to a HIGHER version.
#
# This is not hypothetical: a corrected migration kept its original version, the
# push printed "=== done ===" and exited 0, and the database silently kept
# running the broken version for a whole cycle.
$migrationDir = Join-Path $PSScriptRoot 'migrations'
$latestOnDisk = Get-ChildItem $migrationDir -Filter '*.sql' |
    Where-Object { $_.BaseName -match '^(\d{8,})_' } |
    ForEach-Object { [int64]$Matches[1] } |
    Sort-Object -Descending |
    Select-Object -First 1

if (-not $latestOnDisk) {
    Write-Host ''
    Write-Host '  MISSING: no versioned .sql migration found.' -ForegroundColor Red
    exit 1
}

Write-Host "  newest migration version: $latestOnDisk"

$dbUrl = "postgresql://postgres:$($env:SUPABASE_DB_PASSWORD)@db.csrfrzzpduhhzldirdfi.supabase.co:5432/postgres"
$pushOutput = Invoke-Cli db push --db-url $dbUrl 2>&1 | Out-String
Write-Host $pushOutput

if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '  MIGRATION FAILED. Nothing was changed - the migration runs as one' -ForegroundColor Red
    Write-Host '  transaction, so a failure rolls the whole thing back.'
    Write-Host '  Paste the error above and send it to me.'
    exit 1
}

# ── 1a. Confirm the push actually applied something ─────────────────────────

# "db push" exiting 0 only means it did not error. It also exits 0 when there
# was nothing to do, which in the output above is indistinguishable from a real
# success. Assert against the CLI's own wording instead of trusting the exit
# code, and fail loudly rather than letting a no-op pass as a success.
if ($pushOutput -match 'No pending migrations|already applied|up to date') {
    Write-Host ''
    Write-Host '  NOTHING WAS APPLIED.' -ForegroundColor Red
    Write-Host '  The CLI reports every migration on disk as already applied.'
    Write-Host ''
    Write-Host '  If you have just CORRECTED a migration file, that fix did NOT' -ForegroundColor Yellow
    Write-Host '  run. Supabase tracks migrations by the numeric filename prefix,' -ForegroundColor Yellow
    Write-Host '  not by file contents, so editing a file in place is a no-op.' -ForegroundColor Yellow
    Write-Host ''
    Write-Host "  Fix: rename it to a version HIGHER than $latestOnDisk," -ForegroundColor Yellow
    Write-Host '  then run this script again.' -ForegroundColor Yellow
    exit 1
}

Write-Host '  push reported migrations applied.' -ForegroundColor Green

# ── 2. Run the duel test ─────────────────────────────────────────────────────

Write-Host ''
Write-Step '2. running the duel test'
Write-Host '  You will be prompted for the two test accounts. Nothing is stored.'
node supabase\migrations\_test-duel-flow.mjs

Write-Host ''
Write-Host '=== done ===' -ForegroundColor Green