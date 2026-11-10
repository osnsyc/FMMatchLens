"""Render the nine vector-only instruction icons to their intrinsic 1x canvas.

This is a CPU mesh preview, not Unity's complete UI shader. Gradient textures,
vertex tint and circle clipping are retained; edge antialiasing can differ.
Original PNG sprites continue to be copied without processing.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

from PIL import Image


def render(asset, source):
    geometry = source / asset["geometry"]
    if hashlib.sha256(geometry.read_bytes()).hexdigest() != asset["sha256"]:
        raise ValueError("Vector geometry hash mismatch")
    mesh = json.loads(geometry.read_text(encoding="utf-8"))
    atlas_path = source / asset["gradient_atlas"]["png"]
    if hashlib.sha256(atlas_path.read_bytes()).hexdigest() != asset["gradient_atlas"]["sha256"]:
        raise ValueError("Gradient atlas hash mismatch")
    atlas = Image.open(atlas_path).convert("RGBA")
    scale = 3
    width, height = round(asset["width"]), round(asset["height"])
    image = Image.new("RGBA", (width * scale, height * scale))
    for i in range(0, len(mesh["indices"]), 3):
        vertices = [mesh["vertices"][index] for index in mesh["indices"][i:i + 3]]
        a, b, c = [v["position"] for v in vertices]
        det = (b["y"] - c["y"]) * (a["x"] - c["x"]) + (c["x"] - b["x"]) * (a["y"] - c["y"])
        if abs(det) < 1e-8:
            continue
        x0, x1 = max(0, math.floor(min(v["position"]["x"] for v in vertices) * scale)), min(width * scale, math.ceil(max(v["position"]["x"] for v in vertices) * scale))
        y0, y1 = max(0, math.floor(min(v["position"]["y"] for v in vertices) * scale)), min(height * scale, math.ceil(max(v["position"]["y"] for v in vertices) * scale))
        for y in range(y0, y1):
            for x in range(x0, x1):
                px, py = (x + .5) / scale, (y + .5) / scale
                w0 = ((b["y"] - c["y"]) * (px - c["x"]) + (c["x"] - b["x"]) * (py - c["y"])) / det
                w1 = ((c["y"] - a["y"]) * (px - c["x"]) + (a["x"] - c["x"]) * (py - c["y"])) / det
                weights = [w0, w1, 1 - w0 - w1]
                if min(weights) < -1e-6:
                    continue
                if vertices[0]["flags"]["rgba"] & 0x10000:
                    circle = {k: sum(w * v["circle"][k] for w, v in zip(weights, vertices)) for k in "xyzw"}
                    if circle["x"] ** 2 + circle["y"] ** 2 > 1 or circle["z"] > -9999 and circle["z"] ** 2 + circle["w"] ** 2 > 1:
                        continue
                uv = sum(w * v["uv"]["x"] for w, v in zip(weights, vertices))
                setting = mesh["settings"][vertices[0]["settingIndex"]]["location"]
                gradient_x = setting["x"] + max(0, min(1, uv)) * (setting["width"] - 1)
                gradient_y = atlas.height - 1 - setting["y"]
                sample = atlas.getpixel((round(gradient_x), gradient_y))
                colour = tuple(round(sample[channel] * sum(w * ((v["tint"]["rgba"] >> (8 * channel)) & 255) for w, v in zip(weights, vertices)) / 255) for channel in range(4))
                old = image.getpixel((x, y))
                alpha = colour[3] / 255
                out_alpha = alpha + old[3] / 255 * (1 - alpha)
                if out_alpha:
                    image.putpixel((x, y), tuple(round((colour[k] * alpha + old[k] * old[3] / 255 * (1 - alpha)) / out_alpha) for k in range(3)) + (round(out_alpha * 255),))
    return image.resize((width, height), Image.Resampling.LANCZOS)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("artifacts/tactics-ui-icons"))
    args = parser.parse_args()
    manifest = json.loads((args.source / "manifest.json").read_text(encoding="utf-8"))
    required = {option["uss_class"] for option in manifest["options"]}
    assets = []
    for asset in manifest["assets"]:
        if asset["format"] != "UnityVectorImage" or asset["uss_class"] not in required:
            continue
        target = args.source / "png/1x" / (asset["uss_class"] + ".png")
        target.parent.mkdir(parents=True, exist_ok=True)
        render(asset, args.source).save(target)
        assets.append({"uss_class": asset["uss_class"], "png": target.relative_to(args.source).as_posix(),
                       "width": round(asset["width"]), "height": round(asset["height"]),
                       "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
                       "rendered_from": "UnityVectorImage"})
    (args.source / "vector-1x.json").write_text(json.dumps(assets, indent=2) + "\n", encoding="utf-8")
    print(f"Rendered {len(assets)} vector-only instruction icons at intrinsic 1x size")


if __name__ == "__main__":
    main()
