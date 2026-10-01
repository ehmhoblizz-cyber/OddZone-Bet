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

$dbUrl = "postgresql://postgres:$($env:SUPABASE_DB_PASSWORD)@db.csrfrzzpduhhzldirdfi.supabase.co:5432/postgres"
Invoke-Cli db push --db-url $dbUrl

if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '  MIGRATION FAILED. Nothing was changed - the migration runs as one' -ForegroundColor Red
    Write-Host '  transaction, so a failure rolls the whole thing back.'
    Write-Host '  Paste the error above and send it to me.'
    exit 1
}

# ── 2. Run the duel test ─────────────────────────────────────────────────────

Write-Host ''
Write-Step '2. running the duel test'
Write-Host '  You will be prompted for the two test accounts. Nothing is stored.'
node supabase\migrations\_test-duel-flow.mjs

Write-Host ''
Write-Host '=== done ===' -ForegroundColor Green