#!/usr/bin/env python3
import base64
import os
import re
import shutil
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs

HOST = os.environ.get("MYSQL_HOST", "127.0.0.1")
PORT = os.environ.get("MYSQL_PORT", "3306")
ROOT_PASSWORD = os.environ.get("MYSQL_ROOT_PASSWORD", "rootpass")
PANEL_USER = os.environ.get("PANEL_USER", "tester")
PANEL_PASSWORD = os.environ.get("PANEL_PASSWORD", "testpanel")

def mysql_client() -> str:
    for name in ("mariadb", "mysql"):
        found = shutil.which(name)
        if found:
            return found
    raise RuntimeError("mariadb/mysql client not found")

def valid_name(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_]+", value or ""):
        raise ValueError("invalid database name")
    return value

def sql_quote(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "''")

def create_database(name_suffix: str, user_suffix: str, password: str) -> None:
    db = valid_name(f"{PANEL_USER}_{valid_name(name_suffix)}")
    user = valid_name(f"{PANEL_USER}_{valid_name(user_suffix)}")
    pw = sql_quote(password)
    sql = (
        f"CREATE DATABASE IF NOT EXISTS `{db}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
        f"CREATE USER IF NOT EXISTS '{user}'@'%' IDENTIFIED BY '{pw}';"
        f"ALTER USER '{user}'@'%' IDENTIFIED BY '{pw}';"
        f"GRANT ALL PRIVILEGES ON `{db}`.* TO '{user}'@'%';"
        "FLUSH PRIVILEGES;"
    )
    subprocess.run(
        [mysql_client(), "-h", HOST, "-P", PORT, "-uroot", f"-p{ROOT_PASSWORD}", "-e", sql],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("fake-da:", fmt % args, flush=True)

    def do_POST(self):
        expected = "Basic " + base64.b64encode(f"{PANEL_USER}:{PANEL_PASSWORD}".encode()).decode()
        if self.headers.get("Authorization") != expected:
            self.send_response(401)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0"))
        data = parse_qs(self.rfile.read(length).decode("utf-8"))
        try:
            if data.get("action", [""])[0] != "create":
                raise ValueError("unsupported action")
            create_database(
                data.get("name", [""])[0],
                data.get("user", [""])[0],
                data.get("passwd", [""])[0],
            )
            body = b"error=0&text=Database+Created"
            self.send_response(200)
        except Exception as exc:
            body = ("error=1&text=" + str(exc)).encode("utf-8")
            self.send_response(500)
        self.send_header("Content-Type", "application/x-www-form-urlencoded")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 2222), Handler).serve_forever()