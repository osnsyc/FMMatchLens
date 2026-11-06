# Kit definitions and native layout

These notes preserve findings from Il2CppDumper, GameAssembly instructions,
Ghidra analysis of `game_plugin.dll`, and read-only match samples. Asset extraction
and conversion are documented in [Asset pipeline](asset-pipeline.md).

## Build and address conventions

- Dumper inputs: `dump.cs`, `script.json` and `stringliteral.json`. Line numbers
  and TypeDefIndex values below identify this dump only; search by type name in
  later dumps instead of loading the entire file.
- GameAssembly addresses below are **RVAs**. Key methods were checked against
  instructions, but the dump and installed binary were not fully authenticated
  as the same version.
- Native analysis: `steam-26340721/game_plugin.dll`, image base `0x180000000`.
  `FUN_18...`, `DAT_18...` and instruction addresses are **analysis VAs**.
  Runtime address = loaded module base + (analysis VA − image base).
- Native DLL SHA-256:

```text
252ff8fb5b7a4a5a5464db6ba632e309eef9b6e65ffa992ae20575a189e66c6a
```

Offsets and function addresses require revalidation for other builds.

## PlayerKitSetup and native cache K

`SI.Match.PlayerKitSetup` (TypeDefIndex 19112, `dump.cs:1050477`) contains four
`sbyte` styles and thirteen 16-byte RGBA float `Color` fields, totaling `0xD4`.
Native cache K stores packed `uint32 ARGB` instead. K is the data pointer returned
by `FUN_18012b240(manager, result, teamId, opponentId)`, not its reference-count
control block or TeamBase. The manager is `DAT_1856F71B8`; selection depends on
both team and opponent IDs.

| Field | PlayerKitSetup | Outfield K | Goalkeeper K |
| --- | --- | --- | --- |
| shortsStyle | `+0x00` | `+0x04` | `+0x3D` |
| socksStyle | `+0x01` | `+0x05` | `+0x3E` |
| shirtStyle | `+0x02` | `+0x06` | `+0x3C` |
| backOfShirtType | `+0x03` | `+0x07` | `+0x3F` |
| shirtBackgroundColor | `+0x04` | `+0x08` | `+0x40` |
| shirtForegroundColor | `+0x14` | `+0x0C` | `+0x44` |
| shirtOutlineColor | `+0x24` | `+0x10` | `+0x48` |
| shirtNumberColor | `+0x34` | `+0x14` | `+0x4C` |
| shirtNumberOutlineColor | `+0x44` | `+0x18` | `+0x50` |
| shortsBackgroundColor | `+0x54` | `+0x1C` | `+0x54` |
| shortsForegroundColor | `+0x64` | `+0x20` | `+0x58` |
| socksBackgroundColor | `+0x74` | `+0x24` | `+0x6C` |
| socksForegroundColor | `+0x84` | `+0x28` | `+0x70` |
| iconBackgroundColor | `+0x94` | `+0x2C` | `+0x5C` |
| iconForegroundColor | `+0xA4` | `+0x30` | `+0x60` |
| iconOutlineColor | `+0xB4` | `+0x34` | `+0x64` |
| iconNumberColor | `+0xC4` | `+0x38` | `+0x68` |

Field meanings follow both `FUN_18081d820` (packed ARGB → RGBA floats) and
`FUN_18081afa0` (TeamKitSetup output). Goalkeeper order is not a uniform shift
of outfield order. These structures cannot be mapped by simply dividing Color
offsets or spacing by four.

```text
FUN_18012b240 → K
  → FUN_18081d820 → prepared team records (home/away stride 0x800)
  → FUN_18081afa0 → TeamKitSetup (outfield +0x04, goalkeeper +0xD8)
  → FUN_18081af50 → MatchEnvironmentSetup (home +0x00, away +0x200)
```

`FUN_18081bde0` prepares both teams; `FUN_187564580` selects prepared data by
match handle before calling `FUN_18081af50`. These intermediate offsets are not
TeamBase offsets.

## Resource selection and rendering

`FM.Graphics.CharacterBuilder.AssetRegistry.KitBuilderRegistry` (TypeDefIndex
11147, `dump.cs:693402`) defines 58 generic kits, 3 back types, 10 shorts styles
and 16 socks styles, plus clothing mask references. `BackOfShirtStyle`
(`dump.cs:693077`) defines SameAsFront=0, SquareForNumber=1 and Plain=2.

The 3D `GenericKits` method (GameAssembly RVA `0x3E90C0`) is equivalent to:

```csharp
if ((uint)(index - 1) > 57) index = 1;
if ((uint)backStyle > 2) backStyle = 0;
return string.Format("kit_default_{0:00}-{1}", index, backStyle);
```

The format string was confirmed from dump strings and instructions.
`KitMaterials.<ApplyGenericKitToTextureArray>d__13.MoveNext` (`0x3ED520`) uses
these styles and masks. This 3D path does not establish 2D resource coverage.

| GameAssembly method | RVA | Finding |
| --- | --- | --- |
| `FMTacticsShirt.TrySetupShirt` | `0x96FBD0` | Shirt UI: ResourceType 6=outfield back, 8=goalkeeper back, 7=front |
| `DatabaseObjectImageHelpers.GetKit2DResourceID` | `0x8FB530` | Builds the `kit2d_` keys |
| `SI.UI.Image.SetupImageColourReplacements` | `0x1916840` | Supplies three replacement colours |
| `SI.UI.Image.ProcessImage` | `0x1915DF0` | Image processing entry |
| `UIShaderMaterialEditor.Recolour` | `0x196ED80` | Configures `SI/UI/Recoloured2D` |
| `FM.Match.CharacterVisuals2D.SetMaterial` | `0x4114F0` | Circular match markers: two material colours and number text colour |

The 2D selector builds `kit2d_{style}` for fronts and
`kit2d_{outfield|gk}_{same|square}_{style}` for backs. Plain selects `same_1`.
It does not apply the 3D 1–58 bounds; actual coverage comes from the catalog.
Licensed-image selection is a separate branch. Circular markers, shirt UI and
3D kits have distinct drawing paths; icon and shirt number colours are not aliases.

KitReference properties were identified by registration and call instructions:

| Property | ID |
| --- | --- |
| KitShirtStyle | `0x4A454E62` |
| BackOfShirtStyle | `0x3937734C` |
| BackgroundColour | `0x7A4C4371` |
| ForegroundColour | `0x54645A77` |
| OutlineColour | `0x64484A50` |

These are property IDs, not offsets. DXBC instructions for `SI/UI/Recoloured2D`
in `fm_Data/globalgamemanagers.assets` confirm the RGB coefficient equation in
the asset pipeline, independently of the property names.

## TEAM → TeamBase

```text
homeTEAM = read_ptr(GAME_MATCH + 0x15380)
awayTEAM = read_ptr(GAME_MATCH + 0x15388)
TeamBase = read_ptr(TEAM + 0x690)
colour   = read_u32(TeamBase + colourOffset)
style    = read_u8(TeamBase + styleOffset)
```

`FUN_1863160a0` links `[TEAM+0x618]=GAME_MATCH` and
`[TEAM+0x690]=[[GAME_MATCH+0x14EA0]+0x70+side*8]` (side 0=home, 1=away).
`FUN_1849f4a10` uses the same identity in its copy path. `FUN_184963300` connects
the teams and calls `FUN_184963fe0`, which queries K with reversed ID order for
the away team, then copies into context pointers `+0x70/+0x78`.

Representative dword MOVs, with RAX=K and R15=home TeamBase, contain no colour
calculation or channel shuffle:

| Instruction VA | K source | TeamBase destination | Meaning |
| --- | --- | --- | --- |
| `0x1849640B5` | `+0x0C` | `+0x34` | Outfield foreground |
| `0x1849640BC` | `+0x08` | `+0x3C` | Outfield background |
| `0x1849640C3` | `+0x10` | `+0x38` | Outfield outline |
| `0x18496410A` | `+0x44` | `+0x48` | Goalkeeper foreground |
| `0x184964111` | `+0x40` | `+0x50` | Goalkeeper background |
| `0x184964118` | `+0x48` | `+0x4C` | Goalkeeper outline |

### Colours

The 22 slots at `+0x04..+0x58` are packed `0xAARRGGBB`; little-endian bytes are
`BB GG RR AA`. They are neither pointers nor Unity float Colors.

| TeamBase | K | Meaning |
| --- | --- | --- |
| `+0x04` | `+0x30` | Outfield iconForegroundColor |
| `+0x08` | `+0x34` | Outfield iconOutlineColor |
| `+0x0C` | `+0x2C` | Outfield iconBackgroundColor |
| `+0x10` | `+0x38` | Outfield iconNumberColor |
| `+0x14` | `+0x44` | Goalkeeper shirtForegroundColor, duplicate |
| `+0x18` | `+0x48` | Goalkeeper shirtOutlineColor, duplicate |
| `+0x1C` | `+0x40` | Goalkeeper shirtBackgroundColor, duplicate |
| `+0x20` | `+0x4C` | Goalkeeper shirtNumberColor, duplicate |
| `+0x24` | `+0x50` | Goalkeeper shirtNumberOutlineColor, duplicate |
| `+0x28` | `+0x78` | titleForegroundColor |
| `+0x2C` | `+0x7C` | titleOutlineColor |
| `+0x30` | `+0x74` | titleBackgroundColor |
| `+0x34` | `+0x0C` | Outfield shirtForegroundColor |
| `+0x38` | `+0x10` | Outfield shirtOutlineColor |
| `+0x3C` | `+0x08` | Outfield shirtBackgroundColor |
| `+0x40` | `+0x14` | Outfield shirtNumberColor |
| `+0x44` | `+0x18` | Outfield shirtNumberOutlineColor |
| `+0x48` | `+0x44` | Goalkeeper shirtForegroundColor |
| `+0x4C` | `+0x48` | Goalkeeper shirtOutlineColor |
| `+0x50` | `+0x40` | Goalkeeper shirtBackgroundColor |
| `+0x54` | `+0x4C` | Goalkeeper shirtNumberColor |
| `+0x58` | `+0x50` | Goalkeeper shirtNumberOutlineColor |

Old `shirtNumberColor=+0x04` and `shirtBackgroundColor=+0x0C` names actually
referred to icon foreground/background. Old `shirtBackgroundColorGK=+0x1C` was
a real duplicate; collection now consistently uses goalkeeper `+0x48..+0x58`.
TEAM's own `+0x30/+0x34/+0x38` palette does not identify the selected match kit.

### Style bytes and corrected interpretation

| Field | TeamBase | K | Width |
| --- | --- | --- | --- |
| Outfield shirt style | `+0x1A4` | `+0x06` | 1 byte |
| Goalkeeper shirt style | `+0x1A5` | `+0x3C` | 1 byte |
| Outfield back type | `+0x1A7` | `+0x07` | 1 byte |
| Goalkeeper back type | `+0x1A8` | `+0x3F` | 1 byte |

An early table missed the second `pshuflw(...,0xE1)` during output. The corrected
mapping also has independent UI evidence: `FUN_18064ef10` obtains K and calls
`FUN_180345d20`; argument 2 writes BackOfShirtStyle and argument 9 KitShirtStyle.
At `0x18064F469` the style object goes to `[RSP+0x40]`; `0x18064F49B` supplies
the back object via RDX, followed by the call at `0x18064F49E`.
`FUN_184963fe0` byte copies complete the mapping. TeamBase `+0x1A6` comes from
K+0x01 and is not the shirt style.

## Validation and current implementation

Read-only Windows samples on 2026-11-06 used `OpenProcess` with VM_READ and
QUERY_LIMITED_INFORMATION, plus `ReadProcessMemory`. Two paused tick-207 reads
confirmed the context/TEAM pointer identity, cache equality and stable colours.
The away club palette was white/cyan/white while its selected shirt was
purple/white/purple; home shirt background `#C00020` also differed from icon
background `#C0001F`. These samples distinguish otherwise similar fields.

Earlier palette previews forced style 3 and did not establish actual patterns.
A tick-581 sample matched all eight style bytes to K and selected:

| Role | Shirt style | Back type | Resource key |
| --- | --- | --- | --- |
| Home outfield | 2 | 0 | `kit2d_outfield_same_2` |
| Home goalkeeper | 1 | 0 | `kit2d_gk_same_1` |
| Away outfield | 10 | 0 | `kit2d_outfield_same_10` |
| Away goalkeeper | 1 | 0 | `kit2d_gk_same_1` |

This verifies static data flow, sampled reads and catalog mapping. Cross-match
changes, alternate kits, final licensed-image binding and pixel-level game
screenshots remain unverified. Pausing does not freeze every thread; transient
process pointers and module bases must not become fixed addresses.

[Offsets.cs](../../src/FMMatchLens.Plugin/Memory/Offsets.cs) records 22 colours
and four style bytes. Production uses existing TeamBase metadata reads, not
per-player K lookups, and retains null fallback on failed reads. Archive 2.9
stores **14 kit values per team**: six clothing colours, four styles and four
number fill/outline colours. Older 2.7/2.8 fields retain their actual meanings;
missing styles/palettes are not invented. See
[ArchiveMetadataCodec.cs](../../src/FMMatchLens.Plugin/Services/ArchiveMetadataCodec.cs).
Rendering uses 111 base masks plus one panel and the recorded number colours.

For a new build, identify both binaries, recheck resource selection and
TEAM→TeamBase, then verify conversion, writes and UI properties independently.
Repeat read-only samples across 2d-kits/matches and rebuild assets using the pipeline.
