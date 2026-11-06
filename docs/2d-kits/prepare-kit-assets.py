"""Export clean 64px RGB coefficient masks and one shared green number panel.

Requires Pillow and the catalog-resolved extract-kit-assets.py export directory.
Original PNGs are read only; lossy source compression cannot be undone.
"""

import argparse
import hashlib
import json
import platform
import re
from pathlib import Path

import PIL
from PIL import Image, features


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def pixels(image):
    return list(image.get_flattened_data())


def name_overlay(template):
    """Recover white-overlay coverage from the otherwise pure-red style 1."""
    coverage = Image.new("L", template.size)
    source, result = template.load(), coverage.load()
    for y in range(16, 34):
        for x in range(32, 96):
            r, g, b, alpha = source[x, y]
            if alpha == 255 and min(r, g, b) > 0:
                result[x, y] = max(g, b)
    return coverage


def remove_name_overlay(image, coverage):
    """Invert C = (1-a)*base + a*white, retaining pattern coefficients/alpha."""
    result = image.copy()
    source, target, mask = image.load(), result.load(), coverage.load()
    for y in range(image.height):
        for x in range(image.width):
            value = mask[x, y]
            if not value:
                continue
            if value >= 255:
                raise ValueError("An opaque name overlay cannot be inverted")
            *rgb, alpha = source[x, y]
            restored = [max(0, min(255, round((c - value) * 255 / (255 - value)))) for c in rgb]
            target[x, y] = (*restored, alpha)
    return result


def square_overlay(base, square):
    """Factor square_1 = base_1*(1-a) + green*a in coefficient space."""
    result = Image.new("RGBA", base.size, (0, 255, 0, 0))
    source, reference, mask = base.load(), square.load(), result.load()
    # Exclude green sleeves/shorts; recover the curved antialiased panel edge.
    for y in range(16, 108):
        for x in range(32, 96):
            s, q = source[x, y], reference[x, y]
            if s[3] == 255 and q[3] == 255 and s[1] < 255:
                alpha = max(0, min(255, round((q[1] - s[1]) * 255 / (255 - s[1]))))
                mask[x, y] = (0, 255, 0, alpha)
    return result


def save_mask(image, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    resized = image.resize((64, 64), Image.Resampling.LANCZOS)
    resized.save(target, "WEBP", lossless=True, exact=True, method=6)
    with Image.open(target) as packed:
        if packed.convert("RGBA").tobytes() != resized.convert("RGBA").tobytes():
            raise ValueError(f"Lossless verification failed: {target}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", type=Path,
                        default=Path(__file__).resolve().parents[2] / "frontend/public/kits")
    parser.add_argument("--report", type=Path,
                        help="Audit JSON destination (default: SOURCE/conversion.json)")
    args = parser.parse_args()
    args.source, args.output = args.source.resolve(), args.output.resolve()
    if args.output.is_relative_to(args.source) or args.source.is_relative_to(args.output):
        parser.error("Source and output directories must not overlap.")
    if not features.check("webp"):
        parser.error("This Pillow installation has no WebP support.")
    analysis = json.loads((args.source / "analysis.json").read_text(encoding="utf-8"))
    index = {}
    for row in analysis["back_icons"]:
        key = row["key"]
        if key in index:
            raise ValueError(f"Duplicate catalog resource: {key}")
        original_path = (args.source / "back-original" / row["png"]).resolve()
        if not original_path.is_relative_to(args.source / "back-original"):
            raise ValueError(f"PNG path escapes source directory: {key}")
        if row.get("png_sha256") and sha256(original_path) != row["png_sha256"]:
            raise ValueError(f"Source PNG checksum mismatch: {key}")
        with Image.open(original_path) as image:
            if image.size != (128, 128):
                raise ValueError(f"Unexpected source dimensions: {key}")
            index[key] = image.convert("RGBA")
    expected = {f"kit2d_{family}_{back}_{style}"
                for family, limit in (("outfield", 56), ("gk", 55))
                for back in ("same", "square") for style in range(1, limit + 1)}
    if set(index) != expected:
        raise ValueError("Unexpected catalog coverage")

    template = index["kit2d_outfield_same_1"]
    arc = name_overlay(template)
    if not arc.getbbox():
        raise ValueError("No baked name overlay found in outfield style 1")
    panel = square_overlay(template, index["kit2d_outfield_square_1"])
    destinations, errors = [], []
    name_count = 0
    for family, folder, limit in (("outfield", "o", 56), ("gk", "g", 55)):
        for style in range(1, limit + 1):
            original = index[f"kit2d_{family}_same_{style}"]
            # These 55 textures contain the arc; outfield 2 and all GK do not.
            has_name = family == "outfield" and style != 2
            if has_name and min(original.getpixel((64, 24))[:3]) < 40:
                raise ValueError(f"Name-overlay assumption changed: {family}/{style}")
            cleaned = remove_name_overlay(original, arc) if has_name else original
            if cleaned.getchannel("A").tobytes() != original.getchannel("A").tobytes():
                raise ValueError("Cleaning changed the shirt silhouette")
            target = args.output / folder / f"s{style}.webp"
            save_mask(cleaned, target)
            destinations.append(target)
            name_count += has_name

            # Audit every original square before arc removal. Source DXT and
            # antialiasing differences mean this is not a pixel-exact encoding.
            reconstructed = Image.alpha_composite(original, panel)
            square = index[f"kit2d_{family}_square_{style}"]
            visible = [(a, b) for a, b in zip(pixels(reconstructed), pixels(square))
                       if a[3] == b[3] == 255]
            if not visible:
                raise ValueError(f"No opaque pixels available for panel audit: {family}/{style}")
            error = sum(abs(a[c] - b[c]) for a, b in visible for c in range(3)) / (len(visible) * 3)
            if error > 3:
                raise ValueError(f"Shared panel does not fit {family}/{style}: MAE {error:.3f}")
            errors.append(error)

    target = args.output / "square.webp"
    save_mask(panel, target)
    destinations.append(target)
    # Remove only obsolete numbered square assets, never the raw source PNGs.
    for folder, limit in (("o", 56), ("g", 55)):
        for style in range(1, limit + 1):
            old = args.output / folder / f"q{style}.webp"
            if old.exists():
                if not old.resolve().is_relative_to(args.output.resolve()) or not re.fullmatch(r"q\d+\.webp", old.name):
                    raise ValueError(f"Unsafe obsolete mask path: {old}")
                old.unlink()
    report = {"schema_version": 1, "script_sha256": sha256(Path(__file__)),
              "python_version": platform.python_version(),
              "pillow_version": PIL.__version__, "webp_version": features.version("webp"),
              "analysis_sha256": sha256(args.source / "analysis.json"),
              "processing": {"source_size": [128, 128], "output_size": [64, 64],
                             "resampling": "LANCZOS", "webp_lossless": True,
                             "webp_exact": True, "webp_method": 6},
              "name_overlays_removed": name_count,
              "panel_opaque_rgb_mae_mean": sum(errors) / len(errors),
              "panel_opaque_rgb_mae_max": max(errors),
              "outputs": [{"path": path.relative_to(args.output).as_posix(),
                           "bytes": path.stat().st_size, "sha256": sha256(path)}
                          for path in destinations]}
    report_path = args.report or args.source / "conversion.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Exported {len(destinations)} lossless 64px masks; {name_count} name overlays removed; "
          f"{sum(p.stat().st_size for p in destinations):,} bytes. "
          f"Shared panel source RGB MAE: mean {sum(errors) / len(errors):.3f}, max {max(errors):.3f}/255.")


if __name__ == "__main__":
    main()
