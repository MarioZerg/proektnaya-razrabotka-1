using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace YarplanLider
{
    /// <summary>
    /// Глушит Win, Alt+Tab, Alt+F4 и диспетчер задач, чтобы с мини-ПК нельзя
    /// было случайно уйти с телевизора. Ctrl+Shift+Q остаётся — это выход по PIN.
    /// </summary>
    internal sealed class KeyboardLock : IDisposable
    {
        private const int WhKeyboardLl = 13;
        private const int WmKeydown = 0x0100;
        private const int WmSyskeydown = 0x0104;
        private const int VkTab = 0x09;
        private const int VkEscape = 0x1B;
        private const int VkF4 = 0x73;
        private const int VkLwin = 0x5B;
        private const int VkRwin = 0x5C;
        private const int VkQ = 0x51;

        public event Action ExitChord;

        private readonly LowLevelKeyboardProc _proc;
        private IntPtr _hook = IntPtr.Zero;

        public KeyboardLock()
        {
            _proc = Hook;
            using (var proc = Process.GetCurrentProcess())
            using (var module = proc.MainModule)
            {
                _hook = SetWindowsHookEx(WhKeyboardLl, _proc, GetModuleHandle(module.ModuleName), 0);
            }
        }

        public void Dispose()
        {
            if (_hook == IntPtr.Zero) return;
            UnhookWindowsHookEx(_hook);
            _hook = IntPtr.Zero;
        }

        private IntPtr Hook(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0 && (wParam == (IntPtr)WmKeydown || wParam == (IntPtr)WmSyskeydown))
            {
                var vk = Marshal.ReadInt32(lParam);
                var alt = (Control.ModifierKeys & Keys.Alt) == Keys.Alt;
                var ctrl = (Control.ModifierKeys & Keys.Control) == Keys.Control;
                var shift = (Control.ModifierKeys & Keys.Shift) == Keys.Shift;

                if (ctrl && shift && vk == VkQ)
                {
                    if (ExitChord != null) ExitChord();
                    return (IntPtr)1;
                }

                if (vk == VkLwin || vk == VkRwin) return (IntPtr)1;
                if (alt && vk == VkTab) return (IntPtr)1;
                if (alt && vk == VkEscape) return (IntPtr)1;
                if (alt && vk == VkF4) return (IntPtr)1;
                if (ctrl && vk == VkEscape) return (IntPtr)1;
                if (ctrl && shift && vk == VkEscape) return (IntPtr)1;
            }

            return CallNextHookEx(_hook, nCode, wParam, lParam);
        }

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll")]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);
    }
}
