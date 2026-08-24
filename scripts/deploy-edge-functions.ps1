# Requires: Supabase CLI (npx supabase --version) and a Supabase project.
# Run from the repo root.

$ErrorActionPreference = 'Stop'

$PROJECT_REF = Read-Host "Enter your Supabase project ref (xyz123.supabase.co -> xyz123)"

Write-Host "`n1/4 Logging in (browser window will open)..." -ForegroundColor Cyan
npx supabase login

Write-Host "`n2/4 Linking project $PROJECT_REF..." -ForegroundColor Cyan
npx supabase link --project-ref $PROJECT_REF

Write-Host "`n3/4 (Optional) Setting a CRON_SECRET to protect the endpoints..." -ForegroundColor Cyan
$secret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
npx supabase secrets set "CRON_SECRET=$secret"
Write-Host "CRON_SECRET generated: $secret" -ForegroundColor Yellow
Write-Host "(Save it - you'll need it for schedules.sql)"

Write-Host "`n4/4 Deploying functions..." -ForegroundColor Cyan
npx supabase functions deploy sync-stock-data
npx supabase functions deploy sync-politician-trades

Write-Host "`nDone. Next steps:" -ForegroundColor Green
Write-Host "1. Open supabase/schedules.sql"
Write-Host "2. Replace <PROJECT_REF> and <SERVICE_ROLE_KEY> (Dashboard -> Settings -> API)"
Write-Host "3. Replace x-cron-secret placeholder with the CRON_SECRET above"
Write-Host "4. Run it in Dashboard -> SQL Editor"
