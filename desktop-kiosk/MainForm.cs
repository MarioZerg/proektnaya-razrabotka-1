using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace YarplanLider
{
    /// <summary>
    /// Полноэкранное окно телевизора: внутри только страница живого цеха.
    /// </summary>
    internal sealed class MainForm : Form
    {
        private const uint EsContinuous = 0x80000000;
        private const uint EsSystemRequired = 0x00000001;
        private const uint EsDisplayRequired = 0x00000002;

        private readonly KioskConfig _config;
        private readonly WebView2 _web;
        private readonly Label _status;
        private readonly Timer _retry;
        private readonly Timer _hideCursor;
        private KeyboardLock _keys;
        private bool _pinOpen;
        private int _retryMs = 3000;

        public MainForm()
        {
            _config = KioskConfig.Load();

            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            Bounds = Screen.PrimaryScreen.Bounds;
            TopMost = true;
            ShowInTaskbar = false;
            KeyPreview = true;
            BackColor = Color.Black;
            Text = "Ярплан — Живой цех";

            _status = new Label
            {
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleCenter,
                ForeColor = Color.White,
                BackColor = Color.Black,
                Font = new Font("Segoe UI", 28f),
                Text = "Подключаемся к живому цеху…",
            };
            _web = new WebView2 { Dock = DockStyle.Fill, Visible = false };
            Controls.Add(_web);
            Controls.Add(_status);

            _retry = new Timer { Interval = _retryMs };
            _retry.Tick += async (s, e) =>
            {
                _retry.Stop();
                await NavigateHome();
            };

            _hideCursor = new Timer { Interval = 2500 };
            _hideCursor.Tick += (s, e) =>
            {
                _hideCursor.Stop();
                Cursor.Hide();
            };
            MouseMove += (s, e) =>
            {
                Cursor.Show();
                _hideCursor.Stop();
                _hideCursor.Start();
            };

            Load += async (s, e) => await StartAsync();
            FormClosing += (s, e) =>
            {
                if (e.CloseReason == CloseReason.UserClosing && !_pinOpen)
                {
                    e.Cancel = true;
                    AskExit();
                }
            };
            FormClosed += (s, e) => Cleanup();
        }

        private async Task StartAsync()
        {
            SetThreadExecutionState(EsContinuous | EsSystemRequired | EsDisplayRequired);
            _keys = new KeyboardLock();
            _keys.ExitChord += () => BeginInvoke(new Action(AskExit));
            _hideCursor.Start();

            try
            {
                var env = await CoreWebView2Environment.CreateAsync(null, KioskConfig.UserDataFolder());
                await _web.EnsureCoreWebView2Async(env);
            }
            catch (Exception ex)
            {
                _status.Text = "Нужен WebView2 Runtime.\n" + ex.Message + "\n\nCtrl+Shift+Q — выход";
                return;
            }

            var settings = _web.CoreWebView2.Settings;
            settings.AreDefaultContextMenusEnabled = false;
            settings.AreDevToolsEnabled = false;
            settings.IsStatusBarEnabled = false;
            settings.AreBrowserAcceleratorKeysEnabled = false;
            settings.IsZoomControlEnabled = false;
            settings.IsSwipeNavigationEnabled = false;
            settings.AreDefaultScriptDialogsEnabled = false;

            _web.CoreWebView2.NewWindowRequested += (s, e) => { e.Handled = true; };
            _web.CoreWebView2.NavigationStarting += (s, e) =>
            {
                Uri uri;
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out uri) || !_config.IsAllowed(uri))
                    e.Cancel = true;
            };
            _web.CoreWebView2.ProcessFailed += (s, e) =>
            {
                BeginInvoke(new Action(() =>
                {
                    _web.Visible = false;
                    _status.Text = "Перезапускаем экран цеха…";
                    ScheduleRetry();
                }));
            };
            _web.CoreWebView2.NavigationCompleted += (s, e) =>
            {
                if (e.IsSuccess)
                {
                    _retryMs = 3000;
                    _web.Visible = true;
                    _status.Visible = false;
                }
                else
                {
                    _web.Visible = false;
                    _status.Visible = true;
                    _status.Text = "Нет сети. Пробуем снова…";
                    ScheduleRetry();
                }
            };

            await NavigateHome();
        }

        private async Task NavigateHome()
        {
            try
            {
                if (_web.CoreWebView2 == null)
                {
                    ScheduleRetry();
                    return;
                }
                _status.Visible = true;
                _status.Text = "Подключаемся к живому цеху…";
                _web.CoreWebView2.Navigate(_config.Url);
                await Task.CompletedTask;
            }
            catch
            {
                _status.Text = "Нет сети. Пробуем снова…";
                ScheduleRetry();
            }
        }

        private void ScheduleRetry()
        {
            _retry.Interval = _retryMs;
            _retryMs = Math.Min(_retryMs * 2, 30000);
            _retry.Stop();
            _retry.Start();
        }

        private void AskExit()
        {
            if (_pinOpen) return;
            _pinOpen = true;
            using (var dlg = new PinForm(_config.Pin))
            {
                if (dlg.ShowDialog(this) == DialogResult.OK && dlg.Accepted)
                {
                    _pinOpen = true;
                    Application.Exit();
                    return;
                }
            }
            _pinOpen = false;
        }

        private void Cleanup()
        {
            _retry.Stop();
            _hideCursor.Stop();
            _keys?.Dispose();
            SetThreadExecutionState(EsContinuous);
            Cursor.Show();
        }

        [DllImport("kernel32.dll")]
        private static extern uint SetThreadExecutionState(uint esFlags);
    }
}
