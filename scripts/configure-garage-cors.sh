#!/usr/bin/env bash
# Configure S3 bucket CORS for browser-side product image uploads.
# The app presigns a PUT to S3_ENDPOINT; the browser's preflight must be allowed
# from APP_URL (and localhost for development), including the signed
# content-type / content-length headers.
#
# Usage:
#   ENV_FILE=.env.production ./scripts/configure-garage-cors.sh
set -euo pipefail

ENV_FILE=${ENV_FILE:-.env.production}
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${S3_ENDPOINT:?set S3_ENDPOINT}"
: "${S3_BUCKET:?set S3_BUCKET}"
: "${S3_ACCESS_KEY:?set S3_ACCESS_KEY}"
: "${S3_SECRET_KEY:?set S3_SECRET_KEY}"
: "${S3_REGION:=garage}"
: "${APP_URL:?set APP_URL}"

origin=$(printf '%s' "$APP_URL" | sed 's:/*$::')
cors=$(mktemp)
trap 'rm -f "$cors"' EXIT
cat > "$cors" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <CORSRule>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
    <AllowedOrigin>${origin}</AllowedOrigin>
    <AllowedOrigin>http://localhost:3000</AllowedOrigin>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>content-type</AllowedHeader>
    <AllowedHeader>content-length</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
  </CORSRule>
</CORSConfiguration>
XML

url="${S3_ENDPOINT%/}/${S3_BUCKET}?cors"
status=$(curl -sS -o /dev/null -w '%{http_code}' \
  --aws-sigv4 "aws:amz:${S3_REGION}:s3" \
  --user "${S3_ACCESS_KEY}:${S3_SECRET_KEY}" \
  -X PUT -H 'Content-Type: application/xml' --data-binary @"$cors" \
  --max-time 30 "$url")
echo "Bucket CORS updated for ${origin} (HTTP ${status})"
[[ "$status" == 200 ]]
