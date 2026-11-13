<#
.SYNOPSIS
  One-time move of the live database from the EC2 Postgres container to RDS.

.DESCRIPTION
  Downtime starts when the API stops and ends when it is back on RDS (~5-10 min).
  1. Stop the API so nothing writes during the copy.
  2. Dump the local db container and load it into an emptied RDS database.
  3. Compare every table's row count. On any mismatch, restart the API on the
     local database and stop (no switch happens).
  4. Point .env DATABASE_URL and the nightly S3 backup at RDS, restart the API.
  5. Record DB_TARGET=rds in infra/secrets.env so later deploys keep using RDS.

  The local db container keeps running, untouched, as a rollback copy.
  Rollback (only before new data is entered on RDS): set DB_TARGET=local in
  infra/secrets.env and run scripts/deploy-ec2-app.ps1.
#>
param(
  [switch]$Yes
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Infra = Join-Path $Root "infra"

if (-not $Yes) {
  throw "This takes the app offline for several minutes. Re-run with -Yes to proceed."
}

Push-Location $Infra
try {
  $HostIp = terraform output -raw app_public_ip
  $KeyPath = terraform output -raw private_key_path
  $RdsHost = terraform output -raw rds_address
}
finally {
  Pop-Location
}
if (-not [System.IO.Path]::IsPathRooted($KeyPath)) { $KeyPath = Join-Path $Infra $KeyPath }
$KeyPath = [System.IO.Path]::GetFullPath($KeyPath)
if (-not $RdsHost) { throw "terraform output rds_address is empty." }

$remote = "set -euo pipefail`nexport RDS='$RdsHost'`n" + @'
cd /opt/mrfogsales
# psql against RDS using the password the db container already has (never printed)
rds() { docker exec -i -e RDS="$RDS" mrfogsales-db-1 sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql "host=$RDS user=mrfog dbname=concept_foundry sslmode=require" "$@"' sh "$@"; }
live() { docker exec -i mrfogsales-db-1 psql -U mrfog -d concept_foundry "$@"; }

if grep -q "^DATABASE_URL=.*@${RDS}:" .env; then
  echo "ALREADY ON RDS: nothing to do."; exit 0
fi

echo "[$(date -u +%T)] Downtime starts: stopping API"
docker compose stop api

echo "[$(date -u +%T)] Copying database"
docker exec mrfogsales-db-1 pg_dump -U mrfog -d concept_foundry --no-owner --no-acl > /tmp/cutover.sql
rds -q -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" </dev/null
rds -q -v ON_ERROR_STOP=1 < /tmp/cutover.sql
rm -f /tmp/cutover.sql

echo "[$(date -u +%T)] Comparing every table"
MISMATCH=0
for t in $(live -tA -c "select tablename from pg_tables where schemaname='public' order by 1;" </dev/null); do
  a=$(live -tA -c "select count(*) from \"$t\";" </dev/null)
  b=$(rds -tA -c "select count(*) from \"$t\";" </dev/null)
  flag=OK; [ "$a" != "$b" ] && flag=MISMATCH && MISMATCH=1
  printf '  %-28s live=%-7s rds=%-7s %s\n' "$t" "$a" "$b" "$flag"
done
if [ "$MISMATCH" != 0 ]; then
  echo "MISMATCH: staying on the local database."
  docker compose start api
  exit 3
fi

echo "[$(date -u +%T)] Switching API to RDS"
sed -i "s#@db:5432/concept_foundry\$#@${RDS}:5432/concept_foundry?sslmode=require#" .env
grep -q "^DATABASE_URL=.*@${RDS}:5432/concept_foundry?sslmode=require\$" .env
docker compose up -d api
for i in $(seq 1 30); do
  if docker exec mrfogsales-api-1 python -c "import urllib.request;urllib.request.urlopen('http://localhost:8000/health',timeout=3)" 2>/dev/null; then break; fi
  sleep 2
done
docker exec mrfogsales-api-1 python -c "import urllib.request;print('api health:', urllib.request.urlopen('http://localhost:8000/health',timeout=5).read().decode())"

if [ -f /etc/mrfogsales-backup.env ]; then
  sudo sed -i "s#^BACKUP_PG_HOST=.*#BACKUP_PG_HOST=${RDS}#" /etc/mrfogsales-backup.env
fi
echo "[$(date -u +%T)] Downtime ends: API is on RDS"
'@

$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($remote -replace "`r`n", "`n")))
$SshArgs = @("-i", $KeyPath, "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=20")
& ssh @SshArgs "ec2-user@$HostIp" "echo $b64 | base64 -d > /tmp/cutover.sh && bash /tmp/cutover.sh; rc=`$?; rm -f /tmp/cutover.sh; exit `$rc"
if ($LASTEXITCODE -ne 0) { throw "Cutover did not complete (exit $LASTEXITCODE). The API was left on the local database." }

$SecretsFile = Join-Path $Infra "secrets.env"
$lines = if (Test-Path $SecretsFile) { @(Get-Content $SecretsFile | Where-Object { $_ -notmatch '^\s*DB_TARGET\s*=' }) } else { @() }
Set-Content -Path $SecretsFile -Value ($lines + "DB_TARGET=rds")
Write-Host "Recorded DB_TARGET=rds in infra/secrets.env; later deploys will keep using RDS."
