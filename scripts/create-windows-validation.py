#!/usr/bin/env python3
"""Create a PENDING record for exact binaries; this script does not attest game validation."""
import argparse
import json
from pathlib import Path
import subprocess

from importlib.util import module_from_spec, spec_from_file_location

ROOT = Path(__file__).resolve().parents[1]
spec = spec_from_file_location("package_release", ROOT / "scripts/package-release.py")
release = module_from_spec(spec)
spec.loader.exec_module(release)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, default=ROOT / "dev/windows-validation.json")
args = parser.parse_args()
if args.output.exists():
    parser.error("Record already exists; choose a new --output to preserve previous evidence.")
props = release.properties(ROOT)
record = release.pending_record()
record["sourceCommit"] = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
record["gameVersion"] = props["GameVersion"]
record["bepInExVersion"] = props["BepInExBuildVersion"]
record["sha256"] = {name: release.sha256(path) for name, path in release.binaries(ROOT).items()}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
print(f"Created PENDING Windows validation record: {args.output}")
