#!/bin/bash

sed -i '/stampy-host/d' /etc/hosts

for i in $(seq 1 2); do
  cid=$(docker ps | grep stampy-host${i} | awk '{print $1}')
  ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${cid})
  echo "${ip} stampy-host${i}" >> /etc/hosts
done