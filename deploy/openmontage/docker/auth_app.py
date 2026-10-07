"""Backlot behind HTTP basic auth.

Backlot has no login of its own, so this wraps its ASGI app and requires
BACKLOT_USER / BACKLOT_PASSWORD on every request except /api/health.
"""
import base64
import os
import secrets

from backlot.server import app as backlot_app

USER = os.environ.get("BACKLOT_USER", "admin")
PASSWORD = os.environ.get("BACKLOT_PASSWORD", "")
if not PASSWORD:
    raise SystemExit("Set BACKLOT_PASSWORD to protect the Backlot board.")

_EXPECTED = "Basic " + base64.b64encode(f"{USER}:{PASSWORD}".encode()).decode()


async def app(scope, receive, send):
    if scope["type"] == "http" and scope["path"] != "/api/health":
        headers = dict(scope["headers"])
        given = headers.get(b"authorization", b"").decode("latin-1")
        if not secrets.compare_digest(given, _EXPECTED):
            await send({
                "type": "http.response.start",
                "status": 401,
                "headers": [(b"www-authenticate", b'Basic realm="OpenMontage"'),
                            (b"content-type", b"text/plain")],
            })
            await send({"type": "http.response.body", "body": b"Authentication required"})
            return
    await backlot_app(scope, receive, send)
