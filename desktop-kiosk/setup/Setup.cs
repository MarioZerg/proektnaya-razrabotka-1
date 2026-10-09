using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;
using Microsoft.Win32;

namespace YarplanLiderSetup
{
    /// <summary>
    /// Установщик киоска «Живой цех»: папка в AppData, ярлык на рабочем столе,
    /// автозапуск при входе в Windows, WebView2 при необходимости.
    /// </summary>
    internal static class Program
    {
        public const string AppFolderName = "YarplanLider";
        public const string ExeName = "YarplanLider.exe";
        public const string ShortcutName = "Живой цех.lnk";
        public const string LegacyStartupName = "YarplanLider.lnk";
        public const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\YarplanLider";

        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            var uninstall = false;
            for (var i = 0; i < args.Length; i++)
            {
                var a = args[i].Trim();
                if (string.Equals(a, "/uninstall", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(a, "/remove", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(a, "uninstall", StringComparison.OrdinalIgnoreCase))
                    uninstall = true;
            }

            if (uninstall)
            {
                try
                {
                    Installer.Uninstall();
                    MessageBox.Show("Живой цех удалён с этого компьютера.", "Живой цех",
                        MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
                catch (Exception ex)
                {
                    MessageBox.Show(ex.Message, "Не удалось удалить", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                return;
            }

            Application.Run(new SetupForm());
        }

        public static string InstallDir()
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                AppFolderName);
        }
    }

    internal sealed class SetupForm : Form
    {
        private readonly Label _status;
        private readonly Button _install;
        private readonly CheckBox _runNow;
        private bool _busy;

        public SetupForm()
        {
            Text = "Установка — Живой цех";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterScreen;
            MaximizeBox = false;
            MinimizeBox = false;
            ClientSize = new Size(460, 280);
            Font = new Font("Segoe UI", 11f);
            BackColor = Color.FromArgb(28, 28, 30);
            ForeColor = Color.White;

            var title = new Label
            {
                AutoSize = false,
                Location = new Point(24, 20),
                Size = new Size(412, 36),
                Font = new Font("Segoe UI", 16f, FontStyle.Bold),
                ForeColor = Color.FromArgb(255, 102, 55),
                Text = "Живой цех на телевизор",
            };
            var body = new Label
            {
                AutoSize = false,
                Location = new Point(24, 64),
                Size = new Size(412, 72),
                ForeColor = Color.FromArgb(220, 220, 220),
                Text = "После установки на рабочем столе появится ярлык, а при включении ПК экран цеха откроется сам. Страница: yarplan.ru/lider",
            };
            _runNow = new CheckBox
            {
                Location = new Point(24, 148),
                Size = new Size(412, 28),
                ForeColor = Color.White,
                Checked = true,
                Text = "Запустить сразу после установки",
            };
            _status = new Label
            {
                AutoSize = false,
                Location = new Point(24, 184),
                Size = new Size(412, 28),
                ForeColor = Color.FromArgb(180, 180, 180),
                Text = "Windows 10 · установка в папку пользователя",
            };
            _install = new Button
            {
                Location = new Point(24, 220),
                Size = new Size(200, 36),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(255, 102, 55),
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 11f, FontStyle.Bold),
                Text = "Установить",
            };
            _install.FlatAppearance.BorderSize = 0;
            _install.Click += (s, e) => RunInstall();

            var close = new Button
            {
                Location = new Point(236, 220),
                Size = new Size(120, 36),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(50, 50, 54),
                ForeColor = Color.White,
                Text = "Закрыть",
            };
            close.FlatAppearance.BorderSize = 0;
            close.Click += (s, e) =>
            {
                if (!_busy) Close();
            };

            Controls.Add(title);
            Controls.Add(body);
            Controls.Add(_runNow);
            Controls.Add(_status);
            Controls.Add(_install);
            Controls.Add(close);
        }

        private void RunInstall()
        {
            if (_busy) return;
            _busy = true;
            _install.Enabled = false;
            try
            {
                _status.Text = "Копируем программу…";
                Application.DoEvents();
                Installer.Install(new Progress(this, _status));
                _status.Text = "Готово. Ярлык на рабочем столе, автозапуск включён.";
                if (_runNow.Checked)
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = Path.Combine(Program.InstallDir(), Program.ExeName),
                        WorkingDirectory = Program.InstallDir(),
                    });
                }
                MessageBox.Show(this,
                    "Установлено.\n\nЯрлык «Живой цех» на рабочем столе.\nПри включении компьютера откроется само.",
                    "Живой цех", MessageBoxButtons.OK, MessageBoxIcon.Information);
                Close();
            }
            catch (Exception ex)
            {
                _status.Text = "Ошибка установки";
                MessageBox.Show(this, ex.Message, "Не удалось установить",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                _install.Enabled = true;
                _busy = false;
            }
        }

        private sealed class Progress : Installer.IStatus
        {
            private readonly SetupForm _form;
            private readonly Label _label;
            public Progress(SetupForm form, Label label)
            {
                _form = form;
                _label = label;
            }
            public void Set(string text)
            {
                _form._status.Text = text;
                Application.DoEvents();
            }
        }
    }

    internal static class Installer
    {
        public interface IStatus
        {
            void Set(string text);
        }

        public static void Install(IStatus status)
        {
            var dir = Program.InstallDir();
            Directory.CreateDirectory(dir);

            status.Set("Останавливаем старую версию…");
            StopApp();

            status.Set("Распаковываем программу…");
            ExtractPayload(dir);

            var setupCopy = Path.Combine(dir, "YarplanLiderSetup.exe");
            try
            {
                File.Copy(Application.ExecutablePath, setupCopy, true);
            }
            catch
            {
            }

            status.Set("Проверяем WebView2…");
            EnsureWebView2(status);

            status.Set("Ярлык на рабочий стол и автозапуск…");
            var exe = Path.Combine(dir, Program.ExeName);
            CreateShortcut(DesktopPath(), exe, dir);
            CreateShortcut(StartupPath(), exe, dir);
            RemoveLegacyStartup();

            TryKeepDisplayOn();
            WriteUninstallKey(dir, setupCopy);

            status.Set("Готово");
        }

        public static void Uninstall()
        {
            StopApp();
            DeleteFile(DesktopPath());
            DeleteFile(StartupPath());
            RemoveLegacyStartup();
            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(Program.UninstallKey, false);
            }
            catch
            {
            }

            var dir = Program.InstallDir();
            if (!Directory.Exists(dir)) return;

            try
            {
                Directory.Delete(dir, true);
            }
            catch
            {
                var cmd = "/c timeout /t 2 /nobreak >nul & rmdir /s /q \"" + dir + "\"";
                Process.Start(new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = cmd,
                    CreateNoWindow = true,
                    UseShellExecute = false,
                });
            }
        }

        private static void ExtractPayload(string dir)
        {
            var asm = Assembly.GetExecutingAssembly();
            using (var src = asm.GetManifestResourceStream("payload.zip"))
            {
                if (src == null)
                    throw new InvalidOperationException("В установщике нет архива программы. Соберите через build-setup.ps1.");
                var zipPath = Path.Combine(Path.GetTempPath(), "yarplan-lider-payload.zip");
                using (var dst = File.Create(zipPath))
                    src.CopyTo(dst);
                using (var zip = ZipFile.OpenRead(zipPath))
                {
                    foreach (var entry in zip.Entries)
                    {
                        if (string.IsNullOrEmpty(entry.Name)) continue;
                        if (string.Equals(entry.Name, "kiosk.ini", StringComparison.OrdinalIgnoreCase)
                            && File.Exists(Path.Combine(dir, "kiosk.ini")))
                            continue;
                        var dest = Path.Combine(dir, entry.Name);
                        entry.ExtractToFile(dest, true);
                    }
                }
                try { File.Delete(zipPath); } catch { }
            }

            if (!File.Exists(Path.Combine(dir, Program.ExeName)))
                throw new InvalidOperationException("После распаковки не найден YarplanLider.exe.");
        }

        private static void EnsureWebView2(IStatus status)
        {
            if (HasWebView2()) return;
            status.Set("Ставим WebView2 Runtime…");
            var boot = Path.Combine(Path.GetTempPath(), "MicrosoftEdgeWebview2Setup.exe");
            using (var wc = new System.Net.WebClient())
            {
                wc.DownloadFile("https://go.microsoft.com/fwlink/p/?LinkId=2124703", boot);
            }
            var p = Process.Start(new ProcessStartInfo
            {
                FileName = boot,
                Arguments = "/silent /install",
                UseShellExecute = true,
            });
            if (p != null) p.WaitForExit();
            if (!HasWebView2())
                throw new InvalidOperationException(
                    "Не удалось поставить WebView2. Запустите установщик от имени администратора или поставьте «WebView2 Runtime» с сайта Microsoft.");
        }

        private static bool HasWebView2()
        {
            const string id = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
            var paths = new[]
            {
                @"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\" + id,
                @"SOFTWARE\Microsoft\EdgeUpdate\Clients\" + id,
            };
            foreach (var path in paths)
            {
                using (var k = Registry.LocalMachine.OpenSubKey(path))
                {
                    if (k != null) return true;
                }
            }
            return false;
        }

        private static void CreateShortcut(string lnk, string exe, string workDir)
        {
            var t = Type.GetTypeFromProgID("WScript.Shell");
            if (t == null) throw new InvalidOperationException("Нет WScript.Shell — ярлык не создать.");
            var shell = Activator.CreateInstance(t);
            var sc = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnk });
            var st = sc.GetType();
            st.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { exe });
            st.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { workDir });
            st.InvokeMember("WindowStyle", BindingFlags.SetProperty, null, sc, new object[] { 1 });
            st.InvokeMember("Description", BindingFlags.SetProperty, null, sc, new object[] { "Живой цех на телевизоре" });
            st.InvokeMember("IconLocation", BindingFlags.SetProperty, null, sc, new object[] { exe + ",0" });
            st.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
        }

        private static void WriteUninstallKey(string dir, string setupCopy)
        {
            using (var k = Registry.CurrentUser.CreateSubKey(Program.UninstallKey))
            {
                if (k == null) return;
                k.SetValue("DisplayName", "Ярплан — Живой цех");
                k.SetValue("Publisher", "МЕГАТЮЛЬ");
                k.SetValue("InstallLocation", dir);
                k.SetValue("DisplayIcon", Path.Combine(dir, Program.ExeName));
                k.SetValue("UninstallString", "\"" + setupCopy + "\" /uninstall");
                k.SetValue("DisplayVersion", "1.1.1");
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }

        private static void TryKeepDisplayOn()
        {
            try
            {
                Process.Start(new ProcessStartInfo("powercfg", "/change monitor-timeout-ac 0") { CreateNoWindow = true, UseShellExecute = false }).WaitForExit();
                Process.Start(new ProcessStartInfo("powercfg", "/change standby-timeout-ac 0") { CreateNoWindow = true, UseShellExecute = false }).WaitForExit();
                Process.Start(new ProcessStartInfo("powercfg", "/change monitor-timeout-dc 0") { CreateNoWindow = true, UseShellExecute = false }).WaitForExit();
                Process.Start(new ProcessStartInfo("powercfg", "/change standby-timeout-dc 0") { CreateNoWindow = true, UseShellExecute = false }).WaitForExit();
            }
            catch
            {
            }
        }

        private static void StopApp()
        {
            foreach (var p in Process.GetProcessesByName("YarplanLider"))
            {
                try { p.Kill(); p.WaitForExit(4000); } catch { }
            }
        }

        private static string DesktopPath()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Program.ShortcutName);
        }

        private static string StartupPath()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), Program.ShortcutName);
        }

        private static void RemoveLegacyStartup()
        {
            DeleteFile(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), Program.LegacyStartupName));
        }

        private static void DeleteFile(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); } catch { }
        }
    }
}
