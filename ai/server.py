"""Stateless AI decision service for T20 Dynasty (stdlib only).

Run from the workspace root:

    python ai/server.py

Routes: GET /health, POST /decide, OPTIONS (CORS).  Binds 0.0.0.0:5000.
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

try:  # works both as `python ai/server.py` and as `import ai.server`
    from valuation import decide
except ImportError:  # pragma: no cover - package import path
    from .valuation import decide

HOST = "0.0.0.0"
PORT = 5000
MAX_BODY_BYTES = 1024 * 1024

HEALTH = {"ok": True, "version": 1, "service": "t20-dynasty-ai"}


class AIHandler(BaseHTTPRequestHandler):
    """Small JSON-only HTTP handler with permissive CORS."""

    protocol_version = "HTTP/1.1"
    server_version = "T20DynastyAI/1"
    sys_version = ""

    def log_message(self, format: str, *args: object) -> None:
        """Suppress the loud default access log; _respond logs one line."""

    def _cors(self) -> dict[str, str]:
        return {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Request-Id",
            "Access-Control-Max-Age": "86400",
        }

    def _respond(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        headers = self._cors()
        headers["Content-Type"] = "application/json; charset=utf-8"
        headers["Content-Length"] = str(len(body))
        try:
            self.send_response(status)
            for key, value in headers.items():
                self.send_header(key, value)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass
        sys.stderr.write(f"AI {status} {self.command} {self.path}\n")
        sys.stderr.flush()

    def _route(self) -> str:
        path = urlsplit(self.path).path
        return path.rstrip("/") or "/"

    def do_OPTIONS(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        headers = self._cors()
        body = b""
        try:
            self.send_response(204)
            for key, value in headers.items():
                self.send_header(key, value)
            self.send_header("Content-Length", "0")
            self.end_headers()
        except (BrokenPipeError, ConnectionResetError):
            pass
        sys.stderr.write(f"AI 204 OPTIONS {self.path}\n")
        sys.stderr.flush()

    def do_GET(self) -> None:  # noqa: N802
        route = self._route()
        if route == "/health":
            self._respond(200, dict(HEALTH))
        elif route == "/decide":
            self._respond(405, {"ok": False, "error": "method not allowed; use POST"})
        else:
            self._respond(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        route = self._route()
        if route == "/health":
            self._respond(405, {"ok": False, "error": "method not allowed; use GET"})
            return
        if route != "/decide":
            self._respond(404, {"ok": False, "error": "not found"})
            return

        raw_length = self.headers.get("Content-Length", "0")
        try:
            length = int(raw_length)
        except (TypeError, ValueError):
            self._respond(400, {"ok": False, "error": "invalid Content-Length"})
            return
        if length < 0 or length > MAX_BODY_BYTES:
            self._respond(413, {"ok": False, "error": "request body too large"})
            return

        try:
            raw = self.rfile.read(length) if length else b""
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._respond(400, {"ok": False, "error": "invalid JSON body"})
            return
        except (OSError, ValueError):
            self._respond(400, {"ok": False, "error": "could not read request body"})
            return

        if not isinstance(payload, dict):
            self._respond(400, {"ok": False, "error": "request body must be a JSON object"})
            return

        try:
            decision = decide(payload)
        except Exception as exc:  # never take down the auction on a bad request
            sys.stderr.write(f"AI decide failed: {type(exc).__name__}: {exc}\n")
            sys.stderr.flush()
            self._respond(500, {"ok": False, "error": "decision engine error"})
            return

        self._respond(200, decision)

    def do_PUT(self) -> None:  # noqa: N802
        self._respond(405, {"ok": False, "error": "method not allowed"})

    do_DELETE = do_PUT  # noqa: N815
    do_PATCH = do_PUT  # noqa: N815


def create_server(host: str = HOST, port: int = PORT) -> ThreadingHTTPServer:
    """Build the threaded HTTP server (also used by the unittest suite)."""
    server = ThreadingHTTPServer((host, port), AIHandler)
    server.daemon_threads = True
    return server


def main() -> None:
    port = int(os.environ.get("AI_PORT", str(PORT)))
    server = create_server(HOST, port)
    sys.stderr.write(f"T20 Dynasty AI listening on {HOST}:{port}\n")
    sys.stderr.flush()
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
