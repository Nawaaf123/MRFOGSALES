<#
.SYNOPSIS
  Create (or update) the EC2 box with Terraform.
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Infra = Join-Path $Root "infra"

Push-Location $Infra
try {
  if (-not (Test-Path "terraform.tfvars")) {
    Copy-Item "terraform.tfvars.example" "terraform.tfvars"
    Write-Host "Created infra/terraform.tfvars"
  }

  terraform init -upgrade
  terraform apply -auto-approve

  Write-Host ""
  Write-Host "EC2 ready."
  Write-Host "URL:  $(terraform output -raw app_url)"
  Write-Host "SSH:  $(terraform output -raw ssh_command)"
  Write-Host ""
  Write-Host "Wait ~2 minutes for Docker install, then run:"
  Write-Host "  .\scripts\deploy-ec2-app.ps1"
}
finally {
  Pop-Location
}
