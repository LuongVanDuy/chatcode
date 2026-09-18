#!/usr/bin/env python3
import hashlib
import json
import sys
import zipfile
from pathlib import Path

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def add_text(zip_file: zipfile.ZipFile, name: str, text: str) -> None:
    zip_file.writestr(name, text.encode("utf-8"))

def prepare(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    (root / ".well-known").mkdir(exist_ok=True)
    (root / ".well-known" / "acme.txt").write_text("keep-me", encoding="utf-8")
    (root / ".ftpquota").write_text("quota", encoding="utf-8")
    (root / "legacy-index.html").write_text("legacy", encoding="utf-8")
    (root / "legacy-dir").mkdir(exist_ok=True)
    (root / "legacy-dir" / "old.txt").write_text("legacy-dir", encoding="utf-8")

    theme_zip = root / ".chatcode-theme-e2e.zip"
    with zipfile.ZipFile(theme_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        add_text(zf, "style.css", "/*\nTheme Name: Bricks\nVersion: 2.4\n*/\n")
        add_text(zf, "index.php", "<?php echo 'Bricks E2E';\n")
        add_text(zf, "functions.php", "<?php\n")

    plugin_zip = root / ".chatcode-plugin-e2e.zip"
    with zipfile.ZipFile(plugin_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        add_text(
            zf,
            "duyanhwebpro/duyanhwebpro.php",
            "<?php\n/**\n * Plugin Name: Duy Anh Web Pro\n * Version: 1.9.4\n */\n",
        )

    meta = {
        "theme_sha256": sha256(theme_zip),
        "plugin_sha256": sha256(plugin_zip),
        "theme_zip": theme_zip.name,
        "plugin_zip": plugin_zip.name,
    }
    (root / "fixture-meta.json").write_text(json.dumps(meta), encoding="utf-8")
    print(json.dumps(meta))

if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "prepare":
        raise SystemExit("usage: fresh-install-e2e-fixtures.py prepare <site-root>")
    prepare(Path(sys.argv[2]).resolve())
