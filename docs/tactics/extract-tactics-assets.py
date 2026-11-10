"""Resolve FM27 tactical UI icon references and export local reconstruction assets.

Reads Unity bundles and Dumper definitions without loading game code. PNGs keep
the original sprite canvas/alpha. VectorImage geometry is preserved, not falsely
advertised as a recovered source SVG. Keep exports outside version control.
"""

import argparse
import collections
import hashlib
import html
import json
import platform
import re
from pathlib import Path

import PIL
import UnityPy
from PIL import Image, ImageDraw, ImageFont
from UnityPy.classes import PPtr


SCALES = (1, 2, 3, 4)
OI_STATES = {
    "tight-marking": ("unselected", "always", "never"),
    "trigger-press": ("unselected", "always", "never"),
    "tackling": ("unselected", "easy", "normal", "hard"),
    "show-onto": ("unselected", "leftfoot", "rightfoot", "weakfoot"),
}
OI_CLASSES = {f"game-concepts-{family}-{state}_{size}"
              for family, states in OI_STATES.items() for state in states
              for size in ("small", "medium", "large")}
EXTRA_TERMS = ("mentality", "formation", "opposition-tactics", "opposition-instructions",
               "team-tactics", "tactical-fit", "tactics-visualiser", "tactic-primary")


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def json_safe(value):
    if isinstance(value, dict):
        return {key: str(item) if key == "m_PathID" else json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    return value


def enum_values(dump, name):
    return {int(value): symbol for symbol, value in re.findall(
        rf"public const {re.escape(name)} (\w+) = (-?\d+);", dump)}


def bundle_name(obj):
    parent = obj.assets_file.parent
    return Path(parent.name).name


def identity(obj):
    return {"bundle": bundle_name(obj), "asset_file": obj.assets_file.name,
            "path_id": str(obj.path_id), "type": obj.type.name}


def dereference(owner, pointer):
    return PPtr(m_FileID=pointer["m_FileID"], m_PathID=pointer["m_PathID"],
                assetsfile=owner.assets_file).deref()


def icon_filename(selector):
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", selector).strip("-")
    return slug if len(slug) <= 100 else slug[:82] + "--" + hashlib.sha256(selector.encode()).hexdigest()[:12]


def sprite_canvas(sprite, image):
    """Undo atlas trimming after UnityPy has decoded/rotated the packed pixels."""
    data = sprite.m_RD
    if sprite.m_SpriteAtlas:
        atlas = sprite.m_SpriteAtlas.deref_parse_as_object()
        data = next(value for key, value in atlas.m_RenderDataMap if key == sprite.m_RenderDataKey)
    size = (round(sprite.m_Rect.width), round(sprite.m_Rect.height))
    offset = data.textureRectOffset
    x, y = round(offset.x), size[1] - round(offset.y) - image.height
    if x < 0 or y < 0 or x + image.width > size[0] or y + image.height > size[1]:
        raise ValueError(f"Invalid sprite trim offset: {sprite.m_Name}, {image.size}, {size}, {(x, y)}")
    canvas = Image.new("RGBA", size)
    canvas.paste(image, (x, y))  # No alpha mask: retain the original RGBA, including edge alpha.
    return canvas, {"packed_image_size": list(image.size), "texture_rect_offset": {"x": offset.x, "y": offset.y},
                    "restored_offset_top_left": {"x": x, "y": y}, "settings_raw": data.settingsRaw}


def option_references(objects, enum_maps):
    result = []
    for obj, data in objects:
        def walk(value, path="", group=None):
            if isinstance(value, dict):
                if "m_groupID" in value:
                    group = value["m_groupID"]
                if "m_imageUSS" in value:
                    family = "team" if "m_optionID" in value else "player"
                    option_id = value.get("m_optionID", value.get("m_instructionID"))
                    result.append({"family": family, "id": option_id,
                                   "symbol": enum_maps[family].get(option_id),
                                   "source": data["m_Name"], "field_path": path,
                                   "group_id": group, "phase_id": data.get("m_phaseID"),
                                   "uss_class": value["m_imageUSS"],
                                   "pitch_image": value.get("m_pitchImage", ""),
                                   "pitch_animation": value.get("m_pitchGIF", ""),
                                   "translation_id": value.get("m_nameTranslationID", value.get("m_instructionTranslation")),
                                   "source_asset": identity(obj)})
                for key, item in value.items():
                    walk(item, path + "/" + key, group)
            elif isinstance(value, list):
                for index, item in enumerate(value):
                    walk(item, path + "/" + str(index), group)
        walk(data)
    return result


def collect_ui_bindings(objects):
    result, image_classes = [], collections.defaultdict(set)
    for obj, data in objects:
        name = data.get("m_Name", "")
        if not any(term in name.lower() for term in ("tactic", "instruction", "mentality", "formation")):
            continue
        classes, bindings, identifiers = set(), set(), set()

        def walk(value, key=""):
            if isinstance(value, dict):
                for field, item in value.items():
                    walk(item, field)
            elif isinstance(value, list):
                if key == "m_Classes":
                    classes.update(item for item in value if isinstance(item, str))
                elif key in ("m_argumentBytes", "m_bytes"):
                    raw = bytes(value)
                    identifiers.update(text.decode("ascii") for text in re.findall(rb"[\x20-\x7e]{8,}", raw)
                                       if any(word in text.lower() for word in (b"tactic", b"opposition", b"instruction")))
                else:
                    for item in value:
                        walk(item)
            elif key == "m_path" and isinstance(value, str) and value:
                bindings.add(value)
        walk(data)
        if classes or bindings or identifiers:
            result.append({"name": name, **identity(obj), "classes": sorted(classes),
                           "bindings": sorted(bindings), "serialized_identifiers": sorted(identifiers)})
            for selector in classes:
                image_classes[selector].add(name)
    return result, image_classes


def style_index(objects):
    result = collections.defaultdict(list)
    for obj, data in objects:
        if data.get("m_Name") not in {"FMImages_SVG", *[f"FMImages_{scale}x" for scale in SCALES]}:
            continue
        scale = 0 if data["m_Name"] == "FMImages_SVG" else int(data["m_Name"].split("_")[-1][0])
        for rule in data["m_Rules"]:
            classes = {part["m_Value"] for complex_selector in rule["m_ComplexSelectors"]
                       for selector in complex_selector["m_Selectors"] for part in selector["m_Parts"]
                       if part["m_Type"] == 3}
            asset_handles = [handle for prop in rule["m_Properties"] for handle in prop["m_Values"]
                             if handle["m_ValueType"] == 6]
            if not asset_handles:
                continue
            if len(asset_handles) != 1:
                raise ValueError(f"Ambiguous image rule in {data['m_Name']}: {classes}")
            for selector in classes:
                result[(selector, scale)].append({"owner": obj, "pointer": data["assets"][asset_handles[0]["valueIndex"]], "sheet": data["m_Name"],
                                                  "rule_line": rule["line"], "rule": rule})
    return result


def export_preview(output, assets, category):
    rows = [row for row in assets if row["scale"] == 2 and row["category"] == category and row.get("png")]
    if not rows:
        return
    width, height, columns = 250, 156, 5
    image = Image.new("RGB", (width * columns, height * ((len(rows) + columns - 1) // columns)), "#171e2d")
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype("consola.ttf", 12)
    except OSError:
        font = ImageFont.load_default(size=12)
    for index, row in enumerate(rows):
        x, y = index % columns * width, index // columns * height
        icon = Image.open(output / row["png"]).convert("RGBA")
        icon.thumbnail((116, 96), Image.Resampling.LANCZOS)
        image.paste(icon, (x + (width - icon.width) // 2, y + 8 + (96 - icon.height) // 2), icon)
        label = row["uss_class"].removeprefix("tactic_icons-").removeprefix("game-concepts-")
        lines = [label[offset:offset + 32] for offset in range(0, len(label), 32)]
        draw.multiline_text((x + 7, y + 106), "\n".join(lines[:3]), font=font, fill="#e2e8f0", spacing=1)
    image.save(output / f"preview-{category}.png")


def write_gallery(output, manifest):
    entries = [row for row in manifest["assets"] if row["scale"] == 2 or row["format"] == "UnityVectorImage"]
    cards = []
    for row in entries:
        name = html.escape(row["uss_class"])
        media = (f'<img src="{html.escape(row["png"])}" alt="{name}" loading="lazy">'
                 if row.get("png") else '<div class="vector">Unity VectorImage<br>geometry + gradient atlas</div>')
        links = " ".join(f'<a href="{html.escape(item["png"])}">{item["scale"]}× PNG</a>'
                         for item in manifest["assets"] if item["uss_class"] == row["uss_class"] and item.get("png"))
        if row.get("geometry"):
            links = f'<a href="{row["geometry"]}">Vector geometry JSON</a>'
        cards.append(f'<article data-name="{name.lower()}">{media}<strong>{name}</strong><small>{row["category"]} · {row["format"]}</small><p>{links}</p></article>')
    text = """<!doctype html><html lang="en"><meta charset="utf-8"><title>FM27 Tactical UI assets</title>
<style>body{margin:32px;background:#111827;color:#e5e7eb;font:14px system-ui}h1{font-size:24px}input{width:min(650px,90%);padding:12px;margin:16px 0;background:#243044;color:white;border:1px solid #526078;border-radius:8px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}article{padding:16px;background:#1b2639;border:1px solid #344155;border-radius:8px;overflow-wrap:anywhere}img,.vector{display:block;object-fit:contain;height:120px;max-width:100%;margin:0 auto 12px}.vector{display:flex;align-items:center;text-align:center;justify-content:center;color:#94a3b8}strong,small{display:block}small{margin-top:8px;color:#a5b4ce}a{color:#bfa0ff;margin-right:8px}p{line-height:1.8}</style>
<h1>FM27 tactical / opposition instruction icons</h1><p>Original transparent Sprite PNGs (1x-4x). VectorImage exports retain geometry and gradient atlases; they are not reconstructed SVGs.<br>For complete provenance and option mappings, see <a href="manifest.json">manifest.json</a>. Icon names do not establish verified numeric OI enum mappings.</p>
<input placeholder="Search style classes: passing / press / tackling / show-onto / mentality..." aria-label="Search icons"><div class="grid">"""
    text += "\n".join(cards) + "</div><script>document.querySelector('input').oninput=e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('article').forEach(x=>x.hidden=!x.dataset.name.includes(q))}</script></html>"
    (output / "index.html").write_text(text, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-root", type=Path, required=True)
    parser.add_argument("--dump", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root, output = args.game_root.resolve(), args.output.resolve()
    if output.is_relative_to(root) or root.is_relative_to(output):
        parser.error("Game and output directories must not overlap.")
    if output.exists() and any(output.iterdir()):
        parser.error("Use a fresh output directory; existing exports are never deleted or overwritten.")
    source = root / "fm_Data/StreamingAssets/aa/StandaloneWindows64"
    names = ["ui-staticdataentries_assets_all.bundle", "ui-tactics_assets_all.bundle",
             "ui-styles_assets_default.bundle", "ui-icons_assets_common.bundle",
             "ui-visualtreeassets_assets_gameworldvisualtreeassetpreload.bundle",
             "ui-visualtreeassets_assets_matchvisualtreeassetpreload.bundle"]
    for scale in SCALES:
        names.extend([f"ui-icons_assets_{scale}x.bundle", f"ui-iconspriteatlases_assets_{scale}x.bundle", f"ui-styles_assets_{scale}x.bundle"])
    for name in names:
        if not (source / name).is_file():
            parser.error(f"Missing bundle: {name}")
    dump = args.dump.read_text(encoding="utf-8-sig")
    for required in ("class TacticTeamInstructionOptionEntry", "class PlayerInstructionOptionEntry", "AssetReference = 6;"):
        if required not in dump:
            parser.error(f"Dumper definition mismatch: {required}")
    environment = UnityPy.load(*[str(source / name) for name in names])
    objects = [(obj, obj.parse_as_dict()) for obj in environment.objects if obj.type.name == "MonoBehaviour"]
    enums = {"team": enum_values(dump, "TacticTeamInstructionOptions"), "player": enum_values(dump, "PlayerInstruction")}
    references = option_references([(obj, data) for obj, data in objects if bundle_name(obj) == names[0]], enums)
    ui, ui_classes = collect_ui_bindings(objects)
    styles = style_index(objects)
    primary = {row["uss_class"] for row in references if row["uss_class"]}
    all_style_classes = {selector for selector, scale in styles}
    selected = primary | OI_CLASSES | {selector for selector in all_style_classes
                                     if selector.startswith("tactic_icons-") or selector in ui_classes
                                     or any(term in selector.lower() for term in EXTRA_TERMS)}
    unresolved = sorted(selected - all_style_classes)
    if unresolved:
        raise ValueError(f"Unresolved required icon classes: {unresolved}")
    output.mkdir(parents=True, exist_ok=True)
    assets, vectors = [], {}
    for selector in sorted(selected):
        category = "opposition" if selector in OI_CLASSES else "instructions" if selector in primary else "supporting"
        for scale in SCALES:
            choices = styles.get((selector, scale)) or styles.get((selector, 0))
            if not choices or len(choices) != 1:
                raise ValueError(f"Expected one asset for {selector} at {scale}x, got {len(choices or [])}")
            choice = choices[0]
            obj = dereference(choice["owner"], choice["pointer"])
            row = {"uss_class": selector, "category": category, "scale": scale,
                   "style_sheet": choice["sheet"], "style_rule_line": choice["rule_line"],
                   "source": identity(obj), "ui_uses": sorted(ui_classes.get(selector, []))}
            basename = icon_filename(selector)
            if obj.type.name in ("Sprite", "Texture2D"):
                parsed = obj.parse_as_object()
                image = parsed.image.convert("RGBA")
                if obj.type.name == "Sprite":
                    image, packing = sprite_canvas(parsed, image)
                    row["packing"] = packing
                if image.getchannel("A").getbbox() is None:
                    raise ValueError(f"Empty alpha channel for {selector}/{scale}")
                path = Path(f"png/{scale}x/{basename}.png")
                (output / path).parent.mkdir(parents=True, exist_ok=True)
                image.save(output / path)
                row.update(format="PNG", png=path.as_posix(), width=image.width, height=image.height,
                           sha256=digest(output / path))
                if obj.type.name == "Sprite":
                    sprite = obj.parse_as_dict()
                    row["source_rect"] = sprite["m_Rect"]
                    row["source_border"] = sprite["m_Border"]
            else:
                if scale != 1:
                    continue
                key = (obj.assets_file.name, obj.path_id)
                if key not in vectors:
                    data = obj.parse_as_dict()
                    if not all(field in data for field in ("vertices", "indices", "settings", "size", "atlas")):
                        raise ValueError(f"Unsupported image asset {identity(obj)}")
                    path = Path(f"vector/{basename}.vector.json")
                    write_json(output / path, json_safe(data))
                    vector = {"geometry": path.as_posix(), "width": data["size"]["x"], "height": data["size"]["y"],
                              "sha256": digest(output / path)}
                    if data["atlas"]["m_PathID"]:
                        atlas = dereference(obj, data["atlas"])
                        atlas_path = Path(f"vector/{basename}.gradient-atlas.png")
                        atlas.parse_as_object().image.convert("RGBA").save(output / atlas_path)
                        vector["gradient_atlas"] = {"png": atlas_path.as_posix(), "source": identity(atlas), "sha256": digest(output / atlas_path)}
                    vectors[key] = vector
                row.update(format="UnityVectorImage", **vectors[key])
            assets.append(row)
    for reference in references:
        reference["exports"] = [row.get("png", row.get("geometry")) for row in assets if row["uss_class"] == reference["uss_class"]]
    for selector in selected:
        if not any(row["uss_class"] == selector for row in assets):
            raise ValueError(f"Missing exported option class: {selector}")
    manifest = {"schema_version": 1, "python_version": platform.python_version(), "unitypy_version": UnityPy.__version__,
                "pillow_version": PIL.__version__, "script_sha256": digest(Path(__file__)), "dump_sha256": digest(args.dump),
                "inputs": [{"path": "fm_Data/StreamingAssets/aa/StandaloneWindows64/" + name, "sha256": digest(source / name)} for name in names],
                "coverage": {"option_references": len(references), "option_classes": len(primary), "oi_classes": len(OI_CLASSES),
                             "selected_classes": len(selected), "png_files": sum(row["format"] == "PNG" for row in assets),
                             "vector_images": len(vectors), "unresolved_classes": unresolved},
                "options": references, "ui_bindings": ui, "assets": assets,
                "notes": ["Unity int64 PathIDs are decimal strings.", "UnityPy decodes atlas packing; textureRectOffset restores the original Sprite.m_Rect canvas without rescaling.",
                          "Vector JSON retains curves, flags and gradient settings. It is not an original SVG or a validated web render.",
                          "OI asset state names are verified; their mapping to native numeric values is not inferred here."]}
    write_json(output / "manifest.json", manifest)
    for category in ("instructions", "opposition", "supporting"):
        export_preview(output, assets, category)
    write_gallery(output, manifest)
    print(json.dumps(manifest["coverage"], ensure_ascii=False))
    print(f"Gallery: {output / 'index.html'}")


if __name__ == "__main__":
    main()
