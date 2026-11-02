using FMMatchLens.Contracts;
using FMMatchLens.Plugin.Sdk;
using Xunit;

namespace FMMatchLens.Sdk.Tests;

public class RegistryTests
{
    [Fact]
    public void LeaseCannotRevokeAReplacementAndDuplicateRegistrationFails()
    {
        using var first = new MatchDataHub();
        using var second = new MatchDataHub();
        Assert.Null(LensApi.TryGetProvider());
        using var lease1 = LensApi.RegisterProvider(first);
        Assert.Same(first, LensApi.TryGetProvider());
        Assert.Throws<InvalidOperationException>(() => LensApi.RegisterProvider(second));
        lease1.Dispose();
        using var lease2 = LensApi.RegisterProvider(second);
        lease1.Dispose();
        Assert.Same(second, LensApi.TryGetProvider());
        second.Dispose();
        Assert.False(second.TryGetLatestSnapshot(out _));
        lease2.Dispose();
        Assert.Null(LensApi.TryGetProvider());
    }

    [Fact]
    public void ContractsHaveIndependentIdentityAndOnlyFrameworkReferences()
    {
        var assembly = typeof(LensApi).Assembly;
        Assert.Equal(new Version(1, 0, 0, 0), assembly.GetName().Version);
        Assert.All(assembly.GetReferencedAssemblies(), name =>
            Assert.True(name.Name == "System" || name.Name!.StartsWith("System."), name.FullName));
        var methods = typeof(ILensMatchDataProvider).GetMethods().Where(m => !m.IsSpecialName).Select(m => m.Name).Order().ToArray();
        Assert.Equal(13, methods.Length);
        Assert.Contains("SubscribeMotion", methods);
        Assert.Contains("TryGetLatestSnapshot", methods);
        var types = assembly.GetExportedTypes().Select(t => t.Name).Order().ToArray();
        var coreTypes = new[] { "EventOperation", "ILensMatchDataProvider", "ILensSubscription", "LensApi", "LensCapabilities",
            "LensState", "LensStatus", "MatchEvent", "MatchLifecycleEvent", "MatchSnapshot", "MomentumPoint", "PlayerSnapshot",
            "Position3", "SubscriptionDiagnostics", "TeamSide", "TeamSnapshot" };
        Assert.All(coreTypes, type => Assert.Contains(type, types));
    }
}
