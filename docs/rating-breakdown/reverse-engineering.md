# Rating breakdown: Configuration, Memory Layout, and Rating Rules

This document defines the rating configuration, memory layout, mappings for 40 role categories, W00–W33 calculation rules, and implementation boundaries.

## Overall Rating Formula

**Final rating = Base score + (Base time contribution + Event rewards/compensation + Match-performance contributions weighted by participation duration in each role) × Match-context adjustment multiplier**

## Build and Address Conventions

The applicable build is Steam `26385295` build`game_plugin.dll`, with image base `0x180000000` and the following SHA-256:

```text
f79b0a3413dd0e3f461b0afbc3ff397003f4a26d7525a30717428de6a8b91196
```

Function addresses in this document are RVAs. A runtime address equals the actual module base plus the RVA; `P/S/M/T+offset` denotes an object field.

Frontend `statsRaw` is a compatibility layout and must not be treated as a direct image of native PlayerStats.

| RVA in current build | Purpose |
| --- | --- |
| `47C12C0` / `47C1DE0` | Core rating calculation / accumulation of native participation duration by category mask |
| `37F80` | Native category-history parsing and union of masks |
| `38060` | Global adjustment-multiplier selection |
| `11E100` / `3A99960` | Load rating configuration / register configuration key names |
| `4BD79C0` / `4BC1920` | Register 52 item names / initialize the name table |
| `54FA0` / `17B950` | Consume raw event statistics / resolve goals |
| `15A460` | Composite goal value Q |
| `1AA100` / `1A9AD0` | Composite save value / special saves |
| Within `4BC0100` / `4784DA0` | Other save-recording paths |
| `47E00F0` / `834C0` | Chance attribution raw 23→27 / creation of shot chances |
| `42895E0` / `428B790` | Successful / unsuccessful penalty-shootout resolution |
| `4B99A90` / `47D1C30` | Pre-match data setup / adjustment-baseline context comparison |

## Configuration and Role Mapping

### Name Registration and Configuration Loading

`4BD79C0` constructs 52 `(byte index,string name)` pairs, calls `4BC1920` to initialize them, and inserts them into the global mapping at VA `0x1858839F0` through an inline loop beginning at `4BD93A0`.

Each entry has a stride of 16 bytes, with the index in the first byte and the string at `+8`; index reads/writes occur at `4BD93ED/4BD93F2`.

`11E100` looks up indices by name, excludes the `0x34` sentinel, and writes int16 values to `row+index*2`, with a row stride of `0x68`.

`3A99960` registers `player_ratings_data` (string RVA `50862E0`). Key identifiers begin at VA `0x18587F168` and are initialized at runtime; zero values on disk do not mean the configuration is empty.

| Configuration key | Purpose |
| --- | --- |
| `values[].version/start_value` | Record fields `+0x84/+0x80` |
| `role_data[].coefficients[].name/value` | Explicit indexed names and coefficients for all 52 items |
| `role_lookup_data[].role/index` | Mapping from uint64 category masks to weight rows; the index must fall within the row-array bounds |
| `expected_score_data[].name` | Global multiplier branch names |
| `positive_multiplier/negative_multiplier` | Multipliers for positive/negative total contributions |

Names do not supersede the formulas: `Key Passes` uses open-play key passes, while `Penalties Conceded` uses penalties faced minus penalties saved.

Rating parameters come from the runtime configuration `player_ratings_data`, whose configuration records are stored in `values`.

Let `C=*(moduleBase+0x58215C8)`. The configuration-record vector is at `C+8/+0x10`, with a stride of `0x88`:

| Offset within record | Contents |
| --- | --- |
| `+0/+8` | Coefficient-vector begin/end; each row occupies `0x68` bytes, or 52 int16 values |
| `+0x18/+0x20` | Category lookup-tree root pointer / node count; node `+0x20` contains the uint64 mask and `+0x28` the row index |
| `+0x28..+0x7F` | 11 pairs of float32 positive/negative contribution-adjustment multipliers |
| `+0x80` | Base score; if -1, fall back to `i32[M+0xA84]*10` |
| `+0x84` | Configuration version; the native code selects the first record in the array satisfying `version <= u32[M+0xA3A]` |

The default frontend configuration is:

| version (original uint32) | Category mappings | Distinct weight rows | Base score |
| ---: | ---: | ---: | ---: |
| **436732957** | 40 | **35** | 6700 |

35 is the row count for version 436732957. Among the 40 categories, some share rows: 4/35, 5/48, 6/49, 9/56, and 10/40. Every row contains the complete set of 52 coefficients.

The native mapping chain is **Tactical role → Historical rating category → Configuration lookup table → Weight row**.

`observedWeightsByCategoryBit` stores the complete coefficients expanded by category; a category bit is not the same as a native row number.

`ratingRoleCategoryBits` removes duty before looking up the category by IP role, producing 40 entries. The row numbers and W00 values below refer to configuration 436732957; indexing starts at 0.

| Category bit | Mask | IP role | Weight row | Example (W00) |
| --- | --- | --- | ---: | ---: |
| 0 | `0x1` | Goalkeeper | 0 | -750 |
| 1 | `0x2` | Central Defender | 1 | -530 |
| 2 | `0x4` | Full-Back | 2 | -430 |
| 3 | `0x8` | Wing-Back | 3 | -690 |
| 4 | `0x10` | Defensive Midfielder | 4 | -640 |
| 5 | `0x20` | Central Midfielder | 5 | -380 |
| 6 | `0x40` | Wide Midfielder | 6 | -570 |
| 7 | `0x80` | Winger | 7 | -760 |
| 9 | `0x200` | Attacking Midfielder | 8 | -700 |
| 10 | `0x400` | Deep-Lying Forward | 9 | -620 |
| 11 | `0x800` | Centre-Forward | 10 | -690 |
| 12 | `0x1000` | Ball-Playing Goalkeeper | 11 | -800 |
| 14 | `0x4000` | Libero | 12 | -650 |
| 15 | `0x8000` | Deep-Lying Playmaker | 13 | -570 |
| 16 | `0x10000` | Box-to-Box Midfielder | 14 | -500 |
| 17 | `0x20000` | Advanced Playmaker | 15 | -630 |
| 18 | `0x40000` | Target Man | 16 | -570 |
| 19 | `0x80000` | Poacher | 17 | -630 |
| 24 | `0x1000000` | Ball-Playing Defender | 18 | -580 |
| 27 | `0x8000000` | Inside Forward | 19 | -730 |
| 29 | `0x20000000` | No-Nonsense Centre-Back | 20 | -480 |
| 31 | `0x80000000` | Channel Forward | 21 | -620 |
| 32 | `0x100000000` | Trequartista | 22 | -580 |
| 35 | `0x800000000` | Half-Back | 4 | -640 |
| 38 | `0x4000000000` | Advanced Wing-Back | 23 | -700 |
| 40 | `0x10000000000` | False Nine | 9 | -620 |
| 41 | `0x20000000000` | Shadow Striker | 24 | -650 |
| 43 | `0x80000000000` | Wide Playmaker | 25 | -470 |
| 44 | `0x100000000000` | Inverted Wing-Back | 26 | -570 |
| 45 | `0x200000000000` | Wide Forward | 27 | -860 |
| 46 | `0x400000000000` | Box-to-Box Playmaker | 28 | -630 |
| 48 | `0x1000000000000` | Wide Central Midfielder | 5 | -380 |
| 49 | `0x2000000000000` | Inverted Winger | 6 | -570 |
| 51 | `0x8000000000000` | Wide Centre-Back | 29 | -480 |
| 52 | `0x10000000000000` | Inverted Full-Back | 30 | -640 |
| 53 | `0x20000000000000` | No-Nonsense Goalkeeper | 31 | -720 |
| 54 | `0x40000000000000` | Overlapping Centre-Back | 32 | -620 |
| 55 | `0x80000000000000` | Playmaking Wing-Back | 33 | -610 |
| 56 | `0x100000000000000` | Channel Midfielder | 8 | -700 |
| 57 | `0x200000000000000` | Midfield Playmaker | 34 | -430 |

## Memory Layout and Capture

Let `P=MatchPlayer`, `S=*(P+0x1880)`, `M=*(P+0x280)`, `A=*(P+0x288)`, and `B=*(P+0x290)`. See [Offsets.cs](../../src/FMMatchLens.Plugin/Memory/Offsets.cs) for the complete field definitions.

| Data | Native layout and transmission |
| --- | --- |
| IP/OOP roles and positions | Role uint64 at `P+0xDB0/+0xE40`; position uint32 at `P+0xD70/+0xE00` |
| Native internal rating | int32 at `P+0x1D58`; exposed as API `rawInternalRating` and passed to the calculator as `internalScore` |
| Category history | begin/end=`P+0x1AC0/+0x1AC8`; records are `0x28` bytes, with encoded uint16 at `+0` and duration uint32 at `+0x20` |
| Rating events | begin/end=`P+0x1AA8/+0x1AB0`; records are `0x10` bytes: mask uint64 at `+0`, tick int32 at `+8`, and type/context/flag byte at `+0xC/+0xD/+0xE` |
| W24 / W25 counters | int32 at `P+0x1C48/+0x1BBC` |
| Penalty-shootout counters | int8 W2C/W2D/W2E=`P+0x1AED/+0x1AEF/+0x1AEE` |
| Penalty-shootout terminal flags | uint8 W2F/W30/W31=`P+0x1E4A/+0x1E4B/+0x1E4C` |
| Finished flag / special phase / reward mode | `M+0x15500 & 4` / byte `M+0x1556A` / byte `M+0xAD2` |

Category-history decoding: if `encoded & 0x2000` is nonzero, discard the entry. Otherwise calculate `index=((int16)(encoded<<3)>>9)+0x1F`, which ranges from 0..50, then read the uint64 mask at `module+0x51A53B8+index*8`. Aggregate-duration records do not contribute to individual categories. History records for different positions can resolve to the same category; therefore, the record count must not be treated as the number of distinct weights.

### Four Team-Context Fields

All four fields below are uint8. The plugin already captures them, writes them into the archive, and transmits them through the realtime API. A/B are contexts relative to the player: A is the player's own team, and B is the opposition, rather than fixed home/away teams. The domain meaning of special modes remains to be confirmed separately.

| Field | Native read location | Currently confirmed purpose |
| --- | --- | --- |
| `teamAEventCounterCandidate` | `A+0x72A` | Own-team score-context counter |
| `teamBEventCounterCandidate` | `B+0x72A` | Corresponding opposition counter |
| `teamAEventAdjustmentCandidate` | `A+0x122` | Own-team adjustment value in mode 2 |
| `teamBEventAdjustmentCandidate` | `B+0x122` | Opposition adjustment value in mode 2 |

`+0x122` comes from pre-match data. The exact type returned by the provider has not been confirmed, so the field cannot simply be described as first-leg goals.

These four values are used by W04/W05 and are distinct from the W32/W33 statistics for "own-team goals scored/conceded while the player was on the pitch."

## Calculation Rules and Boundaries

Let `D_b` be the participation duration for category b, `D` the total eligible participation duration, `t_b=min(D_b,21600)/21600`, and `E` a rating event. The core rules are:

1. For ordinary category-statistic contributions, first sum the products of coefficients and inputs, then blend across categories using `D_b/D`, preserving the native float32 operations and rounding order.
2. W00, W21, and W28 are independently truncated toward zero using `min(D_b,21600)/21600`; W00 is not the base score.
3. Rating events add coefficients for matching categories. The global multipliers and base score are then applied, followed by a clamp to 0..10000.
4. The final displayed value follows the integer conversion path `clamp(trunc((internal+5)/10),1,1000)/100`.

### Complete W00–W33 Overview

W identifiers are hexadecimal, giving 52 items in total. Each item draws its coefficient from the relevant category row of the selected configuration; there is no single coefficient shared by all roles.

Ordinary items in the table contain the inputs before multiplication by coefficients. W00/W21/W28 use separate time-dependent expressions, while event items add coefficients on a per-event basis.

`u8/i8/i16/i32/f32` denote native data types; `trunc` means truncation toward zero. `K[n]` refers to a decoded byte in the 36-byte `statsPacked`; multibyte fields are little-endian and ranges are inclusive. `raw` refers to the frontend compatibility layout.

`p/r` denote public player statistics and rating inputs, respectively. Q is a native composite evaluation value and must not be equated with xG.

| Weight | Meaning | Native configuration name | Native input / calculation rule | Frontend input / compatibility layout |
| --- | --- | --- | --- | --- |
| W00 | Role-participation time adjustment | `90min Adjuster` | `trunc(W00_b * min(D_b,21600)/21600)` | `r.totalEligibleDuration`, roles, and frontend category history |
| W01 | Base reward for an ordinary goal rating event | `Goals` | When the category matches and `E.flag == 0`, add W01 once per event | E mask, `+0x0E` |
| W02 | Additional Good Goal reward | `Good Goal Adder` | W01 path and `E.type == 1`; on the recording side, `6000 < Q <= 8000` | E `+0x0C`; Q is output by `0x15A460` |
| W03 | Additional Great Goal reward | `Great Goal Adder` | W01 path and `E.type == 2`; on the recording side, `Q > 8000` | Same as W02 |
| W04 | Earlier-time tier of the decisive-goal context reward at full time | `Decisive Goal` | finished, event score context, both team counters, and mode branches; use this item when the time difference is >=2401 | E, M `+0x15500/+0x154EC/+0xAD2`, team `+0x72A/+0x122` |
| W05 | Later-time tier of the same context reward | `Decisive Late Goal` | Mutually exclusive with W04; use this item when the time difference is <2401 | Same as W04 |
| W06 | Extra reward for goal events after the first element in the array | `Cumulative Goal Bonus` | Add W06 when the original event index is >0 and the category has eligible participation duration | E's original array position |
| W07 | Penalty when goals scored are below cumulative xG | `Goals minus xG times 100 (only if negative)` | `min(0,trunc(f32(f32(u8[S+8B]-f32[S+1C])*100)))` | `p.goals`, `p.xg`; raw `+8B/+1C` |
| W08 | Base assist reward | `Assists` | `u8[S+9F]` | `p.assists`; raw `+9F` |
| W09 | Additional reward for each assist starting with the second | `Cumulative Assist Bonus` | `max(u8[S+9F]-1,0)` | `p.assists` |
| W0A | Reward for shot attempts | `Shots` | `u8[S+90]` | `p.shots`; raw `+90` |
| W0B | Additional reward for shots on target | `Shots On Target` | `u8[S+91]` | `p.shotsOnTarget`; raw `+91` |
| W0C | Goal reward in penalty mode | `Penalties Scored` | Replaces W01/W02/W03 when the category matches and `E.flag != 0`; the recording-side flag comes from `M[15154] in 0x44..0x48` | E `+0x0E` |
| W0D | Penalty for missed non-shootout penalties | `Penalties Missed` | `u8[S+8D]-u8[S+8E]` | `K[4] - p.penalties`; raw `+8D/+8E` |
| W0E | Open-play key passes | `Key Passes` | `u8[S+BD]` | `K[11]`; raw `+BD` |
| W0F | Total completed passes counted toward the rating | `Passes Completed` | `(i16[S+E8]+i16[S+EA]) & 0xFFFF` | `K[30:31]+K[32:33]`; raw `+E0/+E2` |
| W10 | Corresponding total of incomplete passes | `Passes Incomplete` | `((i16[S+E4]+i16[S+E6]) & 0xFFFF) - W0F input` | `K[26:27]+K[28:29]`; raw `+DC/+DE` |
| W11 | Successful dribbles / take-ons | `Dribbles` | `u8[S+A1]` | `p.dribbles`; raw `+A1` |
| W12 | Times fouled | `Times Was Fouled` | `u8[S+A4]` | `p.fouled`; raw `+A4` |
| W13 | Total successful crosses | `Crosses Completed` | `u8[S+E1]+u8[S+E2]` | `K[18]+K[19]`; raw `+D9/+DA` |
| W14 | Total unsuccessful crosses | `Crosses Incompleted` | `u8[S+DF]+u8[S+E0] - W13 input` | `K[16]+K[17]-K[18]-K[19]`; raw `+D7/+D8` |
| W15 | Attributed chance-creation count | `Chances Created` | `u8[S+A0]`; chance records with xG≥0.15 are attributed to the most recent pass or preceding shot | `K[8]`; raw `+A0` |
| W16 | Open-play xA scaled by 100 | `Open Play xA` | `trunc(f32(f32[S+28]*100))` | `f32 K[0:3]`; raw `+28` |
| W17 | Successful tackles | `Tackles Won` | `u8[S+C7]` | `p.tacklesWon`; raw `+BF` |
| W18 | Unsuccessful tackles | `Tackles Lost` | `u8[S+C6]-u8[S+C7]` | `p.tacklesAttempted-p.tacklesWon`; raw `+BE/+BF` |
| W19 | Interceptions | `Interceptions` | `u8[S+CF]` | `p.interceptions`; raw `+C7` |
| W1A | Fouls committed | `Fouls Committed` | `u8[S+A3]` | `p.fouls`; raw `+A3` |
| W1B | Reward for blocked shots | `Blocks` | `u8[S+9C]`; the block outcome of raw 21 increments the opposing blocker's counter through the associated action | `K[5]`; raw `+9C` |
| W1C | Clearances | `Clearances` | `u8[S+D9]` | `p.clearances`; raw `+D1` |
| W1D | Penalty for mistakes leading to goals | `Mistakes Leading to Goals` | `u8[S+D0]`; several write paths occur in goal resolution at `0x17B950` | `K[12]`; raw `+C8` |
| W1E | Regaining possession | `Possession Won` | `u8[S+D7]` | `K[15]`; raw `+CF` |
| W1F | Aerial duels won | `Aerial Duels Won` | `u8[S+CB]` | `p.aerialsWon`; raw `+C3` |
| W20 | Aerial duels lost | `Aerial Duels Lost` | `u8[S+CA]-u8[S+CB]` | `p.aerials-p.aerialsWon`; raw `+C2/+C3` |
| W21 | Full-time reward for conceding no goals while on the pitch | `Clean Sheet` | `(M+15500 & 4) && u8[S+D2]==0 ? trunc(W21_b*t_b) : 0` | `ratingModel.ratingBaseCondition`, `K[14]`, category duration; raw `+CA` |
| W22 | Own-goal penalty | `Own Goal` | `u8[S+8F]` | `p.ownGoals`; raw `+8F` |
| W23 | Reward for total saves | `Saves` | `(u8[S+99]+u8[S+9A]+u8[S+9B]) & 0xFF` | `p.savesHeld+savesParried+savesTipped` |
| W24 | Additional Good Saves reward | `Good Saves Adder` | `i32[P+1C48]` | `r.internalW24` |
| W25 | Additional Great Saves reward | `Great Saves Adder` | `i32[P+1BBC]` | `r.internalW25` |
| W26 | Reward for saving non-shootout penalties | `Penalties Saved Adder` | `u8[S+9E]` | `K[7]`; raw `+9E` |
| W27 | Count of penalties faced but not saved | `Penalties Conceded` | `u8[S+9D]-u8[S+9E]` | `K[6]-K[7]`; raw `+9D/+9E` |
| W28 | Goalkeeper compensation for low saves/goals-conceded workload | `Keeper less than 5 shot boost` | Only categories 0/12/53; `a=W23 input+u8[S+D2]`; `a<5 ? trunc(W28_b*(5-a)*t_b) : 0` | W23 input, `K[14]`, category duration |
| W29 | Penalty for having one yellow card | `Yellow Card` | `u8[S+A6]==1 ? 1 : 0` | `K[9]`; raw `+A6` |
| W2A | Penalty for a two-yellow-card state | `Second Yellow Card` | `u8[S+A6]==2 ? 1 : 0` | `K[9]`; raw `+A6` |
| W2B | Red-card / sending-off count penalty (including dismissal for two yellows) | `Red Card` | `u8[S+A7]` | `K[10]`; raw `+A7` |
| W2C | Penalties scored in the shootout | `Shootout Scored` | `i8[P+1AED]` | `r.specialW2C` |
| W2D | Penalties missed in the shootout (including saves) | `Shootout Missed` | `i8[P+1AEF]` | `r.specialW2D` |
| W2E | Penalties saved in the shootout | `Shootout Saved` | `i8[P+1AEE]` | `r.specialW2E` |
| W2F | Flag for scoring the decisive winning penalty | `Shootout Winning Pen` | `u8[P+1E4A]` | `r.specialW2F` |
| W30 | Flag for saving the decisive winning penalty | `Shootout Saved Pen to Win` | `u8[P+1E4B]` | `r.specialW30` |
| W31 | Flag for missing the penalty that ends the shootout in defeat | `Shootout Missed Losing Pen` | `u8[P+1E4C]` | `r.specialW31` |
| W32 | Team goals scored while the player is on the pitch | `Team Goals For` | `u8[S+D1] → raw+C9`; the frontend calculates this item as an unsigned byte | `K[13]` |
| W33 | Team goals conceded while the player is on the pitch | `Team Goals Conceded` | `u8[S+D2] → raw+CA`; the frontend calculates this item as an unsigned byte | `K[14]` |

W15/W27 have zero coefficients in the current configuration, but their inputs and semantics are retained independently of their coefficients. The special-case conditions are detailed below.

## Global Multipliers

Let `B=trunc(backgroundInput)`, `F=int8[S+D1]`, `A=int8[S+D2]`, and `d=F-A`.

Each pair contains positive/negative multipliers. The choice within the pair depends on the sign of the total contribution before adjustment.

| Condition | Multiplier-pair index |
| --- | ---: |
| B<0, d>0, B=-1 / B≠-1 | 2 / 0 |
| B<0, F=A, B=-1 / B≠-1 | 3 / 1 |
| B<0, d<0, d>B / d=B / d<B | 4 / 5 / 10 |
| B=0, d>0 / d=0 / d<0 | 2 / 5 / 8 |
| B>0, F=A, B>1 / B≤1 | 7 / 9 |
| B>0, d<0, B>1 / B≤1 | 6 / 8 |
| B>0, d>0, d>B / d=B / d<B | 4 / 5 / 10 |

The multiplier set consists of two pairs of `(1.2,1)`, two pairs of `(1.1,1)`, and seven pairs of `(1,1)`.

When total eligible duration is below 21600, the multiplier is linearly interpolated from the default of 1 using `min(D,21600)/21600`.

Contributions use float32 multiplication and round-half-away-from-zero. After adding the base score, the result is clamped to 0..10000.

W32/W33 use uint8; the multiplier helper `38060` uses MOVSX at VA `0x180038096/0x18003809A`, preserving the int8 interpretation.

## Goal Events and Decisive Goals

Q from `15A460` incorporates `P+0x1C24`, geometry, state, match conditions, possession/goalkeeper relationships, and invocation mode. It includes an aggregation divided by 20. The function is also called by `159A60`; in domain terms, Q is a composite goal evaluation.

W04/W05 add one extra item only for ordinary goal events satisfying all the following conditions, where A/B are `*(P+0x288)/ *(P+0x290)`:

1. `M+0x15500 & 4`.
2. `uint8(A[0x72A]+B[0x72A]) == event.context`.
3. `uint8(A[0x72A]-B[0x72A]) < 2`; when `M+0xAD2==2`, also include `A[0x122]-B[0x122]`.
4. Use W05 if `currentTick-eventTick<2401`; otherwise use W04.

Sums and differences preserve uint8 wraparound, and event age uses the original Tick. Any interpretation as an "equalizer" or "winning goal" must be qualified by all of the conditions above.

`4B99A90` (`simatch::MATCH::setup_match_data`) initializes team `+0x122` in mode 2:

```text
match_data = *(M+0x14EA0)
provider = *(match_data+0x18)
info = provider.vtable[0x30](provider, teamIndex)
team[0x122] = info ? info[3] : 0xFF
```

Vtable slots use byte offsets, and the teams are at `M+0x15380/+0x15388`. A missing-data value of 0xFF must not be replaced with 0 or interpreted as 255 goals.

`47D1C30` also compares the `+0x72A/+0x122` combination. This field is a pre-match score-adjustment baseline; the domain-specific type of the structure returned by the provider remains unknown.

## Penalty Modes and Commentary Identifiers

All values 0x44..0x48 in `M+0x15154` generate a penalty flag. `42946C0` creates the `0x14`-byte message 0x49. Its 8-byte payload is `int32 time/u8 team/u8 slot/u8 mode/u8 flags`; the mode at `+6` is not renumbered.

When `(flags&3)!=2`, `4530B70 case0x49` selects an ID using `saved=flags&1`:

| Mode | ID | Not saved / saved name suffix | Technique |
| --- | --- | --- | --- |
| 0x44 | 9057+saved*4 | MissedPenaltyBlasted / SavedPenaltyBlasted | Powerful strike |
| 0x45 | 9056+saved*4 | MissedPenaltyPlaced / SavedPenaltyPlaced | Placed shot |
| 0x48 | 9055+saved*4 | MissedPenaltyChipped / SavedPenaltyChipped | Chipped shot |

Names are taken from `SI.Match.CommentaryEventDefinitions`. The ID-selection VAs are `0x1845325EA/0x184532AF7/0x184532B09`; the message-call VAs are `0x1801A9FC0/0x184BC0D0C/0x1847915E6`.

Another payload subcode in `35960C0` outputs 9053/9052/9051 for successful penalties with subcodes 0/1/2, while subcode 3 outputs 9068 together with a flag. The mapping from these subcodes to the original modes has not been established, and the action names for 0x46/47 remain unknown.

## Chances, Blocks, and Mistakes

`834C0` submits a raw21 shot. `14AC0` creates `XG_SHOT_DATA` and reads float at `+0x2C`.

raw23 is generated only for xG≥0.15. `1BCE80` classifies `[0.15,0.30)` as result 22 (output 36) and `[0.30,+∞)` as result 21 (output 35); lower-value reclassification result 23 can become invalid result 1.

The producing function is called from `17B950/4BBF350/4BCEC00` and is not limited to goals.

`47E00F0` caches the most recent pass at `+0x420`, the current shot at `+0x428`, and the preceding shot at `+0x430`; when raw21 is updated, the previous shot is moved first.

```text
raw23: exit if there is no most recent pass
By default, select the most recent pass; select the preceding shot instead if its record+0x44 is later
Exit if the selected record+0x69==1
Copy the record: +0x68=27, +0x64&=0xFFFFFFC7, +0x6E&=0xFC; clear the associated handle at +0x30
Recursively submit raw27 → 54FA0 increments S+0xA0 for the attributed player → W15
```

The marker-write VA is `0x1847E1535`. Both chance tiers share the same attribution path. Caching, invalid actions, offside, and revisions mean this cannot be simplified to "increment once whenever xG≥0.15", nor can attribution be restricted to direct passes or assists.

The detailed chance categories shown in the UI and the attribution boundary for rebound shots remain to be confirmed; the current W15 coefficient is 0.

For blocked raw21 shots, `54FA0 raw21` increments the shooter's `S+0x92`, then retrieves the team number and slot through the associated action. Only an opposing action increments the blocker's `S+0x9C/+0xDA`. W1B uses the former; the domain name of the latter remains undetermined. Not all blocked pass, cross, and shot momentum events can be merged into one category.

Writes to `S+0xD0` for W1D occur at `17D6A9/17ED69/17F946/17FB01` within `17B950`, with resolution entry points `175DF0/4BB9780`. The name is Mistakes Leading to Goals; responsibility assignment, deduplication, and other non-goal paths remain to be confirmed.

## Pass and Cross Trajectories

`+0x64` of a raw record contains statistical flags (not to be confused with same-valued flags in the exported MomentumEvent).

| Statistic | Threshold / priority | Attempt / success fields |
| --- | --- | --- |
| Pass | `flags&0x218==0`; 0x800 takes priority, otherwise 0x400 is required | 0x800→`S+E6/EA`; 0x400→`S+E4/E8` |
| Cross | 0x800 takes priority, otherwise 0x400 is required; success is determined through the associated result | 0x800→`S+DF/E1`; 0x400→`S+E0/E2` |

When neither bit is set, the action is not counted in either subtype; 0x800 is not an exclusion bit. The eighth parameter of `45220` is an action description, forwarded to the sixth parameter of `454B0` (VA `0x180045241/0x180045258`). For raw types 2/12, `u8[action+B8]<2` generates 0x400; otherwise it generates 0x800, at instruction VAs `0x18004573B..0x18004574E`.

`3B8C0` clamps the category to 0..5 and passes it to `473F860`. The latter compares the start and end Z coordinates (`+8/+0x18`), may adjust the category, and writes it back to `+B8`.

The angle path includes `[-25,-5)`, `[0,10)`, `[15,20)`, `[20,25)`, `[25,30)`, and `[45,60)`, multiplied by π (VA `0x184C4EAD0`) and then divided by 180 (VA `0x184C59E84`). Category 1 has an additional distance adjustment.

Categories 0/1 and 2..5 are referred to only as the lower/higher-category trajectory groups. Their exact labels as short/long passes or ground/aerial balls are not established. The rating uses the sum of both groups.

## Clean Sheets, Saves, and Discipline

W24/W25 are additional rewards on top of total saves W23, and the two tiers are mutually exclusive for the same save:

| Path | Condition |
| --- | --- |
| `1AA100` | Q>75→W25; 25<Q≤75→W24; neither increments for Q≤25 |
| Within `4BC0100/4784DA0` | Thresholds of 20/35 for another composite value, plus additional trajectory conditions |
| `1A9AD0` | A special save can directly increment W25 |

float32 constant VAs: 75=`0x184D9072C`, 25=`0x184DC4864`, 20=`0x184C34BA8`, 35=`0x184DDE1E0`.

Q incorporates action parameters, trajectory time differences, position normalization, and match context. It must not be interpreted as xG, a success rate, or a held/parried/tipped category.

Write-site RVAs: W24=`478F9B1`; W25=`47913EF/47917AA`.

`54FA0 raw29` first increments the taker's `S+8D` and the valid goalkeeper's `S+9D`, then handles a scored penalty at `S+8E` or a saved penalty at `S+9E` according to the result. A missing associated result must not automatically be interpreted as a penalty conceded.

Disciplinary updates in `54FA0 raw5`: outcome9, when one yellow card already exists, increments `S+A7` before incrementing `S+A6`; outcome10 directly increments `S+A7`.

Two yellow cards use W2A plus W2B instead of W29. With coefficients -50/-100/-300, the contributions before duration weighting and multipliers are -50 for one yellow card and -400 for a two-yellow dismissal.

## Penalty Shootouts

Activation condition: `M[0x1556A]==4 || int8(A[0x729])>0 || int8(B[0x729])>0`. Counters can continue to apply after the shootout has ended.

W2C–W31 are weighted by category participation duration. Terminal flags do not grant standalone, full-value rewards.

| Path | Write behavior |
| --- | --- |
| `42895E0` result subcode 5/6 | Taker W2C++; team goals `+0x729`++, remaining kicks `+0x72C`--, kicks taken++ |
| `428B790` failure | Taker W2D++; team remaining kicks--, kicks taken++; goalkeeper W2E++ if saved |
| Opponent can no longer equalize after a successful kick | Taker W2F=1 |
| Opponent can no longer equalize after a failed kick | Taker W31=1; opposing goalkeeper W30 indicates whether that kick was saved |

The terminal condition is that one team's goals exceed the other team's "goals already scored + remaining kicks". It is not limited to sudden death; a failed kick includes both saves and other misses.

Non-shootout penalties and shootouts are handled separately. The opposing goalkeeper lookup is inlined into the above functions at `M+0x15340+(1-player.teamSide)*8`; result messages 0x11/0x13 are also generated inline.

## Transmission, Archives, and Implementation Entry Points

| Layer | Maintenance entry point |
| --- | --- |
| Capture | [GameMatchTickHook.cs](../../src/FMMatchLens.Plugin/Memory/GameMatchTickHook.cs): `CaptureRatingPlayerData`, `CaptureRatingStatsInputs`, `CaptureRatingMatchData` |
| Contract / packing | [RealtimeTickFrame.cs](../../src/FMMatchLens.Plugin/Domain/RealtimeTickFrame.cs): 36-byte `statsPacked`, roles, context, and events |
| Archives | [ArchiveFrameCodec.cs](../../src/FMMatchLens.Plugin/Services/ArchiveFrameCodec.cs), [archiveParser.ts](../../frontend/src/api/archiveParser.ts) |
| Calculation | [ratingCalculator.ts](../../frontend/src/lib/ratingCalculator.ts): unpacking, historical categories, input formulas, event rewards, final rating |
| Replay / caching | [realtimeMatch.ts](../../frontend/src/api/realtimeMatch.ts): realtime and historical states are maintained separately; the cache includes the original Tick values needed for full-time events |
| Regression tests | [ratingCalculator.test.ts](../../frontend/tests/ratingCalculator.test.ts): configuration, category, input, and boundary tests |

Event deltas are transmitted via `ratingEventsCommonLength/ratingEventsTail`; an independent, complete snapshot has common=0. Previous events and role states must be reconstructed; the final frame's role cannot simply replace the full-match role history.

All four event counter/adjustment values are transmitted via the realtime wire format and written into the archive.

If realtime data lacks a field, it remains undefined. `missing_w04_w05_context` is reported only when those fields are needed for full-time rewards, rather than substituting zero.

Native category history is not currently stored on a per-frame basis. The frontend still infers it incrementally from roles and total participation duration.

After adding missing weights/mappings, reloading an existing archive is sufficient for the changes to take effect. However, unknown historical role-switch boundaries cannot be reconstructed precisely by supplementing frontend lookup tables alone.
