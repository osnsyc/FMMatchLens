# Tactical capture, decoding and archive findings

These notes preserve verified layouts and maintenance boundaries. For icon, UI option and role policy reproduction, see the [asset pipeline](asset-pipeline.md). Addresses apply only to `steam-26340721`, with this `game_plugin.dll` SHA-256:

```text
252ff8fb5b7a4a5a5464db6ba632e309eef9b6e65ffa992ae20575a189e66c6a
```

Function addresses below are **RVAs** in that DLL; the analysis image base is `0x180000000`. GameAssembly/Dumper layouts and RVAs belong to a separate module and must not be mixed with these addresses. The plugin reads memory without calling the research functions below.

## Memory layout and capture

Let `T=MatchTeam` and `C=*(T+0x630)`. The complete constants are maintained in [Offsets.cs](../../src/FMMatchLens.Plugin/Memory/Offsets.cs).

| Data | Verified layout |
| --- | --- |
| Processing / command configurations Q / S | `C+0x1818` / `C+0x2768`; configuration size `0x7A8` |
| Team instructions | Configuration `+0xE0`, one 16-byte bitset shared by both phases |
| Name / style / mentality | `+0xF8` reference-counted string, `+0x100` uint32, `+0x105` byte |
| In-possession / out-of-possession positions | `+0x118` / `+0x438`; 11 records each, stride `0x48` |
| Position fields | Mask `+0`, instruction vector `+8`, flags `+0x20`, applicability vector `+0x28`, role/duty `+0x40` |
| Personal overrides / phase slot mapping | Configuration trees at `+0x758/+0x768`; 11-byte mapping at `+0x79C`; `0xFF` falls back to the original slot |
| Personal / positional opposition instructions (OI) | 26×3 bytes at `C+0x16F8`; count at `C+0x1748`, up to 25×8 bytes at `+0x174C` |
| Player bindings | MatchPlayer roster slot `+0x1E27`, tactical slot `+0x1E51`, position key `+0xCE0`; public slot and UID are retained separately |

`TacticalStateSampler` in [GameMatchTickHook.cs](../../src/FMMatchLens.Plugin/Memory/GameMatchTickHook.cs) belongs to one candidate instance identity generation and samples within the existing hook read scope. Tactical snapshots are retained with the existing bounded pre-lock frame cache, including the opening ticks before animated-instance confirmation. Locking commits the selected instance's cached frames and shares its sampler with the confirmed session, preserving tick sampling deadlines and revisions. The excluded simulation instance's cache and sampler are released at lock and further pre-lock capture for that simulation generation is skipped. Invalid candidates, identity changes, identity eviction and plugin stop also release candidate tactical state with their existing cache lifecycle; a reused address starts a separate sampler. The first eligible hook callback reads immediately; subsequent reads occur on the first callback at least 240 instance ticks after the previous read (one game minute at four ticks per game second), independent of real elapsed time or simulation speed. For example, a first read at tick 1 is followed by reads at ticks 241, 481, and so on when those ticks are observed. A skipped interval causes one read at the current tick, without reconstructing intermediate states. The finish flag and player-roster identity/on-pitch-status changes force a read; team-pointer changes or tick rollback reset the sampling deadline and read immediately. Adjustments lasting less than 240 ticks may be missed. Identical content reuses the managed snapshot; content or read-status changes increment revision. observedTick and the timestamp identify the first observation of that revision. Snapshots retain no native pointers; read failures preserve partial/unavailable states.

Q/S remain separate: commands can reach S before being copied or adjusted into Q. They must not be treated as identical configurations or two tactical presets. JSON represents uint64 values as 16-digit hexadecimal strings and byte arrays as base64 to avoid JavaScript numeric precision loss.

## Decoding and display semantics

Entry points are [tactics.ts](../../frontend/src/components/formation/tactics.ts), [formationProjection.ts](../../frontend/src/components/formation/formationProjection.ts) and [focus.ts](../../frontend/src/components/formation/focus.ts). Normal/focus formation, player assignments and archive/playback goalkeeper detection share the Q-based projection. Formation history is derived from frame tactics and active rosters, including gaps and duty changes, through the existing frame history/replay paths; the dedicated formation history endpoint and push event have been retired. Supported builds leave legacy metadata assignments absent using the existing archive null representation. The native [TacticalFormationDecoder.cs](../../src/FMMatchLens.Plugin/Memory/TacticalFormationDecoder.cs) remains only for unsupported-build fallback. See [formation-migration-review.md](formation-migration-review.md) for migration details and remaining game-side validation.

- Formation matching uses position masks, templates and equivalence classes. The 64 templates come from static initialization, rather than player coordinates.
- Style keys are uint32 values derived from the first four ASCII characters of identifiers; `NULL=0x4E554C4C` means custom/unspecified. Configuration names can be customized and do not establish a style. Unknown bits, roles and enums retain their diagnostic values.
- Explicit position instructions and role-forced policies are decoded separately. The 28 team groups split into 19 IP and 9 OOP (phase IDs 4/5/7/10); the 17 player groups split into 13 IP and 4 OOP (group IDs 11..14). Group counts differ from option counts and active bit counts.
- A team group falls back to a default only when it has one unique option without a native bit. Conflicting explicit choices remain separate. `PI_NONE=0` icons must be selected by player group, rather than a global ID 0 lookup.
- Role policy states are `0=editable, 1=inapplicable, 2=forced off, 3=forced on`. Native group selection takes the first explicit or state-3 choice in native order. Roles, composite duties and positions outside the table are not approximated by nearby entries.
- Personal override tree person keys have not been proven to equal public UIDs; identity bindings must not be guessed. Role policies do not describe all cross-instruction conflicts or the match engine's final decisions.

OI describes the **opposing team's instructions against the current player**. An enabled personal record takes precedence as a whole; otherwise selection falls back to position. Zero values in a personal record also override positional values; dimensions are not merged independently. Default differs from explicit normal tackling.

| Raw OI value | 0 | 1 | 2 | 3 |
| --- | --- | --- | --- | --- |
| marking / pressing | Default | Never | Always | Undefined |
| tackling | Default | Normal | Ease off | Hard |
| foot | Default | Left foot | Right foot | Weaker foot |

These values come from UI DataCollection Key columns, not icon file ordering. Unknown values and read failures are not displayed as defaults.

## Realtime transport and 2.10 archives

The current realtime response and the first frame of a history response carry full state. Unchanged state uses `tacticsUnchangedFrom=revision`. Crossing a five-second time bucket sends another full baseline. The frontend keeps separate realtime/history caches, clears them between matches and leaves a gap when a referenced revision is missing, until full state restores the cache.

The archive structure version remains **2.10**. Each frame's tactics marker follows the rating tail:

| Marker | Meaning |
| --- | --- |
| 0 | Inherit the previous frame within this chunk; forbidden at chunk start |
| 1 | No current tactical state |
| 2 | Legacy JSON; still readable, no longer written |
| 3 | Varuint byte length followed by a typed binary delta, at most 1 MiB |

[ArchiveFrameCodec.cs](../../src/FMMatchLens.Plugin/Services/ArchiveFrameCodec.cs) handles tail markers. [ArchiveTacticsBinaryCodec.cs](../../src/FMMatchLens.Plugin/Services/ArchiveTacticsBinaryCodec.cs) handles team change masks, configuration/position dictionaries, player deltas by slot and tick/time deltas. [archiveParser.ts](../../frontend/src/api/archiveParser.ts) implements the matching frontend reader.

Each chunk owns its baseline and dictionaries; references never cross chunks. Each dictionary holds at most 4,096 definitions and uses inline values when full. Object tokens are `0=null, 1=inline, 2+2*id=reference, 3+2*id=definition`. Null, empty collections and unavailable states remain distinct. Readers check lengths, references and trailing bytes. Encoding, deduplication and compression run in the background archive path, outside the native hook.

Versions 2.1–2.9 retain their original read layouts. **Older 2.10 readers that only support JSON marker 2 cannot read marker 3**; the version number alone does not establish compatibility. Frontend and backend readers must be upgraded together. Recompressing one match with the same .NET 10 Fastest implementation reduced compressed chunk data by about 10.8%. Results from different runtime compressors are not directly comparable. Global compression settings and sampling frequency were not changed on that basis.

## Revalidation after updates

| Research RVA | Purpose |
| --- | --- |
| `0x14B390`, `0x49E1F10`, `0x29D9950` | Configuration copies, command writes and comparisons |
| `0x499AEB0`, `0x499AD50`, `0x13AC20`, `0x13BC60` | Formation matching, equivalence classes and template initialization |
| `0x64FE90` | Team option ID → bit |
| `0x46FDBD0` | Personal/positional OI precedence |
| `0x46C0FE0`, `0x08D540`, `0x64A8B0`, `0x64A9C0` | IP/OOP policies and UI option selection |
| `0x4EE1C50` | Seventeen native instruction-group order records |

After game updates, verify the binary fingerprint first, then Q/S, tree/vector bounds, substitutions, position swaps and isolation across consecutive matches. Compare explicit/forced instructions and OI sources with the game UI; check read-failure recovery, seeking across chunks and corrupt inputs. Real API snapshots and archives have been captured, but full acceptance against individual game panels, consecutive matches and failure recovery is still pending. Browser replay of saved snapshots does not establish fresh realtime capture validation.
