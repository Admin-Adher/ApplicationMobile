import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import weasyprint
from weasyprint import HTML

try:
    from weasyprint.urls import default_url_fetcher
except ImportError:  # pragma: no cover - compatibility for older WeasyPrint.
    from weasyprint import default_url_fetcher


HOST = os.getenv("WEASYPRINT_HOST", "127.0.0.1")
PORT = int(os.getenv("WEASYPRINT_PORT", "8010"))
MAX_HTML_BYTES = int(os.getenv("WEASYPRINT_MAX_HTML_BYTES", "12000000"))
ALLOW_REMOTE = os.getenv("WEASYPRINT_ALLOW_REMOTE", "0").lower() in {"1", "true", "yes"}
ALLOWED_FILE_ROOT = Path(os.getenv("WEASYPRINT_ALLOWED_FILE_ROOT", "/work")).resolve()


def json_bytes(payload: dict) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def safe_filename(value: str | None) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value or "buildtrack-weasyprint.pdf").strip("-")
    if not cleaned.lower().endswith(".pdf"):
        cleaned += ".pdf"
    return cleaned or "buildtrack-weasyprint.pdf"


def is_allowed_file_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme != "file":
        return False
    candidate = Path(unquote(parsed.path)).resolve()
    try:
        candidate.relative_to(ALLOWED_FILE_ROOT)
        return True
    except ValueError:
        return False


def guarded_url_fetcher(url: str, *args, **kwargs):
    parsed = urlparse(url)
    scheme = parsed.scheme.lower()

    if scheme in {"data", ""}:
        return default_url_fetcher(url, *args, **kwargs)

    if scheme == "file" and is_allowed_file_url(url):
        return default_url_fetcher(url, *args, **kwargs)

    if scheme in {"http", "https"} and ALLOW_REMOTE:
        return default_url_fetcher(url, *args, **kwargs)

    raise ValueError(f"Blocked external resource for WeasyPrint POC: {url}")


class WeasyPrintHandler(BaseHTTPRequestHandler):
    server_version = "BuildTrackWeasyPrintPOC/1.0"

    def log_message(self, fmt, *args):
        print(f"[weasyprint-poc] {self.address_string()} - {fmt % args}")

    def send_json(self, status: int, payload: dict):
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(
                200,
                {
                    "ok": True,
                    "engine": "weasyprint",
                    "version": weasyprint.__version__,
                    "allowRemote": ALLOW_REMOTE,
                    "allowedFileRoot": str(ALLOWED_FILE_ROOT),
                },
            )
            return

        self.send_json(404, {"ok": False, "error": "Not found"})

    def do_POST(self):
        if self.path != "/render":
            self.send_json(404, {"ok": False, "error": "Not found"})
            return

        try:
            content_length = int(self.headers.get("content-length", "0"))
        except ValueError:
            self.send_json(400, {"ok": False, "error": "Invalid content-length"})
            return

        if content_length <= 0:
            self.send_json(400, {"ok": False, "error": "Empty body"})
            return

        if content_length > MAX_HTML_BYTES:
            self.send_json(413, {"ok": False, "error": "HTML payload too large"})
            return

        try:
            raw_body = self.rfile.read(content_length)
            payload = json.loads(raw_body.decode("utf-8"))
            html = payload.get("html")
            if not isinstance(html, str) or not html.strip():
                self.send_json(400, {"ok": False, "error": "Missing html string"})
                return

            base_url = payload.get("baseUrl") or payload.get("base_url") or "file:///work/"
            filename = safe_filename(payload.get("filename"))

            pdf = HTML(
                string=html,
                base_url=base_url,
                url_fetcher=guarded_url_fetcher,
            ).write_pdf()

            self.send_response(200)
            self.send_header("content-type", "application/pdf")
            self.send_header("content-disposition", f'attachment; filename="{filename}"')
            self.send_header("content-length", str(len(pdf)))
            self.send_header("x-weasyprint-version", weasyprint.__version__)
            self.end_headers()
            self.wfile.write(pdf)
        except Exception as exc:
            self.send_json(500, {"ok": False, "error": str(exc)})


def main():
    server = ThreadingHTTPServer((HOST, PORT), WeasyPrintHandler)
    print(
        f"WeasyPrint POC listening on http://{HOST}:{PORT} "
        f"(WeasyPrint {weasyprint.__version__}, remote={'on' if ALLOW_REMOTE else 'off'})"
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
