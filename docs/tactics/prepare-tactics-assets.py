"""Rebuild referenced tactical icons and optional UI tables in a fresh directory.

Uses the committed icon keys as the selection boundary, never publishes every
exported image. Does not modify game files or runtime assets.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

import PIL
from PIL import Image, features


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def resource_key(asset):
    stem = Path(asset["png"]).stem
    if asset["uss_class"].startswith("game-concepts-"):
        if not asset["uss_class"].endswith("_large"):
            return None
        return "game-concepts/" + stem.removeprefix("game-concepts-").removesuffix("_large")
    if not asset["uss_class"].startswith("tactic_icons-"):
        return None
    stem = stem.removeprefix("tactic_icons-")
    for pattern, short in ((r"out[-_]of[-_]possession", "oop"),
                           (r"in[-_]possession", "ip"),
                           (r"team[-_]instructions", "ti"),
                           (r"player[-_]instructions", "pi")):
        stem = re.sub(pattern, short, stem)
    return "tactic_icons/" + stem


def write_table(output, name, value, provenance):
    text = f"/** {provenance} */\nconst {name} = " + json.dumps(value, ensure_ascii=False, indent=2)
    (output / (name + ".ts")).write_text(text + f"\nexport default {name}\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--runtime-data", type=Path, default=Path(__file__).resolve().parents[2] / "frontend/src/components/formation/data")
    parser.add_argument("--options", type=Path, help="Optional raw extract-opposition-options.py output")
    parser.add_argument("--policy", type=Path, help="Optional raw extract-instruction-policy.py output")
    args = parser.parse_args()
    source, output, runtime = args.source.resolve(), args.output.resolve(), args.runtime_data.resolve()
    if any(output.is_relative_to(p) or p.is_relative_to(output) for p in (source, runtime)):
        parser.error("Output must not overlap raw exports or runtime data")
    if output.exists() and any(output.iterdir()):
        parser.error("Use a fresh output directory")
    refs = set(re.findall(r'"((?:game-concepts|tactic_icons)/[^"\n]+)"', (runtime / "instructionOptions.ts").read_text(encoding="utf-8")))
    if not refs:
        parser.error("No runtime icon references found")
    manifest = load(source / "manifest.json")
    vectors = load(source / "vector-1x.json")
    candidates = [a for a in manifest["assets"] if a.get("scale") == 1 and a.get("format") == "PNG"] + vectors
    selected, names = {}, {}
    for asset in candidates:
        key = resource_key(asset)
        if key not in refs:
            continue
        if key in selected:
            raise ValueError("Resource name collision: " + key)
        selected[key] = asset
        names[asset["uss_class"]] = key
        if asset["uss_class"].endswith("_large"):
            names[asset["uss_class"].removesuffix("_large") + "_small"] = key
    if set(selected) != refs:
        raise ValueError("Missing resources: " + repr(sorted(refs - set(selected))))
    output.mkdir(parents=True, exist_ok=True)
    report, registry = [], {}
    for key in sorted(selected):
        asset = selected[key]
        image_path = (source / asset["png"]).resolve()
        if not image_path.is_relative_to(source) or sha(image_path) != asset["sha256"]:
            raise ValueError("Invalid source path/hash: " + key)
        target = output / (key + ".webp")
        target.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(image_path) as image:
            rgba = image.convert("RGBA")
            if list(image.size) != [asset["width"], asset["height"]]:
                raise ValueError("Unexpected dimensions: " + key)
            image.save(target, "WEBP", lossless=True, exact=True, method=6,
                       **{k: image.info[k] for k in ("icc_profile", "exif") if k in image.info})
            with Image.open(target) as decoded:
                if decoded.size != rgba.size or decoded.convert("RGBA").tobytes() != rgba.tobytes():
                    raise ValueError("RGBA roundtrip mismatch: " + key)
            png_bytes, webp_bytes = image_path.stat().st_size, target.stat().st_size
            extension = "webp"
            if webp_bytes >= png_bytes:
                target.unlink()
                target = target.with_suffix(".png")
                target.write_bytes(image_path.read_bytes())
                extension = "png"
            registry[key] = [rgba.width, rgba.height, extension]
        report.append({"path": target.relative_to(output).as_posix(), "uss_class": asset["uss_class"],
                       "source_sha256": asset["sha256"], "sha256": sha(target),
                       "png_bytes": png_bytes, "webp_bytes": webp_bytes, "output_bytes": target.stat().st_size})
    # Keep the committed lookup helpers, replacing just the generated registry.
    code = (runtime / "tacticIcons.ts").read_text(encoding="utf-8")
    code, count = re.subn(r"(?s)(const tacticIcons = )\{.*?\}( satisfies Record)",
                          lambda m: m[1] + json.dumps(registry, indent=2) + m[2], code, count=1)
    if count != 1:
        raise ValueError("Unrecognized runtime registry layout")
    (output / "tacticIcons.ts").write_text(code, encoding="utf-8")
    if args.options:
        raw = load(args.options)
        def rename(value):
            if isinstance(value, str):
                if value.startswith(("tactic_icons-", "game-concepts-")):
                    return names[value]  # Unknown image references must fail.
                return value
            if isinstance(value, list):
                return [rename(v) for v in value]
            if isinstance(value, dict):
                return {k: rename(v) for k, v in value.items()}
            return value
        table = {"opposition": {k: {"options": v["options"]} for k, v in raw["opposition"].items()},
                 "instructionGroups": raw["instructionGroups"]}
        write_table(output, "instructionOptions", rename(table), "Native UI options; source SHA-256 " + raw["sourceSha256"])
    if args.policy:
        raw, rows, indices = load(args.policy), [], {}
        table = {k: raw[k] for k in ("groupOrder", "positions", "states")}
        for phase in ("inPossession", "outOfPossession"):
            table[phase] = {}
            for role, row in raw[phase].items():
                index = indices.get(tuple(row))
                if index is None:
                    index = len(rows)
                    indices[tuple(row)] = index
                    rows.append(row)
                table[phase][role] = index
        table["rows"] = rows
        write_table(output, "instructionPolicy", table, "Native policy: " + raw["build"] + "; SHA-256 " + raw["sourceSha256"])
    audit = {"script_sha256": sha(Path(__file__)), "manifest_sha256": sha(source / "manifest.json"),
             "vector_manifest_sha256": sha(source / "vector-1x.json"), "pillow": PIL.__version__,
             "libwebp": features.version("webp"), "outputs": report}
    for label, input_path in (("options_sha256", args.options), ("policy_sha256", args.policy)):
        if input_path:
            audit[label] = sha(input_path)
    (output / "conversion.json").write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {len(report)} referenced icons: {sum(r['png_bytes'] for r in report)} -> {sum(r['output_bytes'] for r in report)} bytes")


if __name__ == "__main__":
    main()
