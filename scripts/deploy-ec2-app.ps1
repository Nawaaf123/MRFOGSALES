<#
.SYNOPSIS
  Sync app source to EC2 and build/run with docker compose (API + Postgres + nginx).
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Infra = Join-Path $Root "infra"

Push-Location $Infra
try {
  $HostIp = terraform output -raw app_public_ip
  $AppUrl = terraform output -raw app_url
  $KeyPath = terraform output -raw private_key_path
  $AdminEmail = terraform output -raw seed_admin_email
  $AdminPass = terraform output -raw seed_admin_password
  $DbPass = terraform output -raw db_password
  $AppSecret = terraform output -raw app_secret
  $DomainName = ""
  $prevOut = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $DomainName = (terraform output -raw domain_name 2>$null)
  if ($LASTEXITCODE -ne 0) { $DomainName = "" }
  $ErrorActionPreference = $prevOut
  $BackupBucket = ""
  $prevOut = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $BackupBucket = (terraform output -raw db_backup_bucket 2>$null)
  if ($LASTEXITCODE -ne 0) { $BackupBucket = "" }
  $ErrorActionPreference = $prevOut
}
finally {
  Pop-Location
}

if (-not [System.IO.Path]::IsPathRooted($KeyPath)) {
  $KeyPath = Join-Path $Infra $KeyPath
}
$KeyPath = [System.IO.Path]::GetFullPath($KeyPath)

if (-not (Test-Path $KeyPath)) {
  throw "SSH key not found at $KeyPath. Run .\scripts\deploy-ec2.ps1 first."
}

icacls $KeyPath /inheritance:r | Out-Null
icacls $KeyPath /grant:r "$($env:USERNAME):(R)" | Out-Null

$Remote = "ec2-user@${HostIp}"
$SshArgs = @("-i", $KeyPath, "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=20")

# Optional integrations from infra/secrets.env (gitignored) or process env
$SecretsFile = Join-Path $Infra "secrets.env"
$ResendKey = if ($env:RESEND_API_KEY) { $env:RESEND_API_KEY } else { "" }
$EmailFrom = if ($env:EMAIL_FROM) { $env:EMAIL_FROM } else { "Sales <onboarding@resend.dev>" }
$MapboxToken = if ($env:VITE_MAPBOX_TOKEN) { $env:VITE_MAPBOX_TOKEN } else { "" }
$OpenAiKey = if ($env:OPENAI_API_KEY) { $env:OPENAI_API_KEY } else { "" }
$OpenAiModel = if ($env:OPENAI_MODEL) { $env:OPENAI_MODEL } else { "gpt-4o-mini" }
if (Test-Path $SecretsFile) {
  Get-Content $SecretsFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#") -or $line -notmatch "=") { return }
    $name, $value = $line.Split("=", 2)
    switch ($name.Trim()) {
      "RESEND_API_KEY" { if ($value.Trim()) { $ResendKey = $value.Trim() } }
      "EMAIL_FROM" { if ($value.Trim()) { $EmailFrom = $value.Trim() } }
      "VITE_MAPBOX_TOKEN" { if ($value.Trim()) { $MapboxToken = $value.Trim() } }
      "MAPBOX_ACCESS_TOKEN" { if ($value.Trim()) { $MapboxToken = $value.Trim() } }
      "OPENAI_API_KEY" { if ($value.Trim()) { $OpenAiKey = $value.Trim() } }
      "OPENAI_MODEL" { if ($value.Trim()) { $OpenAiModel = $value.Trim() } }
    }
  }
}
Write-Host "Resend:  $(if ($ResendKey) { 'configured' } else { 'MISSING' })"
Write-Host "Mapbox:  $(if ($MapboxToken) { 'configured' } else { 'MISSING' })"
Write-Host "OpenAI:  $(if ($OpenAiKey) { 'configured' } else { 'MISSING' })"
if (-not $ResendKey -or -not $MapboxToken) {
  Write-Host "Tip: copy infra/secrets.env.example to infra/secrets.env and fill keys, then re-run."
}

function Invoke-RemoteBash {
  param([Parameter(Mandatory = $true)][string]$Script)
  $unix = ($Script -replace "`r`n", "`n" -replace "`r", "`n")
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($unix))
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & ssh @SshArgs $Remote "echo $b64 | base64 -d | sudo bash"
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  if ($code -ne 0) { throw "Remote command failed (exit $code)" }
}

Write-Host "Waiting for SSH on $HostIp ..."
$ready = $false
for ($i = 0; $i -lt 36; $i++) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & ssh @SshArgs $Remote "echo ok" 2>$null
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  if ($code -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 10
}
if (-not $ready) {
  throw "SSH not ready. user-data may still be installing Docker; wait a minute and retry."
}

Write-Host "Waiting for Docker on instance..."
$dockerReady = $false
for ($i = 0; $i -lt 36; $i++) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & ssh @SshArgs $Remote "sudo docker compose version" 2>$null
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  if ($code -eq 0) { $dockerReady = $true; break }
  Start-Sleep -Seconds 10
}
if (-not $dockerReady) {
  throw "Docker Compose not ready on EC2 yet. Retry in a minute."
}

$TarPayload = Join-Path $env:TEMP "mrfogsales-deploy.tgz"
if (Test-Path $TarPayload) { Remove-Item $TarPayload -Force }

Write-Host "Packaging source (frontend builds on EC2)..."
Push-Location $Root
try {
  tar -czf $TarPayload `
    --exclude=frontend/node_modules `
    --exclude=frontend/dist `
    --exclude=backend/.env `
    --exclude=backend/.venv `
    --exclude=backend/__pycache__ `
    docker-compose.prod.yml `
    Caddyfile `
    backend/Dockerfile `
    backend/requirements.txt `
    backend/app `
    frontend `
    scripts/ec2-pg-backup.sh
}
finally {
  Pop-Location
}

Write-Host "Uploading to EC2..."
$prev = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& scp @SshArgs $TarPayload "${Remote}:/tmp/mrfogsales-deploy.tgz"
if ($LASTEXITCODE -ne 0) { throw "scp failed" }
$ErrorActionPreference = $prev

$extract = @'
set -e
mkdir -p /opt/mrfogsales
cd /opt/mrfogsales
tar -xzf /tmp/mrfogsales-deploy.tgz
mv -f docker-compose.prod.yml docker-compose.yml
rm -f /tmp/mrfogsales-deploy.tgz
chown -R ec2-user:ec2-user /opt/mrfogsales
'@
Invoke-RemoteBash $extract

# Keep Caddyfile IP in sync with current Elastic IP
$caddyWrite = @"
set -e
cat > /opt/mrfogsales/Caddyfile <<'EOF'
mrfogorder.com, www.mrfogorder.com {
	encode gzip
	reverse_proxy web:80
}

http://$HostIp {
	encode gzip
	reverse_proxy web:80
}
EOF
chown ec2-user:ec2-user /opt/mrfogsales/Caddyfile
"@
Invoke-RemoteBash $caddyWrite

$CorsOrigins = @(
  $AppUrl
  "http://${HostIp}"
  "https://${HostIp}"
)
if ($DomainName) {
  $CorsOrigins += "https://${DomainName}"
  $CorsOrigins += "https://www.${DomainName}"
  $CorsOrigins += "http://${DomainName}"
  $CorsOrigins += "http://www.${DomainName}"
}
$CorsOriginsCsv = ($CorsOrigins | Select-Object -Unique) -join ","

$envScript = @"
set -e
cat > /opt/mrfogsales/.env <<'EOF'
DB_PASSWORD=$DbPass
SECRET_KEY=$AppSecret
CORS_ORIGINS=$CorsOriginsCsv
SEED_ADMIN_EMAIL=$AdminEmail
SEED_ADMIN_PASSWORD=$AdminPass
RESEND_API_KEY=$ResendKey
EMAIL_FROM=$EmailFrom
VITE_MAPBOX_TOKEN=$MapboxToken
MAPBOX_ACCESS_TOKEN=$MapboxToken
OPENAI_API_KEY=$OpenAiKey
OPENAI_MODEL=$OpenAiModel
EOF
chown ec2-user:ec2-user /opt/mrfogsales/.env
"@
Invoke-RemoteBash $envScript

Write-Host "Building and starting containers on EC2 (first build can take 5-10 min)..."
$up = @'
set -e
cd /opt/mrfogsales
# Rebuild web without cache so VITE_MAPBOX_TOKEN is always baked into the JS bundle
docker compose -f docker-compose.yml --env-file .env build --no-cache web
docker compose -f docker-compose.yml --env-file .env up -d --build
docker compose -f docker-compose.yml ps
# Confirm Mapbox token made it into the frontend image env at build time
grep -E '^VITE_MAPBOX_TOKEN=' .env | sed 's/=.*/=***configured***/'
grep -E '^OPENAI_API_KEY=' .env | sed 's/=.*/=***/'
'@
Invoke-RemoteBash $up

if ($BackupBucket) {
  Write-Host "Installing daily Postgres -> S3 backup (bucket: $BackupBucket)..."
  $backupInstall = @"
set -e
dnf install -y awscli cronie >/dev/null
systemctl enable --now crond
sed -i 's/\r$//' /opt/mrfogsales/scripts/ec2-pg-backup.sh
install -m 0755 /opt/mrfogsales/scripts/ec2-pg-backup.sh /usr/local/bin/mrfogsales-pg-backup
cat > /etc/mrfogsales-backup.env <<'EOF'
BACKUP_S3_BUCKET=$BackupBucket
EOF
chmod 0644 /etc/mrfogsales-backup.env
cat > /etc/cron.d/mrfogsales-db-backup <<'EOF'
# Daily logical Postgres dump to S3 at 08:00 UTC
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin
0 8 * * * root set -a; . /etc/mrfogsales-backup.env; set +a; /usr/local/bin/mrfogsales-pg-backup >> /var/log/mrfogsales-pg-backup.log 2>&1
EOF
chmod 0644 /etc/cron.d/mrfogsales-db-backup
echo "Backup cron installed. Bucket=$BackupBucket"
"@
  Invoke-RemoteBash $backupInstall
} else {
  Write-Host "Skipping S3 backup install (terraform output db_backup_bucket missing). Run terraform apply for backups first."
}

Write-Host ""
Write-Host "App URL:  $AppUrl"
if ($DomainName) {
  Write-Host "WWW URL:  https://www.$DomainName"
  Write-Host "IP URL:   http://$HostIp"
}
Write-Host "Health:   $AppUrl/health"
Write-Host "Admin:    $AdminEmail"
Write-Host "Password: $AdminPass"
if ($BackupBucket) {
  Write-Host "DB dumps: s3://$BackupBucket/postgres/ (daily 08:00 UTC)"
}
Write-Host ""
Write-Host "Save the admin password (also: cd infra; terraform output -raw seed_admin_password)."
