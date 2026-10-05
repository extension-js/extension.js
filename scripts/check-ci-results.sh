#!/usr/bin/env bash
set -euo pipefail

# The gate branch protection requires. A job the runner queue dropped reports
# "abandoned", not "failure", so only success and skipped may pass here.

RESULTS="${1:?job results required}"

echo "job results: ${RESULTS}"

for result in ${RESULTS}
do
  if [[ "${result}" != "success" && "${result}" != "skipped" ]]
  then
    echo "a CI job ended as ${result}, so CI did not pass"
    exit 1
  fi
done
