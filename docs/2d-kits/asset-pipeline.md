# Reproducing 2D shirt-back assets

This workflow rebuilds the generic shirt icons shown in player attribute popups.
It requires a local FM27 installation and Python tools; the game, Il2CppDumper and
Ghidra do not need to be running. For definitions and native offsets, see
[Reverse-engineering notes](reverse-engineering.md).

## Files

| File | Purpose |
| --- | --- |
| [extract-kit-assets.py](extract-kit-assets.py) | Resolve catalog keys and export 222 original PNGs with `analysis.json` |
| [prepare-kit-assets.py](prepare-kit-assets.py) | Remove baked names, recover a shared number panel and export 112 WebP masks |
| [requirements.txt](requirements.txt) | Pin the tested UnityPy and Pillow versions |
| [frontend/public/kits](../../frontend/public/kits) | Runtime assets |
| [kitRendering.ts](../../frontend/src/lib/kitRendering.ts) | Preset selection, types and colour matrix |
| [useMatchKits.ts](../../frontend/src/hooks/useMatchKits.ts) | Memoize the four match kits |
| [PlayerShirt.tsx](../../frontend/src/components/PlayerShirt.tsx) | Shared SVG symbols, shirt, curved name and number |

Both scripts read game files without modifying them. Keep bundles, raw exports
and local diagnostics outside version control.

## Resource families

Coverage below describes the inspected FM27 catalog, not every game version.
Bundle paths are relative to `fm_Data/StreamingAssets/AddrData/`.

| Family | Example key | Bundle | Coverage | Original size |
| --- | --- | --- | --- | --- |
| 3D generic | `kit_default_01-0` | `kits3d-default_assets_all.bundle` | 58 styles × 3 back types | Not extracted here |
| 2D front | `kit2d_3` | `kits2d-default_assets_all.bundle` | Styles 1–56, plus auxiliary textures | 1024×1024 |
| 2D outfield back | `kit2d_outfield_same_3`, `kit2d_outfield_square_3` | `kits2d-back_assets_all.bundle` | Styles 1–56 × 2 variants | 128×128 |
| 2D goalkeeper back | `kit2d_gk_same_3`, `kit2d_gk_square_3` | `kits2d-goalkeeper_assets_all.bundle` | Styles 1–55 × 2 variants | 128×128 |

The extractor handles only the last two families: `(56 + 55) × 2 = 222` textures.
All inspected objects are `Texture2D`, stored as `DXT5Crunched` (enum 29) and
decoded by UnityPy to RGBA PNG. Front and back patterns can differ at the same
index. Retain numeric style IDs: there is no verified list of descriptive pattern
names, and the 3D count must not be used to fill missing 2D styles.

| BackOfShirtStyle | Value | Game resource | Frontend representation |
| --- | --- | --- | --- |
| SameAsFront | 0 | Current style, `same` | Base mask |
| SquareForNumber | 1 | Current style, `square` | Base mask plus `square.webp` |
| Plain | 2 | Style 1, `same` | Family-specific `s1.webp` |

Outfield and goalkeeper families remain separate. Licensed and user-provided
images follow other paths and are outside this workflow.

## Extract and rebuild

Run these PowerShell commands from the repository root. Python 3.11+ is required;
the verified environment used Python 3.12.16, UnityPy 1.25.4 and Pillow 12.3.0.

```powershell
uv venv --python 3.12 dev/kit-tools
uv pip install --python dev/kit-tools/Scripts/python.exe -r docs/2d-kits/requirements.txt

$kitPython = Join-Path $PWD 'dev/kit-tools/Scripts/python.exe'
$gameRoot = 'D:/SteamLibrary/steamapps/common/Football Manager 27' # Set your installation path

# Extract outside the game installation.
& $kitPython docs/2d-kits/extract-kit-assets.py --game-root $gameRoot --output dev/kit-reproduction/raw

# Build a separate copy for comparison before replacing runtime assets.
& $kitPython docs/2d-kits/prepare-kit-assets.py --source dev/kit-reproduction/raw --output dev/kit-reproduction/webp
```

The extractor reads `catalog_info.bin` and the two back bundles listed above.
It follows `key → GUID → bundle container → Texture2D / PathID`, rather than
guessing keys from object names. Known catalog records contain a little-endian
uint32 key length, ASCII key, uint32 GUID length (32), and a 32-byte hex GUID.
This is a reader for that record layout, not a general Addressables parser.
It requires exactly the expected keys and one 128×128 texture per key; changed
coverage or layout requires investigation rather than relaxed checks.

```text
dev/kit-reproduction/
  raw/
    analysis.json
    back-original/          # 222 key__Texture2D__PathID.png files
    conversion.json
  webp/
    o/s1.webp ... s56.webp   # Outfield
    g/s1.webp ... s55.webp   # Goalkeeper
    square.webp             # Shared green-channel panel
```

`analysis.json` records source hashes, tool/script versions or hashes, and each
PNG's key, GUID, catalog offset, bundle, asset file, PathID, format, size and hash.
`conversion.json` records the analysis hash, script hash, Pillow/WebP versions,
conversion settings, panel error and output sizes/hashes. Override its location
with `--report`. Older exports with `back_icons` and matching PNGs also work;
PNG hash checks apply when the source manifest provides hashes.

Compare the temporary output with current assets using the conversion report;
an identical rebuild produces no output:

```powershell
$kitReport = Get-Content dev/kit-reproduction/raw/conversion.json -Raw | ConvertFrom-Json
foreach ($item in $kitReport.outputs) {
    $target = Join-Path 'frontend/public/kits' $item.path
    if (!(Test-Path -LiteralPath $target)) { "Missing: $target"; continue }
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha256) {
        "Changed: $target"
    }
}
```

After review, omit `--output` to write to the repository's `frontend/public/kits`,
independently of the current working directory:

```powershell
& $kitPython docs/2d-kits/prepare-kit-assets.py --source dev/kit-reproduction/raw
```

This overwrites matching masks and removes obsolete numbered `o/q*.webp` and
`g/q*.webp` within the old supported ranges. Original PNGs stay untouched.
Treat output from a failed run as incomplete.

## Conversion details

The `SI/UI/Recoloured2D` shader treats RGB as independent coefficients:

```text
RGB = texture.r × background.rgb + texture.g × foreground.rgb + texture.b × outline.rgb
A   = texture.a
```

Coefficients are not normalized; B is the third clothing colour, not exclusively
an edge outline. The frontend uses an sRGB SVG `feColorMatrix`, preserving mask
alpha. Names and numbers use separate text with the kit's number fill/outline.

Processing occurs at 128×128 before resizing:

1. **Remove baked names.** Outfield styles other than 2 contain a white name arc
   (55 textures); goalkeeper textures do not. Recover coverage from the otherwise
   red outfield style 1, using `max(G,B)` on opaque pixels within
   `x=32..95, y=16..33`. In normalized units, invert
   `covered = base × (1-a) + white × a` as `base = (covered-a)/(1-a)`.
   Clamp RGB and preserve alpha. Fully opaque coverage cannot be inverted.
2. **Recover one number panel.** Original square textures contain distinct base
   patterns. Factor the repeated green panel from the original outfield style-1
   same/square pair: `a = (square.g-same.g)/(1-same.g)`, restricted to
   `x=32..95, y=16..107`. Store `(0,255,0,a)` with antialiased coverage.
   The frontend composites it over the base **before recolouring**, so the panel
   takes the foreground colour.
3. **Audit the approximation.** Before name removal or resizing, reconstruct all
   111 square variants. Compare RGB only where both images have alpha 255; fail
   if any image's mean absolute error (MAE) exceeds 3 on the 0–255 scale.
   Source compression and edge differences prevent exact shared-panel recovery.
4. **Resize and encode.** Use LANCZOS to produce 64×64 RGBA, then WebP with
   `lossless=True, exact=True, method=6`. Decode each output and require identical
   pixels, including transparent RGB, to the resized image.

Lossless describes WebP encoding, not source compression, overlay inversion or
downsampling. Template bounds are specific to these assets; script checks do not
replace visual inspection after updates.

## Baseline and acceptance

The verified rebuild produced 112 masks totaling **273,028 bytes** (about 267 KiB),
all byte-identical to the current runtime assets. All 222 extracted PNGs matched
the earlier export pixel-for-pixel. Panel MAE averaged 0.163 across image means,
with a maximum of 2.370, on the 0–255 scale; this excludes transparent edges and
does not measure similarity to game screenshots.

| Input | SHA-256 |
| --- | --- |
| `catalog_info.bin` | `c8944caa2722c6a36f86c23029885b9f40d3e70a54150aab02fba45ccdf7e930` |
| `kits2d-back_assets_all.bundle` | `ceca4b59dcbf410925afcb9f8000622919366d3e9801be0980c887abef2c0f9d` |
| `kits2d-goalkeeper_assets_all.bundle` | `235ef3308070daf7008863c53769f133e50c68806e85500a5db60317e1c5e2e9` |

After updates, check coverage, hashes, dimensions, name removal, pattern edges and
alpha. Preview all three back types for both families using distinct replacement
colours, review panel errors, then run:

```powershell
npm.cmd --prefix frontend test -- tests/kitRendering.test.ts tests/theme/teamColors.test.ts
```

Tool/library changes may alter output. Game sampling, colour space, UI tint and
licensed-image selection can also differ from this offline reconstruction.
