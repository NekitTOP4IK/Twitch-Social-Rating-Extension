#!/usr/bin/env python3
"""
Firefox extension build + AMO sign script.

Reads credentials from .env (in the extension root) or environment variables.
Required vars:
  AMO_JWT_ISSUER   — API key from https://addons.mozilla.org/developers/addon/api/key/
  AMO_JWT_SECRET   — API secret from the same page

Usage:
  python scripts/sign-firefox.py [--skip-build]

Output: the signed .xpi path is printed at the end.
"""
import argparse
import glob
import os
import subprocess
import sys
from pathlib import Path

# ── locate project root (one level up from this script) ──────────────
SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


def run(cmd: list[str], **kwargs) -> None:
    print(f"\n$ {' '.join(cmd)}", flush=True)
    result = subprocess.run(cmd, **kwargs)
    if result.returncode != 0:
        sys.exit(result.returncode)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build and sign the Firefox extension via AMO")
    parser.add_argument("--skip-build", action="store_true", help="Skip the webpack build step")
    args = parser.parse_args()

    # Load .env
    load_dotenv(ROOT / ".env")

    issuer = os.environ.get("AMO_JWT_ISSUER", "").strip()
    secret = os.environ.get("AMO_JWT_SECRET", "").strip()

    if not issuer or not secret:
        print(
            "ERROR: AMO_JWT_ISSUER and AMO_JWT_SECRET must be set.\n"
            "Get them at: https://addons.mozilla.org/developers/addon/api/key/\n"
            "Put them in .env in the extension root or export as environment variables.",
            file=sys.stderr,
        )
        sys.exit(1)

    artifacts_dir = ROOT / "web-ext-artifacts"
    artifacts_dir.mkdir(exist_ok=True)

    # 1. Build
    if not args.skip_build:
        run(
            ["npm", "run", "build:firefox:amo"],
            cwd=ROOT,
        )
    else:
        print("Skipping build (--skip-build)")

    dist_dir = ROOT / "dist-firefox"
    if not dist_dir.is_dir():
        print(f"ERROR: dist-firefox not found at {dist_dir}", file=sys.stderr)
        sys.exit(1)

    # 2. Sign via web-ext
    run(
        [
            "npx", "web-ext", "sign",
            "--source-dir", str(dist_dir),
            "--artifacts-dir", str(artifacts_dir),
            "--channel", "unlisted",
            "--api-key", issuer,
            "--api-secret", secret,
        ],
        cwd=ROOT,
    )

    # 3. Find signed XPI
    xpi_files = sorted(
        glob.glob(str(artifacts_dir / "*.xpi")),
        key=os.path.getmtime,
        reverse=True,
    )

    if not xpi_files:
        print("WARNING: No .xpi found in web-ext-artifacts — check web-ext output above.", file=sys.stderr)
        sys.exit(1)

    signed = xpi_files[0]
    print(f"\n{'─' * 60}")
    print(f"  Signed XPI: {signed}")
    print(f"{'─' * 60}\n")


if __name__ == "__main__":
    main()
