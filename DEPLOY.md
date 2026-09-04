# AWS deploy on EC2 (MRFOGSALES)

Single **public EC2** box runs Postgres + API + nginx (frontend). No RDS, App Runner, or NAT gateway.

Rough cost (us-east-1): **~$15–25/month** for `t3.small` + 30GB disk + Elastic IP (EIP is free while attached).

Does **not** touch the Lovable app.

## Stack

| Piece | Where |
|---|---|
| Postgres 16 | Docker on EC2 |
| FastAPI | Docker on EC2 |
| React SPA | nginx on EC2 (`/`) |
| API routes | nginx proxies `/api` → API |

## Prerequisites

- AWS CLI as your deploy user (`Salesapp`)
- Terraform >= 1.5
- Docker **not** required on your laptop for this path (build happens on EC2)
- Node.js 20+ (frontend build on your machine)
- OpenSSH client (`ssh` / `scp` — included on modern Windows)

## Deploy

```powershell
# 1) Create VPC + EC2 + Elastic IP + SSH key (infra/mrfogsales.pem)
.\scripts\deploy-ec2.ps1

# 2) Wait ~2 min for Docker install on the instance, then:
.\scripts\deploy-ec2-app.ps1
```

Open the printed `http://<elastic-ip>` and sign in with the seed admin.

## Useful commands

```powershell
cd infra
terraform output -raw app_url
terraform output -raw ssh_command
terraform output -raw seed_admin_password
```

SSH:

```powershell
ssh -i infra\mrfogsales.pem ec2-user@<elastic-ip>
```

## Tear down (stop billing)

```powershell
cd infra
terraform destroy -auto-approve
```

## Hardening later

- Set `allowed_ssh_cidr = "YOUR.IP/32"` in `infra/terraform.tfvars`
- Add a domain + HTTPS (Caddy/Let’s Encrypt or ACM + ALB)
- Back up the Postgres Docker volume
