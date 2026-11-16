using System.Runtime.InteropServices;

namespace ClickerFree.Worker;

public static class Keys
{
    const uint InputKeyboard = 1;
    const uint KeyEventFKeyUp = 2;
    const ushort VkLeft = 0x25;
    const ushort VkRight = 0x27;

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    struct InputUnion
    {
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT
    {
        public uint type;
        public InputUnion U;
    }

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    public static void Press(string action)
    {
        var vk = action switch
        {
            "previous" => VkLeft,
            "next" => VkRight,
            _ => throw new ArgumentException($"unknown action: {action}"),
        };
        var inputs = new INPUT[2];
        inputs[0].type = InputKeyboard;
        inputs[0].U.ki.wVk = vk;
        inputs[1].type = InputKeyboard;
        inputs[1].U.ki.wVk = vk;
        inputs[1].U.ki.dwFlags = KeyEventFKeyUp;
        if (SendInput(2, inputs, Marshal.SizeOf<INPUT>()) != 2)
        {
            throw new InvalidOperationException($"SendInput failed: {Marshal.GetLastWin32Error()}");
        }
    }
}
