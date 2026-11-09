using System.Text;
using FMMatchLens.Plugin.Domain;

namespace FMMatchLens.Plugin.Services;

// One context per chunk. Definitions never refer to another chunk or native memory.
// Token 0=null, 1=inline, 2+2*id=reference, 3+2*id=new definition.
internal sealed class ArchiveTacticsBinaryCodec
{
    private const int MaxDefinitions = 4096;
    private readonly Definitions<TacticalPosition> _positions = new(PositionEqual, PositionHash);
    private readonly Definitions<TacticalConfiguration> _configurations = new(TacticalSnapshotEquality.Config, ConfigurationHash);

    public void Write(BinaryWriter writer, TacticalSnapshot? previous, TacticalSnapshot current)
    {
        ArchiveBinary.WriteVarInt64(writer, (long)current.ObservedTick - (previous?.ObservedTick ?? 0));
        ArchiveBinary.WriteVarInt64(writer, current.CapturedUnixMilliseconds - (previous?.CapturedUnixMilliseconds ?? 0));
        ArchiveBinary.WriteVarUInt64(writer, (ulong)current.Revision);
        WriteTeam(writer, previous?.Home, current.Home);
        WriteTeam(writer, previous?.Away, current.Away);
    }

    public TacticalSnapshot Read(BinaryReader reader, TacticalSnapshot? previous)
    {
        var tick = checked((int)checked((previous?.ObservedTick ?? 0) + ArchiveBinary.ReadVarInt64(reader)));
        var captured = checked((previous?.CapturedUnixMilliseconds ?? 0) + ArchiveBinary.ReadVarInt64(reader));
        var revision = checked((long)ArchiveBinary.ReadVarUInt64(reader));
        return new(tick, captured, ReadTeam(reader, previous?.Home), ReadTeam(reader, previous?.Away)) { Revision = revision };
    }

    private void WriteTeam(BinaryWriter w, TacticalTeamData? prior, TacticalTeamData value)
    {
        var mask = prior is null ? 63 :
            (prior.Status != value.Status ? 1 : 0) |
            (!TacticalSnapshotEquality.Config(prior.Processing, value.Processing) ? 2 : 0) |
            (!TacticalSnapshotEquality.Config(prior.Command, value.Command) ? 4 : 0) |
            (!Equal(prior.PersonalOpposition, value.PersonalOpposition) ? 8 : 0) |
            (!Equal(prior.PositionOpposition, value.PositionOpposition) ? 16 : 0) |
            (!Equal(prior.Players, value.Players) ? 32 : 0);
        w.Write((byte)mask);
        if ((mask & 1) != 0) w.Write(value.Status switch { "complete" => (byte)0, "partial" => (byte)1, _ => (byte)2 });
        if ((mask & 2) != 0) WriteConfiguration(w, value.Processing);
        if ((mask & 4) != 0) WriteConfiguration(w, value.Command);
        if ((mask & 8) != 0) WriteBytes(w, value.PersonalOpposition);
        if ((mask & 16) != 0) WriteArray(w, value.PositionOpposition, p => { U(w, p.PositionKey); U(w, p.PackedInstructions); });
        if ((mask & 32) != 0) WritePlayers(w, prior?.Players, value.Players);
    }

    private TacticalTeamData ReadTeam(BinaryReader r, TacticalTeamData? prior)
    {
        var mask = r.ReadByte();
        if ((mask & ~63) != 0 || prior is null && mask != 63) throw Invalid("Invalid team mask.");
        var status = (mask & 1) == 0 ? prior!.Status : r.ReadByte() switch { 0 => "complete", 1 => "partial", 2 => "unavailable", _ => throw Invalid("Invalid team status.") };
        return new(status,
            (mask & 2) != 0 ? ReadConfiguration(r) : prior!.Processing,
            (mask & 4) != 0 ? ReadConfiguration(r) : prior!.Command,
            (mask & 8) != 0 ? ReadBytes(r, 78) : prior!.PersonalOpposition,
            (mask & 16) != 0 ? ReadArray(r, 25, () => new TacticalOppositionPosition(UInt(r), UInt(r))) : prior!.PositionOpposition,
            (mask & 32) != 0 ? ReadPlayers(r, prior?.Players) : prior!.Players);
    }

    private void WriteConfiguration(BinaryWriter w, TacticalConfiguration? value) => _configurations.Write(w, value, c =>
    {
        WriteBytes(w, c.TeamInstructions); U(w, c.StyleKey); WriteBytes(w, c.NameUtf8);
        w.Write(c.AdditionalState); w.Write(c.Mentality); WriteBytes(w, c.PhaseSlotMapping);
        WriteArray(w, c.InPossession, p => WritePosition(w, p));
        WriteArray(w, c.OutOfPossession, p => WritePosition(w, p));
        WriteOverrides(w, c.InPossessionOverrides); WriteOverrides(w, c.OutOfPossessionOverrides);
    });

    private TacticalConfiguration? ReadConfiguration(BinaryReader r) => _configurations.Read(r, () => new(
        Required(ReadBytes(r, 16)), UInt(r), ReadBytes(r, 1024), r.ReadByte(), r.ReadByte(), Required(ReadBytes(r, 11)),
        Required(ReadArray(r, 11, () => ReadPosition(r))), Required(ReadArray(r, 11, () => ReadPosition(r))),
        ReadOverrides(r), ReadOverrides(r)));

    private void WritePosition(BinaryWriter w, TacticalPosition p) => _positions.Write(w, p, value =>
    {
        U(w, value.PositionMask); w.Write(value.Auxiliary); w.Write(value.Flags); WriteHex(w, value.RoleDuty);
        WriteArray(w, value.Instructions, v => { WriteHex(w, v.RoleKey); WriteHex(w, v.Bits); U(w, v.MarkPosition); I(w, v.MarkPlayer); });
        WriteArray(w, value.Applicability, v => { I(w, v.InstructionId); WriteHex(w, v.RoleMask); });
    });

    private TacticalPosition ReadPosition(BinaryReader r) => _positions.Read(r, () => new(
        UInt(r), r.ReadByte(), r.ReadByte(), ReadHex(r),
        ReadArray(r, 64, () => new TacticalRoleInstructions(ReadHex(r), ReadHex(r), UInt(r), checked((int)ArchiveBinary.ReadVarInt64(r)))),
        ReadArray(r, 64, () => new TacticalApplicability(checked((int)ArchiveBinary.ReadVarInt64(r)), ReadHex(r))))) ?? throw Invalid("Null position.");

    private void WriteOverrides(BinaryWriter w, TacticalPersonalOverride[]? values) => WriteArray(w, values, v =>
    { U(w, v.PersonKey); WriteArray(w, v.Positions, p => WritePosition(w, p)); });
    private TacticalPersonalOverride[]? ReadOverrides(BinaryReader r) => ReadArray(r, 26,
        () => new TacticalPersonalOverride(UInt(r), Required(ReadArray(r, 11, () => ReadPosition(r)))));

    private static void WritePlayers(BinaryWriter w, TacticalPlayerSlot[]? prior, TacticalPlayerSlot[] values)
    {
        var reset = prior is null || prior.Length != values.Length || prior.Where((p, i) => p.Slot != values[i].Slot || p.PlayerId != values[i].PlayerId).Any();
        w.Write(reset);
        if (reset) U(w, (ulong)values.Length);
        for (var i = 0; i < values.Length; i++)
        {
            var v = values[i]; var p = reset ? null : prior![i];
            if (reset) { U(w, (ulong)v.Slot); I(w, v.PlayerId); }
            var mask = reset ? 7 : (p!.RosterSlot != v.RosterSlot ? 1 : 0) | (p.TacticSlot != v.TacticSlot ? 2 : 0) | (p.OppositionPositionKey != v.OppositionPositionKey ? 4 : 0);
            w.Write((byte)mask);
            if ((mask & 1) != 0) U(w, v.RosterSlot.HasValue ? (ulong)(v.RosterSlot.Value + 129) : 0);
            if ((mask & 2) != 0) U(w, v.TacticSlot.HasValue ? (ulong)(v.TacticSlot.Value + 129) : 0);
            if ((mask & 4) != 0) U(w, v.OppositionPositionKey.HasValue ? (ulong)v.OppositionPositionKey.Value + 1 : 0);
        }
    }

    private static TacticalPlayerSlot[] ReadPlayers(BinaryReader r, TacticalPlayerSlot[]? prior)
    {
        var resetByte = r.ReadByte();
        if (resetByte > 1 || resetByte == 0 && prior is null) throw Invalid("Missing player baseline.");
        var reset = resetByte == 1;
        var count = reset ? Count(r, 64) : prior!.Length;
        var result = new TacticalPlayerSlot[count];
        for (var i = 0; i < count; i++)
        {
            var p = reset ? null : prior![i];
            var slot = reset ? Count(r, 63) : p!.Slot;
            var id = reset ? ArchiveBinary.ReadVarInt64(r) : p!.PlayerId;
            var mask = r.ReadByte();
            if ((mask & ~7) != 0 || reset && mask != 7) throw Invalid("Invalid player mask.");
            result[i] = new(slot, id, (mask & 1) != 0 ? ReadSlot(r) : p!.RosterSlot,
                (mask & 2) != 0 ? ReadSlot(r) : p!.TacticSlot,
                (mask & 4) != 0 ? ReadKey(r) : p!.OppositionPositionKey);
        }
        return result;
    }

    private static int? ReadSlot(BinaryReader r) { var n = ArchiveBinary.ReadVarUInt64(r); if (n > 256) throw Invalid("Invalid signed slot."); return n == 0 ? null : (int)n - 129; }
    private static uint? ReadKey(BinaryReader r) { var n = ArchiveBinary.ReadVarUInt64(r); return n == 0 ? null : checked((uint)(n - 1)); }
    private static uint UInt(BinaryReader r) => checked((uint)ArchiveBinary.ReadVarUInt64(r));
    private static int Count(BinaryReader r, int max) { var n = ArchiveBinary.ReadVarUInt64(r); if (n > (ulong)max) throw Invalid("Tactical collection exceeds its limit."); return (int)n; }
    private static void U(BinaryWriter w, ulong n) => ArchiveBinary.WriteVarUInt64(w, n);
    private static void I(BinaryWriter w, long n) => ArchiveBinary.WriteVarInt64(w, n);
    private static void WriteHex(BinaryWriter w, string value) => w.Write(Convert.ToUInt64(value, 16));
    private static string ReadHex(BinaryReader r) => r.ReadUInt64().ToString("X16");
    private static void WriteBytes(BinaryWriter w, byte[]? values) { U(w, values is null ? 0 : (ulong)values.Length + 1); if (values is not null) w.Write(values); }
    private static byte[]? ReadBytes(BinaryReader r, int max)
    {
        var n = Count(r, max + 1); if (n == 0) return null;
        var bytes = r.ReadBytes(n - 1); if (bytes.Length != n - 1) throw new EndOfStreamException(); return bytes;
    }
    private static void WriteArray<T>(BinaryWriter w, T[]? values, Action<T> write) { U(w, values is null ? 0 : (ulong)values.Length + 1); if (values is not null) foreach (var value in values) write(value); }
    private static T[]? ReadArray<T>(BinaryReader r, int max, Func<T> read)
    {
        var n = Count(r, max + 1); if (n == 0) return null;
        var values = new T[n - 1]; for (var i = 0; i < values.Length; i++) values[i] = read(); return values;
    }
    private static T Required<T>(T? value) where T : class => value ?? throw Invalid("Required tactical array is null.");
    private static bool Equal<T>(T[]? a, T[]? b) => ReferenceEquals(a, b) || a is not null && b is not null && a.SequenceEqual(b);
    private static ArchiveFormatException Invalid(string message) => new("invalid_tactics", message);

    private sealed class Definitions<T>(Func<T, T, bool> equal, Func<T, int> hash) where T : class
    {
        private readonly Dictionary<T, int> _ids = new(new Comparer(equal, hash));
        private readonly List<T> _values = new();
        public void Write(BinaryWriter w, T? value, Action<T> write)
        {
            if (value is null) { U(w, 0); return; }
            if (_ids.TryGetValue(value, out var id)) { U(w, (ulong)(2 + id * 2)); return; }
            if (_ids.Count == MaxDefinitions) { U(w, 1); write(value); return; }
            id = _ids.Count; _ids.Add(value, id); U(w, (ulong)(3 + id * 2)); write(value);
        }
        public T? Read(BinaryReader r, Func<T> read)
        {
            var token = ArchiveBinary.ReadVarUInt64(r);
            if (token == 0) return null;
            if (token == 1) return read();
            var id = (token - 2) / 2;
            if ((token & 1) == 0) { if (id >= (ulong)_values.Count) throw Invalid("Invalid tactical dictionary reference."); return _values[(int)id]; }
            if (id != (ulong)_values.Count || _values.Count == MaxDefinitions) throw Invalid("Invalid tactical definition.");
            var value = read(); _values.Add(value); return value;
        }
        private sealed class Comparer(Func<T, T, bool> equals, Func<T, int> getHash) : IEqualityComparer<T>
        {
            public bool Equals(T? a, T? b) => ReferenceEquals(a, b) || a is not null && b is not null && equals(a, b);
            public int GetHashCode(T value) => getHash(value);
        }
    }

    private static bool PositionEqual(TacticalPosition a, TacticalPosition b) => a.PositionMask == b.PositionMask && a.Auxiliary == b.Auxiliary && a.Flags == b.Flags && a.RoleDuty == b.RoleDuty && Equal(a.Instructions, b.Instructions) && Equal(a.Applicability, b.Applicability);
    private static void HashItems<T>(ref HashCode hash, T[]? values) { hash.Add(values?.Length ?? -1); if (values is not null) foreach (var v in values) hash.Add(v); }
    private static int PositionHash(TacticalPosition p)
    {
        var h = new HashCode(); h.Add(p.PositionMask); h.Add(p.Auxiliary); h.Add(p.Flags); h.Add(p.RoleDuty);
        HashItems(ref h, p.Instructions); HashItems(ref h, p.Applicability); return h.ToHashCode();
    }
    private static int ConfigurationHash(TacticalConfiguration c)
    {
        var h = new HashCode(); h.Add(c.StyleKey); h.Add(c.AdditionalState); h.Add(c.Mentality);
        HashItems(ref h, c.TeamInstructions); HashItems(ref h, c.NameUtf8); HashItems(ref h, c.PhaseSlotMapping);
        foreach (var p in c.InPossession.Concat(c.OutOfPossession)) h.Add(PositionHash(p));
        foreach (var values in new[] { c.InPossessionOverrides, c.OutOfPossessionOverrides })
        { h.Add(values?.Length ?? -1); if (values is not null) foreach (var v in values) { h.Add(v.PersonKey); h.Add(v.Positions.Length); foreach (var p in v.Positions) h.Add(PositionHash(p)); } }
        return h.ToHashCode();
    }
}
