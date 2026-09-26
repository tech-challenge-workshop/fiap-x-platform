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

# 7-day retention for both prefixes (docs/foudation.md), and a whole-bucket
# rule that discards a multipart upload never completed within 1 day, so an
# abandoned upload does not keep its parts forever. put-bucket-lifecycle
# replaces the whole configuration, so it is written only when every rule in
# the bucket is one of ours. Rules are identified by ID, not by prefix: a rule
# with a whole-bucket or compound filter has no top-level prefix, and matching
# on prefixes let the put silently delete it.
desired='{"Rules":[
  {"ID":"expire-sources","Status":"Enabled","Filter":{"Prefix":"sources/"},"Expiration":{"Days":7}},
  {"ID":"expire-zips","Status":"Enabled","Filter":{"Prefix":"zips/"},"Expiration":{"Days":7}},
  {"ID":"abort-incomplete-uploads","Status":"Enabled","Filter":{"Prefix":""},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}}]}'
ours="ID=='expire-sources' || ID=='expire-zips' || ID=='abort-incomplete-uploads'"
# A rule counts only when it would actually expire objects as required, and
# does nothing else: a second action on an owned rule deletes what the rule
# was never meant to touch, so it is rewritten like a wrong one (V36).
correct() {
  local id="$1" prefix="$2"
  lifecycle --query "length(Rules[?ID=='$id' && Status=='Enabled' && Filter.Prefix=='$prefix' && Expiration.Days==\`7\` && AbortIncompleteMultipartUpload==\`null\` && Transitions==\`null\` && NoncurrentVersionExpiration==\`null\`])"
}
# The abort rule counts only when it is enabled, covers the whole bucket,
# aborts after exactly 1 day and does nothing else.
abort_correct() {
  lifecycle --query "length(Rules[?ID=='abort-incomplete-uploads' && Status=='Enabled' && Filter.Prefix=='' && AbortIncompleteMultipartUpload.DaysAfterInitiation==\`1\` && Expiration==\`null\` && Transitions==\`null\` && NoncurrentVersionExpiration==\`null\`])"
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

if [[ "$total" == 3 && "$(correct expire-sources sources/)" == 1 && "$(correct expire-zips zips/)" == 1 && "$(abort_correct)" == 1 ]]; then
  echo "retention on sources/ already configured"
  echo "retention on zips/ already configured"
  echo "abort of incomplete uploads already configured"
else
  aws s3api put-bucket-lifecycle-configuration --bucket "$bucket" --lifecycle-configuration "$desired"
  echo "retention on sources/ and zips/ and abort of incomplete uploads configured"
fi

# Read the configuration back: exactly our three rules, all enabled, 7 days
# on each prefix and an abort after 1 day on the whole bucket, each with no
# other action.
total="$(lifecycle --query 'length(Rules)')"
if [[ "$total" != 3 || "$(correct expire-sources sources/)" != 1 || "$(correct expire-zips zips/)" != 1 || "$(abort_correct)" != 1 ]]; then
  echo "expected exactly 3 enabled lifecycle rules (7-day expiry on sources/ and zips/, abort of incomplete uploads after 1 day), found: $(aws s3api get-bucket-lifecycle-configuration --bucket "$bucket" --output json)" >&2
  exit 1
fi
echo "bucket $bucket expires sources/ and zips/ after 7 days and aborts incomplete uploads after 1 day"
