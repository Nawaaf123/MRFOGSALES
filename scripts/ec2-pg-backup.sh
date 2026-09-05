#!/usr/bin/env bash
# Nightly logical backup of Postgres -> S3.
# Restores the whole database (all tables/rows), not the OS/disk.
#
# Env (required):
#   BACKUP_S3_BUCKET  e.g. mrfogsales-db-backups-123456789012
#
# Restore example:
#   aws s3 cp s3://$BUCKET/postgres/YYYY-MM-DD-HHMM.sql.gz - \
#     | gunzip \
#     | docker exec -i mrfogsales-db-1 psql -U mrfog -d concept_foundry
set -euo pipefail

BUCKET="${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"
STAMP="$(date -u +%Y-%m-%d-%H%M)"
TMP="/tmp/concept_foundry-${STAMP}.sql.gz"
KEY="postgres/${STAMP}.sql.gz"

CONTAINER="$(docker ps --format '{{.Names}}' | grep -E 'db' | head -n1 || true)"
if [[ -z "${CONTAINER}" ]]; then
  echo "ERROR: no running db container found" >&2
  exit 1
fi

echo "Dumping from container ${CONTAINER} ..."
docker exec "${CONTAINER}" pg_dump -U mrfog -d concept_foundry --no-owner --no-acl \
  | gzip -c > "${TMP}"

BYTES="$(wc -c < "${TMP}" | tr -d ' ')"
echo "Upload s3://${BUCKET}/${KEY} (${BYTES} bytes) ..."
aws s3 cp "${TMP}" "s3://${BUCKET}/${KEY}" --only-show-errors
rm -f "${TMP}"
echo "OK ${KEY}"
