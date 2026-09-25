#!/bin/bash
# Makes the bucket and its access posture true. Unlike db/init, which
# PostgreSQL runs only on an empty volume, this runs on EVERY start, so every
# step must succeed against a bucket that already exists.
#
# The `local` alias comes from MC_HOST_local in the minio-init environment.
set -euo pipefail

bucket="local/${STORAGE_BUCKET:?STORAGE_BUCKET is required}"

# --ignore-existing turns a second run into a no-op instead of a failure.
mc mb --ignore-existing "$bucket"

# Assert, never set: a MinIO bucket starts private, and a `set` could only
# ever loosen it. This also catches a volume someone loosened by hand.
# SPEC_DEVIATION: tasks.md T2 names the expected state `none`.
# Reason: `none` is what `mc anonymous set` writes; `mc anonymous get` on the
# pinned mc release reports that same state as `private`.
policy_json="$(mc anonymous get --json "$bucket")"
if [[ "$policy_json" != *'"permission":"private"'* ]]; then
  echo "bucket $bucket allows anonymous access: $policy_json" >&2
  exit 1
fi
echo "bucket $bucket is private"

# 7-day retention for both prefixes (docs/foudation.md). Each rule is added
# only when no rule exists for its prefix, so a re-run neither fails nor
# accumulates duplicates, and a stale bucket without rules gets them.
count() { local rest="${1//"$2"/}"; echo $(( (${#1} - ${#rest}) / ${#2} )); }

for prefix in sources/ zips/; do
  # No lifecycle configuration at all is an error for `rule ls`; treat it
  # as "no rule yet".
  rules="$(mc ilm rule ls --json "$bucket" 2>/dev/null || true)"
  if [[ "$rules" == *"\"Prefix\":\"$prefix\""* ]]; then
    echo "retention on $prefix already configured"
  else
    mc ilm rule add --expire-days 7 --prefix "$prefix" "$bucket"
  fi
done

# Read the configuration back: exactly two rules, both at 7 days.
lifecycle="$(mc ilm export "$bucket")"
rule_count="$(count "$lifecycle" '"ID":')"
seven_day_count="$(count "$lifecycle" '"Expiration":{"Days":7}')"
if [[ "$rule_count" != 2 || "$seven_day_count" != 2 ]]; then
  echo "expected 2 lifecycle rules at 7 days, found $rule_count rules ($seven_day_count at 7 days): $lifecycle" >&2
  exit 1
fi
echo "bucket $bucket expires sources/ and zips/ after 7 days"
