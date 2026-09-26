#!/bin/bash
# Makes the bucket, its access posture and its retention true. Unlike db/init,
# which PostgreSQL runs only on an empty volume, this runs on EVERY start, so
# every step must succeed against a bucket that already exists.
#
# Plain S3 API through aws-cli (AD-014): the endpoint and credentials come from
# AWS_ENDPOINT_URL and AWS_* in the storage-init environment.
set -euo pipefail

bucket="${STORAGE_BUCKET:?STORAGE_BUCKET is required}"

# head-bucket first turns a second run into a no-op instead of a failure.
if aws s3api head-bucket --bucket "$bucket" 2>/dev/null; then
  echo "bucket $bucket exists"
else
  aws s3api create-bucket --bucket "$bucket" >/dev/null
  echo "bucket $bucket created"
fi

# Assert, never set: a new bucket has no policy, and a policy is the only way
# the S3 API grants anonymous access. This also catches a bucket someone
# opened by hand.
if policy="$(aws s3api get-bucket-policy --bucket "$bucket" --query Policy --output text 2>&1)"; then
  echo "bucket $bucket has a bucket policy, which may allow anonymous access: $policy" >&2
  exit 1
elif [[ "$policy" != *NoSuchBucketPolicy* ]]; then
  echo "could not read the policy of bucket $bucket: $policy" >&2
  exit 1
fi
echo "bucket $bucket is private"

# 7-day retention for both prefixes (docs/foudation.md). put-bucket-lifecycle
# replaces the whole configuration, so it is written only when every rule in
# the bucket is one of ours. Rules are identified by ID, not by prefix: a rule
# with a whole-bucket or compound filter has no top-level prefix, and matching
# on prefixes let the put silently delete it.
desired='{"Rules":[
  {"ID":"expire-sources","Status":"Enabled","Filter":{"Prefix":"sources/"},"Expiration":{"Days":7}},
  {"ID":"expire-zips","Status":"Enabled","Filter":{"Prefix":"zips/"},"Expiration":{"Days":7}}]}'
ours="ID=='expire-sources' || ID=='expire-zips'"
# A rule counts only when it would actually expire objects as required.
correct() {
  local id="$1" prefix="$2"
  lifecycle --query "length(Rules[?ID=='$id' && Status=='Enabled' && Filter.Prefix=='$prefix' && Expiration.Days==\`7\`])"
}

lifecycle() {
  aws s3api get-bucket-lifecycle-configuration --bucket "$bucket" --output text "$@"
}

# "No configuration" is the only read failure that means "none yet"; any
# other error must stop the bootstrap rather than be taken as an empty
# configuration and overwritten.
if read_error="$(lifecycle --query 'length(Rules)' 2>&1)"; then
  total="$read_error"
elif [[ "$read_error" == *NoSuchLifecycleConfiguration* ]]; then
  total=0
else
  echo "could not read the lifecycle configuration of bucket $bucket: $read_error" >&2
  exit 1
fi

if [[ "$total" != 0 ]]; then
  owned="$(lifecycle --query "length(Rules[?$ours])")"
  if [[ "$owned" != "$total" ]]; then
    echo "bucket $bucket has $((total - owned)) lifecycle rule(s) this bootstrap does not own (IDs: $(lifecycle --query "Rules[?!($ours)].ID" | tr '\t' ' ')); refusing to overwrite them" >&2
    exit 1
  fi
fi

if [[ "$total" == 2 && "$(correct expire-sources sources/)" == 1 && "$(correct expire-zips zips/)" == 1 ]]; then
  echo "retention on sources/ already configured"
  echo "retention on zips/ already configured"
else
  aws s3api put-bucket-lifecycle-configuration --bucket "$bucket" --lifecycle-configuration "$desired"
  echo "retention on sources/ and zips/ configured"
fi

# Read the configuration back: exactly our two rules, both enabled, 7 days,
# one per prefix.
total="$(lifecycle --query 'length(Rules)')"
if [[ "$total" != 2 || "$(correct expire-sources sources/)" != 1 || "$(correct expire-zips zips/)" != 1 ]]; then
  echo "expected exactly 2 enabled 7-day lifecycle rules on sources/ and zips/, found: $(aws s3api get-bucket-lifecycle-configuration --bucket "$bucket" --output json)" >&2
  exit 1
fi
echo "bucket $bucket expires sources/ and zips/ after 7 days"
