#!/bin/sh
set -e
# OpenMotion binds 127.0.0.1:4173 only; publish it to the compose network on 4180.
socat TCP-LISTEN:4180,fork,reuseaddr TCP:127.0.0.1:4173 &

# MCP for AI tools (Claude Code, Cursor, Codex...) at https://motion.marvice.tech/mcp, only when
# MCP_API_KEY is set. Each session runs OpenMotion's own MCP server, which attaches to the editor
# below (same PORT and MOTION_DATA_DIR). Clients send "Authorization: Bearer $MCP_API_KEY".
if [ -n "$MCP_API_KEY" ]; then
  SUPERGATEWAY_API_KEY="$MCP_API_KEY" supergateway \
    --stdio "node --experimental-strip-types /app/mcp.ts" \
    --outputTransport streamableHttp --stateful --sessionTimeout 900000 \
    --host 0.0.0.0 --port 4190 --streamableHttpPath /mcp --healthEndpoint /mcp-health \
    --logLevel none &
fi
unset MCP_API_KEY

exec node --experimental-strip-types server.ts
