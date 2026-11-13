#!/usr/bin/env bash
# Nightly logical backup of Postgres -> S3.
# Restores the whole database (all tables/rows), not the OS/disk.
#
# Env:
#   BACKUP_S3_BUCKET    (required) e.g. mrfogsales-db-backups-123456789012
#   BACKUP_PG_HOST      (optional) RDS hostname; when empty, dumps the local db container
#   BACKUP_PG_PASSWORD  (required with BACKUP_PG_HOST)
#
# Restore example (RDS):
#   aws s3 cp s3://$BUCKET/postgres/YYYY-MM-DD-HHMM.sql.gz - | gunzip \
#     | docker run --rm -i -e PGPASSWORD postgres:16-alpine \
#         psql "host=$BACKUP_PG_HOST user=mrfog dbname=concept_foundry sslmode=require"
set -euo pipefail

BUCKET="${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"
STAMP="$(date -u +%Y-%m-%d-%H%M)"
TMP="/tmp/concept_foundry-${STAMP}.sql.gz"
KEY="postgres/${STAMP}.sql.gz"

if [[ -n "${BACKUP_PG_HOST:-}" ]]; then
  echo "Dumping from RDS ${BACKUP_PG_HOST} ..."
  docker run --rm -e PGPASSWORD="${BACKUP_PG_PASSWORD:?BACKUP_PG_PASSWORD is required}" postgres:16-alpine \
    pg_dump "host=${BACKUP_PG_HOST} user=mrfog dbname=concept_foundry sslmode=require" --no-owner --no-acl \
    | gzip -c > "${TMP}"
else
  CONTAINER="$(docker ps --format '{{.Names}}' | grep -E 'db' | head -n1 || true)"
  if [[ -z "${CONTAINER}" ]]; then
    echo "ERROR: no running db container found" >&2
    exit 1
  fi
  echo "Dumping from container ${CONTAINER} ..."
  docker exec "${CONTAINER}" pg_dump -U mrfog -d concept_foundry --no-owner --no-acl \
    | gzip -c > "${TMP}"
fi

BYTES="$(wc -c < "${TMP}" | tr -d ' ')"
echo "Upload s3://${BUCKET}/${KEY} (${BYTES} bytes) ..."
aws s3 cp "${TMP}" "s3://${BUCKET}/${KEY}" --only-show-errors
rm -f "${TMP}"
echo "OK ${KEY}"
