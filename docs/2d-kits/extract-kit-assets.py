"""Extract catalog-resolved FM27 2D shirt backs without modifying game files.

This reads the known catalog_info.bin key/GUID record layout, not arbitrary
Addressables catalogs. Output is compatible with prepare-kit-assets.py.
"""

import argparse
import hashlib
import json
import platform
import re
import struct
from pathlib import Path

import PIL
import UnityPy


BUNDLES = ("kits2d-back_assets_all.bundle", "kits2d-goalkeeper_assets_all.bundle")
KEY_GUID = re.compile(
    rb"(kit2d_(?:outfield|gk)_(?:same|square)_[0-9]+)"
    rb"\x20\x00\x00\x00([0-9a-f]{32})"
)


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-root", required=True, type=Path,
                        help="Game installation containing fm_Data")
    parser.add_argument("--output", required=True, type=Path,
                        help="Research output outside the game installation")
    args = parser.parse_args()
    root, output = args.game_root.resolve(), args.output.resolve()
    if output.is_relative_to(root) or root.is_relative_to(output):
        parser.error("Game and output directories must not overlap.")
    source = root / "fm_Data/StreamingAssets/AddrData"
    inputs = [source / name for name in ("catalog_info.bin", *BUNDLES)]
    for path in inputs:
        if not path.is_file():
            parser.error(f"Missing input: {path}")
    expected = {f"kit2d_{family}_{back}_{style}"
                for family, limit in (("outfield", 56), ("gk", 55))
                for back in ("same", "square") for style in range(1, limit + 1)}
    catalog = inputs[0].read_bytes()
    entries = {}
    for match in KEY_GUID.finditer(catalog):
        if match.start() < 4 or struct.unpack_from("<I", catalog, match.start() - 4)[0] != len(match[1]):
            continue
        key = match[1].decode("ascii")
        entry = {"key": key, "guid": match[2].decode("ascii"), "catalog_offset": match.start()}
        if key in entries:
            raise ValueError(f"Duplicate catalog key: {key}")
        entries[key] = entry
    if set(entries) != expected:
        raise ValueError(f"Catalog coverage changed; missing={sorted(expected - set(entries))}, "
                         f"extra={sorted(set(entries) - expected)}")

    # Keep environments alive while dereferencing Texture2D/container pointers.
    environments = [UnityPy.load(str(path)) for path in inputs[1:]]
    index = {}
    for bundle, environment in zip(BUNDLES, environments):
        for guid, pointer in environment.container.items():
            obj = pointer.deref()
            if obj.type.name == "Texture2D":
                index.setdefault(guid, []).append((bundle, obj))
    destination = output / "back-original"
    destination.mkdir(parents=True, exist_ok=True)
    rows = []
    for key, entry in sorted(entries.items()):
        matches = index.get(entry["guid"], [])
        if len(matches) != 1:
            raise ValueError(f"Expected one Texture2D for {key}, found {len(matches)}")
        bundle, obj = matches[0]
        texture = obj.parse_as_object()
        filename = f"{key}__Texture2D__{obj.path_id}.png"
        with texture.image.convert("RGBA") as image:
            if image.size != (128, 128):
                raise ValueError(f"Unexpected dimensions for {key}: {image.size}")
            image.save(destination / filename)
        rows.append({**entry, "name": texture.m_Name, "type": obj.type.name,
                     "bundle": bundle, "asset_file": obj.assets_file.name,
                     "path_id": obj.path_id, "width": 128, "height": 128,
                     "texture_format": int(texture.m_TextureFormat),
                     "png": filename, "png_sha256": sha256(destination / filename)})
    report = {"schema_version": 1, "script_sha256": sha256(Path(__file__)),
              "python_version": platform.python_version(),
              "unitypy_version": UnityPy.__version__, "pillow_version": PIL.__version__,
              "inputs": [{"path": path.relative_to(root).as_posix(), "sha256": sha256(path)}
                         for path in inputs],
              "back_icons": rows}
    (output / "analysis.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Extracted {len(rows)} catalog-resolved 128px RGBA masks to {destination}")


if __name__ == "__main__":
    main()
