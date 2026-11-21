using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using BepInEx;
using FMMatchLens.Plugin.Memory;

namespace FMMatchLens.Plugin.Diagnostics;

// Installation evidence must be available in release mode. Use Info/Warning,
// independent of the debug-only capture and per-frame diagnostics.
internal static class HookInstallDiagnostics
{
    private const string Unavailable = "<unavailable>";

    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryRegion
    {
        public nint BaseAddress;
        public nint AllocationBase;
        public uint AllocationProtect;
        public nuint RegionSize;
        public uint State;
        public uint Protect;
        public uint Type;
    }

    [DllImport("kernel32.dll")]
    private static extern nuint VirtualQuery(nint address, out MemoryRegion region, nuint size);

    public static void ValidateEntry(nint address)
    {
        if (MacNative.IsMacOS)
        {
            MacHookResolver.ValidateEntry(address);
            return;
        }

        const int length = 16;
        if (address == 0 || VirtualQuery(address, out var region, (nuint)Marshal.SizeOf<MemoryRegion>()) == 0)
            throw new InvalidOperationException("Hook entry is not mapped.");
        var offset = (ulong)address - (ulong)region.BaseAddress;
        var protection = region.Protect & 0xff;
        if (region.State != 0x1000 || (region.Protect & 0x100) != 0 ||
            protection is not (0x20 or 0x40 or 0x80) ||
            (ulong)region.RegionSize < length || offset > (ulong)region.RegionSize - length)
            throw new InvalidOperationException($"Hook entry is not readable executable memory: protect=0x{region.Protect:X}.");
        var bytes = new byte[length];
        Marshal.Copy(address, bytes, 0, length);
        var jump = bytes[0] == 0xE9 || (bytes[0] == 0xFF && bytes[1] == 0x25);
        PluginLogger.Info($"Hook entry: address=0x{address:X}, region=0x{region.BaseAddress:X}, " +
            $"protect=0x{region.Protect:X}, jump={jump}, bytes={Convert.ToHexString(bytes)}.");
    }

    public static void LogRuntime(nint moduleBase, nint target, bool knownBuild)
    {
        PluginLogger.Info($"Hook diagnostic: module_base=0x{moduleBase:X}, target=0x{target:X}, " +
            $"resolution={(knownBuild ? "known_hash" : "aob_fallback")}.");

        // Metadata is best effort: isolate sections, individual items, and fields
        // so an unavailable file cannot block installation or hide other evidence.
        LogMetadata("process", () =>
        {
            var path = ReadMetadata("process path", () => Environment.ProcessPath);
            var version = string.IsNullOrEmpty(path) || path == Unavailable ? Unavailable
                : ReadMetadata("EXE file version", () => FileVersionInfo.GetVersionInfo(path).FileVersion);
            PluginLogger.Info($"Hook runtime: process_path={path}, exe_file_version={version}.");
        });

        LogMetadata("managed assemblies", () =>
        {
            foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
                LogMetadata("assembly", () => LogAssembly(assembly));
        });

        LogMetadata("native modules", () =>
        {
            using var process = Process.GetCurrentProcess();
            foreach (ProcessModule module in process.Modules)
                LogMetadata("native module", () => LogNativeModule(module));
        });

        LogMetadata("detour provider", () =>
        {
            var config = Path.Combine(Paths.ConfigPath, "BepInEx.cfg");
            var provider = File.Exists(config) ? File.ReadLines(config)
                .FirstOrDefault(line => line.TrimStart().StartsWith("DetourProviderType", StringComparison.Ordinal)) : null;
            PluginLogger.Info($"Hook runtime: {provider ?? "DetourProviderType unset (runtime default)"}.");
        });
    }

    private static void LogAssembly(Assembly assembly)
    {
        var name = assembly.GetName();
        if (name.Name is null || !(name.Name.StartsWith("BepInEx.", StringComparison.Ordinal) ||
                                  name.Name.StartsWith("MonoMod.", StringComparison.Ordinal))) return;
        if (assembly.IsDynamic) return;

        var path = ReadMetadata($"assembly={name.Name} path", () => assembly.Location);
        PluginLogger.Info($"Hook runtime: assembly={name.Name}, version={name.Version}, " +
            $"path={(string.IsNullOrEmpty(path) ? "<in-memory>" : path)}.");
    }

    private static void LogNativeModule(ProcessModule module)
    {
        var name = module.ModuleName;
        if (name?.Contains("dobby", StringComparison.OrdinalIgnoreCase) != true) return;

        var path = ReadMetadata($"native={name} path", () => module.FileName);
        var version = ReadMetadata($"native={name} file version", () => module.FileVersionInfo.FileVersion);
        PluginLogger.Info($"Hook runtime: native={path}, version={version}.");
    }

    private static void LogMetadata(string description, Action log)
    {
        try { log(); }
        catch (Exception ex)
        {
            PluginLogger.Warning($"Hook runtime metadata unavailable ({description}): {ex}");
        }
    }

    private static string ReadMetadata(string description, Func<string?> read)
    {
        try { return read() ?? Unavailable; }
        catch (Exception ex)
        {
            PluginLogger.Warning($"Hook runtime metadata unavailable ({description}): {ex}");
            return Unavailable;
        }
    }

}
