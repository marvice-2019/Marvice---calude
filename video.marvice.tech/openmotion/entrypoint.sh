#!/bin/sh
set -e
# OpenMotion binds 127.0.0.1:4173 only; publish it to the compose network on 4180.
socat TCP-LISTEN:4180,fork,reuseaddr TCP:127.0.0.1:4173 &
exec node --experimental-strip-types server.ts
