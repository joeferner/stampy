#!/bin/bash
# require script ./role1.sh
# require script ./role2.sh

echo "ROLES: ${STAMPY_ROLES}"

if is_in_role role1; then
  echo "in role1"
fi

if is_in_role role2; then
  echo "in role2"
fi

if is_in_role role3; then
  echo "in role3"
fi
