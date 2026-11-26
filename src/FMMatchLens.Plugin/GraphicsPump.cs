extern alias unity;
using MonoBehaviour = unity::UnityEngine.MonoBehaviour;

namespace FMMatchLens.Plugin;

public sealed class GraphicsPump : MonoBehaviour
{
    internal static Action? Step;
    public GraphicsPump(nint pointer) : base(pointer) { }
    public void Update() => Step?.Invoke();
}
