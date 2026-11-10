"""Export verified OI icon lookup tables and ordered instruction choices as metadata."""
import argparse
import hashlib
import json
from pathlib import Path
import UnityPy

GUIDS = {
    "marking": "821443b4bd1a793438d158c84019fa1f",
    "pressing": "510224f13ff73cc4faf43d4111fd0ea4",
    "tackling": "b849e540a3a45304eaa8757321c1a99d",
    "foot": "3c36df2cf820f3446a5bab99fc18113b",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-root", type=Path, required=True)
    parser.add_argument("--icons-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.resolve().is_relative_to(args.game_root.resolve()):
        parser.error("Metadata output must be outside the game installation.")
    bundle = args.game_root / "fm_Data/StreamingAssets/aa/StandaloneWindows64/ui-datacollections_assets_all.bundle"
    environment = UnityPy.load(str(bundle))
    tables = {}
    for dimension, guid in GUIDS.items():
        obj = environment.container[guid].deref()
        data = obj.parse_as_dict()
        columns = {r["data"]["m_name"]: r["data"]["m_rows"] for r in data["references"]["RefIds"]}
        keys = columns["Key"]
        if keys != list(range(3 if dimension in ("marking", "pressing") else 4)):
            raise ValueError(f"Unexpected OI keys for {dimension}: {keys}")
        for size in ("small", "medium", "large"):
            if len(columns[size]) != len(keys):
                raise ValueError(f"Incomplete lookup: {dimension}/{size}")
        tables[dimension] = {"guid": guid, "name": data["m_Name"], "pathId": str(obj.path_id),
                             "options": [{"value": value, "state": columns["small"][i].rsplit("-", 1)[-1].removesuffix("_small"),
                                          "icon": columns["small"][i]} for i, value in enumerate(keys)]}
    manifest = json.loads(args.icons_manifest.read_text(encoding="utf-8"))
    groups = {}
    for option in manifest["options"]:
        family = option["family"]
        group = option["source"] if family == "team" else str(option["group_id"])
        key = family + ":" + group
        entry = groups.setdefault(key, {"family": family, "group": group, "phase": option["phase_id"], "choices": []})
        entry["choices"].append({"id": option["id"], "symbol": option["symbol"], "icon": option["uss_class"]})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"schema": 1, "sourceBundle": bundle.name,
        "iconsManifestSha256": hashlib.sha256(args.icons_manifest.read_bytes()).hexdigest(),
        "sourceSha256": hashlib.sha256(bundle.read_bytes()).hexdigest(), "opposition": tables,
        "instructionGroups": list(groups.values())}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Exported 4 OI dimensions and {len(groups)} ordered instruction groups")


if __name__ == "__main__":
    main()
