// Compile-time contract only. Never distribute this assembly with the plugin.
// At runtime BepInEx supplies the generated game interop base types/constructor.
namespace UnityEngine
{
    public class Object : Il2CppInterop.Runtime.InteropTypes.Il2CppObjectBase
    {
        public Object(System.IntPtr pointer) : base(pointer) { }
        public static void Destroy(Object obj) { }
    }
    public class Component : Object
    {
        public Component(System.IntPtr pointer) : base(pointer) { }
    }
    public class Behaviour : Component
    {
        public Behaviour(System.IntPtr pointer) : base(pointer) { }
    }
    public class MonoBehaviour : Behaviour
    {
        public MonoBehaviour(System.IntPtr pointer) : base(pointer) { }
    }
}
