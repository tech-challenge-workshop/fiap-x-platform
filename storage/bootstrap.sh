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
# replaces the whole configuration, so it is written only when a rule of ours
# is missing and no foreign rule would be lost; a foreign rule fails instead.
desired='{"Rules":[
  {"ID":"expire-sources","Status":"Enabled","Filter":{"Prefix":"sources/"},"Expiration":{"Days":7}},
  {"ID":"expire-zips","Status":"Enabled","Filter":{"Prefix":"zips/"},"Expiration":{"Days":7}}]}'

# One prefix per word: aws-cli's text output separates values with tabs.
prefixes() {
  aws s3api get-bucket-lifecycle-configuration --bucket "$bucket" \
    --query 'Rules[].Filter.Prefix' --output text 2>/dev/null | tr '\t' ' ' || true
}

present="$(prefixes)"
foreign=""
for prefix in $present; do
  [[ "$prefix" == "sources/" || "$prefix" == "zips/" ]] || foreign="$foreign $prefix"
done
if [[ -n "$foreign" ]]; then
  echo "bucket $bucket has lifecycle rules this bootstrap does not own (prefixes:$foreign); refusing to overwrite them" >&2
  exit 1
fi

missing=0
for prefix in sources/ zips/; do
  if [[ " $present " == *" $prefix "* ]]; then
    echo "retention on $prefix already configured"
  else
    missing=1
  fi
done
if [[ "$missing" == 1 ]]; then
  aws s3api put-bucket-lifecycle-configuration --bucket "$bucket" --lifecycle-configuration "$desired"
  echo "retention on sources/ and zips/ configured"
fi

# Read the configuration back: exactly two rules, both at 7 days, one per prefix.
rules="$(aws s3api get-bucket-lifecycle-configuration --bucket "$bucket" --query 'length(Rules)' --output text)"
seven="$(aws s3api get-bucket-lifecycle-configuration --bucket "$bucket" --query 'length(Rules[?Expiration.Days==`7`])' --output text)"
covered="$(prefixes | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ')"
if [[ "$rules" != 2 || "$seven" != 2 || "$covered" != "sources/ zips/ " ]]; then
  echo "expected 2 lifecycle rules at 7 days on sources/ and zips/, found $rules rules ($seven at 7 days) on: $covered" >&2
  exit 1
fi
echo "bucket $bucket expires sources/ and zips/ after 7 days"
