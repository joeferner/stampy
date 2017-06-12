#!/bin/bash -e
# require script ./once.sh

if [ ! -f once.sh.once ]; then
  >&2 echo "could not find once file 'once.sh.once'"
  exit 1
fi

rm once.sh.once
