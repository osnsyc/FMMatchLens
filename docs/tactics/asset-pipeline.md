# Reproducing tactical assets and static tables

This workflow reads local FM27 bundles, Dumper definitions and a verified DLL, exporting into temporary directories. The game, Il2CppDumper and Ghidra do not need to be running. See [reverse-engineering findings](reverse-engineering.md) for layouts and semantics. Keep original bundles, full exports, match snapshots and previews outside version control.

## Files and inputs

| File | Purpose |
| --- | --- |
| [extract-tactics-assets.py](extract-tactics-assets.py) | Resolve option ID → USS → Unity image/mesh; generate a manifest and previews |
| [rasterize-instruction-vectors.py](rasterize-instruction-vectors.py) | Reconstruct nine vector-only instruction icons as 1× PNGs |
| [extract-opposition-options.py](extract-opposition-options.py) | Extract OI Key mappings and instruction-group ordering |
| [extract-instruction-policy.py](extract-instruction-policy.py) | Emulate static role policies offline after verifying the complete DLL hash |
| [prepare-tactics-assets.py](prepare-tactics-assets.py) | Select runtime references, verify sources, convert images and prepare TS tables |
| [requirements.txt](requirements.txt) | Pin the verified Python export dependencies |
| [formation/data](../../frontend/src/components/formation/data) | Current TS tables, icon keys and lookup helpers |
| [game-concepts](../../frontend/public/game-concepts), [tactic_icons](../../frontend/public/tactic_icons) | Runtime images |

Original image reference chain:

```text
ui-staticdataentries_assets_all.bundle: option ID → m_imageUSS
  ui-styles_assets_{1x..4x}.bundle / FMImages_{1x..4x}
  ui-styles_assets_default.bundle / FMImages_SVG
    USS selector → rule → assets[valueIndex] → PPtr(fileID, pathID)
      ui-icons_assets_{1x..4x}.bundle + ui-iconspriteatlases_assets_{1x..4x}.bundle
      ui-icons_assets_common.bundle / VectorImage
```

These resources reside in `fm_Data/StreamingAssets/aa/StandaloneWindows64/`. The extractor also reads tactics and gameworld/match VisualTreeAssets to verify bindings, totaling 18 bundles. OI values come from `ui-datacollections_assets_all.bundle`, not filename ordering.

| OI dimension | DataCollection GUID |
| --- | --- |
| marking | `821443b4bd1a793438d158c84019fa1f` |
| pressing | `510224f13ff73cc4faf43d4111fd0ea4` |
| tackling | `b849e540a3a45304eaa8757321c1a99d` |
| foot | `3c36df2cf820f3446a5bab99fc18113b` |

## Extract and prepare

Run these PowerShell commands from the repository root using Python 3.11+; the verified environment used Python 3.12.16. Use fresh output directories and treat output from a failed run as incomplete.

```powershell
uv venv --python 3.12 dev/tactics-tools
uv pip install --python dev/tactics-tools/Scripts/python.exe -r docs/tactics/requirements.txt
$tacticsPython = Join-Path $PWD 'dev/tactics-tools/Scripts/python.exe'
$gameRoot = 'D:/SteamLibrary/steamapps/common/Football Manager 27' # Set your installation path
$dump = 'D:/analysis/Il2CppDumper/dump.cs'
$nativeDll = 'D:/analysis/steam-26340721/game_plugin.dll'

& $tacticsPython docs/tactics/extract-tactics-assets.py --game-root $gameRoot --dump $dump --output dev/tactics-reproduction/raw
& $tacticsPython docs/tactics/rasterize-instruction-vectors.py --source dev/tactics-reproduction/raw
& $tacticsPython docs/tactics/extract-opposition-options.py --game-root $gameRoot --icons-manifest dev/tactics-reproduction/raw/manifest.json --output dev/tactics-reproduction/options.json
& $tacticsPython docs/tactics/extract-instruction-policy.py --binary $nativeDll --output dev/tactics-reproduction/policy.json
& $tacticsPython docs/tactics/prepare-tactics-assets.py --source dev/tactics-reproduction/raw --options dev/tactics-reproduction/options.json --policy dev/tactics-reproduction/policy.json --output dev/tactics-reproduction/prepared
```

For an image-only rebuild, omit policy extraction and the preparation command's `--options/--policy` arguments. The preparer selects images referenced by the current `instructionOptions.ts` and retains the lookup helpers in `tacticIcons.ts`. Use `--runtime-data` to select another table directory. New instructions or game versions require reviewing references and filename abbreviations before publishing; do not publish the entire export. Preparation does not automatically overwrite frontend files or reconstruct templates and native enum/bit tables.

## Image and table rules

- Restore Sprite images to the original `m_Rect` transparent canvas using `textureRectOffset`, without applying alpha a second time. Keep original 1× dimensions. OI uses **large 32×32** sources, rather than upscaled small images; published filenames omit `_large/_small`.
- `VectorImage` exports retain meshes, vertex colours and gradient atlases. Nine instruction previews use 3× CPU rasterization followed by downsampling to intrinsic dimensions. These are reconstructions, not original game PNGs/SVGs; arcs and antialiasing can differ from Unity's shader.
- Keep the `game-concepts/` and `tactic_icons/` directories. Abbreviate filenames as `in-possession→ip`, `out-of-possession→oop`, `team-instructions→ti` and `player-instructions→pi`. Long names retain the extractor's hash suffix; collisions and missing images fail preparation.
- Encode WebP with `lossless=True, exact=True, method=6`. Decode and compare every RGBA byte, including RGB in fully transparent pixels. Replace PNG only when WebP is smaller at the same dimensions; otherwise retain PNG. Do not crop or resize.
- `instructionOptions.ts` centralizes OI, groups and ordered choices; icon lookups reuse that table. Display labels belong in [teamTactics.ts](../../frontend/src/i18n/teamTactics.ts). `instructionDefinitions.ts` combines mentality, PI enum and team bit definitions; the image extractor does not infer these values.
- The policy table covers 350 IP and 273 OOP role/duty combinations, 26 positions and 42 PIs: **680,316** values. Deduplication retains all results in 1,523 distinct state vectors and 124 shared role rows; row index 0 is valid. The exporter uses Unicorn to execute static integer predicates from the verified DLL with the UI's fixed date input `0x1B000000`. It does not load the DLL into the game, cover unlisted roles/composite duties or emulate the complete tactical engine.

The 64 templates and equivalence classes in `formationTemplates.ts` come from native static initialization, described in the reverse-engineering notes. They are not Unity image exports and are not regenerated by these commands. Template and bit/role enum changes require separate verification. Tactical animations and diagrams referenced by `m_pitchGIF/m_pitchImage` are also separate resources; this workflow records references without executing or deserializing their BinaryFormatter content.

## Baseline and verification

The full raw export contains 291 styles, 1,076 PNGs and 22 VectorImages, retaining 1×–4× variants and supporting assets. Only **167** images are published: 153 instruction icons and 14 OI icons. Same-size PNGs total **407,371 B**; lossless WebP totals **257,006 B**, a **36.9%** reduction, including nine reconstructed vector icons. This comparison uses PNGs after switching to large OI sources, rather than the previous small images.

`manifest.json` records input bundle/dump/script hashes, versions and USS/CAB/PathID provenance. `vector-1x.json` records reconstructed image hashes. `prepared/conversion.json` records source/output hashes, Pillow/libwebp versions and per-image sizes. Compare with runtime files:

```powershell
$tacticsReport = Get-Content dev/tactics-reproduction/prepared/conversion.json -Raw | ConvertFrom-Json
foreach ($item in $tacticsReport.outputs) {
    $target = Join-Path 'frontend/public' $item.path
    if (!(Test-Path -LiteralPath $target)) { "Missing: $target"; continue }
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha256) {
        "Changed: $target"
    }
}
```

Rebuilt tables may differ in formatting and object-key order; compare choice ordering and expanded policy values. Tool version changes may also alter encoded bytes. Review prepared output before manually updating images and TS tables; image extensions and registry entries must change together. Check default versus explicit normal tackling, OI opponent direction, PI_NONE grouping, unknown-value fallbacks and light/dark hover cards, then run `npm.cmd --prefix frontend run build` and `npm.cmd --prefix frontend run lint`.
