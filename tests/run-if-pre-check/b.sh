#!/bin/bash
# run-if! expr 0 -eq 1
# require scripts ./c.sh

>&2 echo "FAIL: should not run"
exit 1
