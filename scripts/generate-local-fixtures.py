#!/usr/bin/env python3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "enrichment"))

from app.local_fixtures import generate_local_fixtures


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("usage: generate-local-fixtures.py OUTPUT_DIRECTORY")
    generate_local_fixtures(Path(sys.argv[1]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
