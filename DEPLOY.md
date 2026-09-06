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

## Mapbox + Resend

1. Copy `infra/secrets.env.example` → `infra/secrets.env`
2. Set:
   - `VITE_MAPBOX_TOKEN` — from [Mapbox access tokens](https://account.mapbox.com/access-tokens/)
   - `RESEND_API_KEY` — from [Resend API keys](https://resend.com/api-keys)
   - `EMAIL_FROM` — use `Sales <onboarding@resend.dev>` until you verify your own domain
3. Redeploy: `.\scripts\deploy-ec2-app.ps1`

Mapbox is baked into the frontend image at build time; Resend is read by the API from `.env`.

## Domain + HTTPS

Production domain: **mrfogorder.com** (Caddy + Let’s Encrypt on EC2).

1. DNS A for `@` → Elastic IP; `www` CNAME → apex (TTL 300 while switching).
2. Terraform opens port **443**; `.\scripts\deploy-ec2-app.ps1` runs Caddy in front of nginx.
3. App URL: `https://mrfogorder.com` (IP HTTP still works for emergencies).

## Hardening later

- Set `allowed_ssh_cidr = "YOUR.IP/32"` in `infra/terraform.tfvars`
- Verify Resend sending domain for production email From addresses
- Back up the Postgres Docker volume (nightly S3 dump is installed by deploy when the backup bucket exists)
