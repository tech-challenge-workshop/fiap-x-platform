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
