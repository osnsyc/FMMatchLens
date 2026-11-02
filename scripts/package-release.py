#!/usr/bin/env python3
"""Stage local release ZIPs. A formal release requires exact Windows-tested binary hashes.

No game/Unity/BepInEx reference DLLs are ever copied. --publish is explicitly opt-in.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CHECKS = (
    "shared_contracts", "two_consumers", "unity_main_thread", "pause_resume",
    "match_end", "menu_and_next_match", "disable_reload", "no_web_client",
    "consumer_exception", "slow_callback", "bounded_burst", "web_archive_regression",
    "no_additional_hook", "performance_baseline",
)
METRICS = (
    "dispatchP50Ms", "dispatchP95Ms", "dispatchP99Ms", "queuePeak", "dropped",
    "baselineFrameP95Ms", "sdkFrameP95Ms",
)


def pending_record() -> dict:
    return {
        "status": "pending", "sourceCommit": "", "testedAtUtc": "",
        "gameVersion": "", "bepInExVersion": "", "gameFingerprint": "",
        "sha256": dict.fromkeys(("plugin", "contracts", "hud"), ""),
        "checks": dict.fromkeys(CHECKS, False),
        "metrics": dict.fromkeys(METRICS),
    }


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def properties(root: Path) -> dict[str, str]:
    group = ET.parse(root / "Directory.Build.props").getroot().find("PropertyGroup")
    return {node.tag: node.text or "" for node in group}


def binaries(root: Path) -> dict[str, Path]:
    return {
        "plugin": root / "src/FMMatchLens.Plugin/bin/Release/net6.0/FMMatchLens.Plugin.dll",
        "contracts": root / "src/FMMatchLens.Contracts/bin/Release/net6.0/FMMatchLens.Contracts.dll",
        "hud": root / "examples/MinimalUnityHud/bin/Release/net6.0/FMMatchLens.Examples.MinimalUnityHud.dll",
    }


def validate_record(record: dict, props: dict, commit: str, paths: dict[str, Path], manifest: dict,
                    fingerprints: set[str]) -> None:
    if manifest.get("unityIntegration") is not True:
        raise ValueError("Formal SDK releases require a Unity-enabled plugin build.")
    if record.get("status") != "passed" or record.get("sourceCommit") != commit:
        raise ValueError("Windows validation must pass for the exact current commit.")
    if record.get("gameVersion") != props["GameVersion"] or record.get("bepInExVersion") != props["BepInExBuildVersion"]:
        raise ValueError("Windows validation game/BepInEx versions do not match repository metadata.")
    if record.get("gameFingerprint") not in fingerprints:
        raise ValueError("Windows validation requires a verified game fingerprint from the capture catalog.")
    if not record.get("testedAtUtc") or not all(record.get("checks", {}).get(key) is True for key in CHECKS):
        raise ValueError("Complete the Windows validation timestamp and every checklist item.")
    try:
        tested = datetime.fromisoformat(record["testedAtUtc"].replace("Z", "+00:00"))
        if tested.utcoffset() != timezone.utc.utcoffset(tested):
            raise ValueError("Timestamp is not UTC")
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError("testedAtUtc must be an ISO-8601 timestamp with UTC timezone.") from exc
    for name, path in paths.items():
        if not path.is_file() or record.get("sha256", {}).get(name) != sha256(path):
            raise ValueError(f"Windows-tested binary hash mismatch: {name}")
    metrics = record.get("metrics", {})
    for key in METRICS:
        if type(metrics.get(key)) not in (int, float) or not math.isfinite(metrics[key]) or metrics[key] < 0:
            raise ValueError(f"Missing Windows performance measurement: {key}")


def write_zip(path: Path, entries: dict[str, Path | bytes]) -> None:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, value in sorted(entries.items()):
            if isinstance(value, bytes):
                archive.writestr(name, value)
            else:
                archive.write(value, name)


def sdk_entries(root: Path) -> dict[str, Path | bytes]:
    entries: dict[str, Path | bytes] = {}
    contracts = binaries(root)["contracts"]
    for path in (contracts, contracts.with_suffix(".xml")):
        entries["lib/" + path.name] = path
    for path in (root / "examples/MinimalUnityHud").iterdir():
        if path.suffix in (".cs", ".csproj"):
            entries["examples/MinimalUnityHud/" + path.name] = path
    for name in ("build/UnityInterop.props", "Directory.Build.props", "global.json", "LICENSE",
                 "README.md", "README.zh-cn.md", "CONTRIBUTING.md"):
        entries[name] = root / name
    return entries


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--validation", type=Path, help="Completed local Windows validation JSON; absent means preview.")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts")
    parser.add_argument("--publish", action="store_true", help="Create a GitHub release only after formal validation.")
    args = parser.parse_args()
    props = properties(ROOT)
    paths = binaries(ROOT)
    preview = args.validation is None
    if args.publish and preview:
        raise ValueError("Preview bundles cannot be published as a formal SDK release.")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    dirty = subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=all"], cwd=ROOT, text=True)
    manifest = json.loads((paths["plugin"].parent / "lens-build.json").read_text())
    if manifest.get("productVersion") != props["ProjectVersion"] or manifest.get("sdkApiVersion") != f"{props['SdkApiMajor']}.{props['SdkApiMinor']}":
        raise ValueError("Stale plugin build manifest; rebuild the plugin before packaging.")
    # Contracts in the host output must be the exact same build as the developer reference.
    if sha256(paths["contracts"]) != sha256(paths["plugin"].with_name("FMMatchLens.Contracts.dll")):
        raise ValueError("Host and SDK Contracts DLLs differ; rebuild both projects together.")
    record = None
    if not preview:
        if dirty.strip():
            raise ValueError("Formal packaging requires a clean source checkout; keep validation JSON under ignored dev/.")
        import re
        catalog = (ROOT / "src/FMMatchLens.Plugin/Memory/GamePluginBuildCatalog.cs").read_text()
        fingerprints = set(re.findall(r'"([0-9a-f]{64})"', catalog))
        record = json.loads(args.validation.read_text())
        validate_record(record, props, commit, paths, manifest, fingerprints)

    suffix = "-preview" if preview else ""
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    version = props["ProjectVersion"]
    plugin_entries: dict[str, Path | bytes] = {
        "BepInEx/plugins/FMMatchLens/" + paths[name].name: paths[name] for name in ("plugin", "contracts")
    }
    plugin_entries["BepInEx/config/com.fmmatchlens.plugin.cfg.example"] = ROOT / "config/com.fmmatchlens.plugin.cfg.example"
    for name in ("README.md", "README.zh-cn.md", "CHANGELOG.md", "LICENSE"):
        plugin_entries[name] = ROOT / name
    disclosure = {
        "sourceCommit": commit, "workingTreeDirty": bool(dirty.strip()), "preview": preview,
        "unityIntegration": manifest["unityIntegration"],
        "notice": "Windows game validation pending; capture-only previews expose no SDK provider." if preview
                  else "Exact binaries validated on Windows; see windows-validation.json.",
    }
    plugin_entries["release-info.json"] = json.dumps(disclosure, indent=2).encode()
    developer_entries = sdk_entries(ROOT)
    developer_entries["release-info.json"] = plugin_entries["release-info.json"]
    if record is not None:
        evidence = json.dumps(record, indent=2).encode()
        plugin_entries["windows-validation.json"] = evidence
        developer_entries["windows-validation.json"] = evidence

    dashboard_entries = {p.relative_to(ROOT / "frontend/dist").as_posix(): p
                         for p in (ROOT / "frontend/dist").rglob("*") if p.is_file()}
    if "index.html" not in dashboard_entries:
        raise ValueError("Build the frontend before packaging.")
    for name in ("README.md", "README.zh-cn.md", "CHANGELOG.md"):
        dashboard_entries[name] = ROOT / name
    assets = {
        f"FMMatchLens-plugin-v{version}{suffix}.zip": plugin_entries,
        f"FMMatchLens-dashboard-v{version}{suffix}.zip": dashboard_entries,
        f"FMMatchLens-SDK-v{props['SdkApiMajor']}.{props['SdkApiMinor']}{suffix}.zip": developer_entries,
    }
    for name, entries in assets.items():
        write_zip(output / name, entries)
    sums = "".join(f"{sha256(output / name)}  {name}\n" for name in assets)
    checksum_path = output / ("SHA256SUMS-preview.txt" if preview else "SHA256SUMS.txt")
    checksum_path.write_text(sums, encoding="utf-8")
    print(f"Packaged {'preview' if preview else 'Windows-validated release'} at {output}")
    if args.publish:
        tag_commit = subprocess.check_output(["git", "rev-parse", f"v{version}^{{commit}}"], cwd=ROOT, text=True).strip()
        if tag_commit != commit:
            raise ValueError("Release tag does not point to the Windows-validated source commit.")
        subprocess.run(["gh", "release", "create", f"v{version}", "--verify-tag", "--generate-notes",
                        "--title", f"FMMatchLens v{version}", *[str(output / n) for n in assets], str(checksum_path)],
                       cwd=ROOT, check=True)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        print(f"Release packaging failed: {exc}", file=sys.stderr)
        sys.exit(1)
