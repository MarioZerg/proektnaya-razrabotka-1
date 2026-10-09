using System;
using System.Drawing;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace YarplanLider
{
    /// <summary>
    /// Полноэкранное окно телевизора: внутри только страница живого цеха.
    /// Сайт после выкладки подхватывается сам: кэш выключен, служебный кэш
    /// браузера снимается, раз в минуту сверяем сборку на yarplan.ru.
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
        private readonly Timer _updateCheck;
        private KeyboardLock _keys;
        private bool _pinOpen;
        private int _retryMs = 3000;
        private string _siteStamp;
        private int _checking;

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

            _updateCheck = new Timer { Interval = 60000 };
            _updateCheck.Tick += (s, e) => System.Threading.ThreadPool.QueueUserWorkItem(CheckSiteUpdate);

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
                var opts = new CoreWebView2EnvironmentOptions();
                opts.AdditionalBrowserArguments = "--disk-cache-size=1";
                var env = await CoreWebView2Environment.CreateAsync(null, KioskConfig.UserDataFolder(), opts);
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

            try
            {
                await _web.CoreWebView2.CallDevToolsProtocolMethodAsync(
                    "Network.setCacheDisabled", "{\"cacheDisabled\":true}");
                await _web.CoreWebView2.CallDevToolsProtocolMethodAsync(
                    "Network.clearBrowserCache", "{}");
            }
            catch
            {
            }

            await _web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(KioskBootScript());

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
                    if (!_updateCheck.Enabled) _updateCheck.Start();
                    System.Threading.ThreadPool.QueueUserWorkItem(CheckSiteUpdate);
                    try { _web.CoreWebView2.ExecuteScriptAsync(KioskScrollScript()); }
                    catch { }
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
                _web.CoreWebView2.Navigate(HomeUrl());
                await Task.CompletedTask;
            }
            catch
            {
                _status.Text = "Нет сети. Пробуем снова…";
                ScheduleRetry();
            }
        }

        private void CheckSiteUpdate(object state)
        {
            if (System.Threading.Interlocked.Exchange(ref _checking, 1) == 1) return;
            try
            {
                var url = _config.Url;
                var sep = url.IndexOf('?') >= 0 ? "&" : "?";
                using (var wc = new WebClient())
                {
                    wc.Headers[HttpRequestHeader.CacheControl] = "no-cache";
                    wc.Headers[HttpRequestHeader.Pragma] = "no-cache";
                    var html = wc.DownloadString(url + sep + "_=" + DateTime.UtcNow.Ticks);
                    var stamp = ExtractStamp(html);
                    if (stamp.Length == 0) return;
                    if (_siteStamp == null)
                    {
                        _siteStamp = stamp;
                        return;
                    }
                    if (stamp == _siteStamp) return;
                    _siteStamp = stamp;
                    if (IsHandleCreated)
                        BeginInvoke(new Action(ReloadFresh));
                }
            }
            catch
            {
            }
            finally
            {
                System.Threading.Interlocked.Exchange(ref _checking, 0);
            }
        }

        private static string ExtractStamp(string html)
        {
            if (string.IsNullOrEmpty(html)) return "";
            const string key = "/assets/";
            var from = 0;
            var last = "";
            while (true)
            {
                var i = html.IndexOf(key, from, StringComparison.OrdinalIgnoreCase);
                if (i < 0) break;
                var j = html.IndexOf(".js", i, StringComparison.OrdinalIgnoreCase);
                if (j > i && j - i < 90)
                    last = html.Substring(i, (j + 3) - i);
                from = i + key.Length;
            }
            return last;
        }

        private async void ReloadFresh()
        {
            try
            {
                if (_web.CoreWebView2 == null) return;
                await _web.CoreWebView2.CallDevToolsProtocolMethodAsync(
                    "Network.clearBrowserCache", "{}");
                await _web.CoreWebView2.CallDevToolsProtocolMethodAsync(
                    "Page.reload", "{\"ignoreCache\":true}");
            }
            catch
            {
                try { if (_web.CoreWebView2 != null) _web.CoreWebView2.Navigate(HomeUrl()); }
                catch { }
            }
        }

        private string HomeUrl()
        {
            var url = _config.Url;
            var sep = url.IndexOf('?') >= 0 ? "&" : "?";
            return url + sep + "kiosk=" + DateTime.UtcNow.Ticks;
        }

        /// <summary>
        /// WebView2 часто игнорирует scrollTop. Если страница сама не двигает
        /// ленту (__tvPanOk), киоск сдвигает её через translate3d.
        /// </summary>
        private static string KioskBootScript()
        {
            return
                "(function(){try{" +
                "if(navigator.serviceWorker){" +
                "navigator.serviceWorker.register=function(){return Promise.reject();};" +
                "navigator.serviceWorker.getRegistrations().then(function(rs){" +
                "rs.forEach(function(r){r.unregister();});});}" +
                "if(window.caches){caches.keys().then(function(keys){" +
                "keys.forEach(function(k){caches.delete(k);});});}" +
                "}catch(e){}})();" +
                KioskScrollScript();
        }

        private static string KioskScrollScript()
        {
            return
                "(function(){if(window.__yarplanKioskScroll)return;window.__yarplanKioskScroll=1;" +
                "var y=0,dir=1,pause=0;" +
                "function box(){" +
                "var v=document.querySelector('[data-tv-scroll]');" +
                "if(v){var c=v.querySelector('[data-tv-pan]')||v.firstElementChild;if(c)return{v:v,c:c};}" +
                "var nodes=document.querySelectorAll('div'),best=null,score=0;" +
                "for(var i=0;i<nodes.length;i++){var n=nodes[i],ch=n.firstElementChild;if(!ch)continue;" +
                "if(n.clientHeight<260)continue;" +
                "var extra=Math.max(ch.offsetHeight,n.scrollHeight)-n.clientHeight;" +
                "if(extra>score&&extra>40){best={v:n,c:ch};score=extra;}}" +
                "return best;}" +
                "setInterval(function(){" +
                "if(window.__tvPanOk)return;" +
                "var h=document.querySelector('h1');" +
                "if(h&&h.textContent&&h.textContent.indexOf('Путь')>=0)return;" +
                "var b=box();if(!b||!b.c||!b.v)return;" +
                "var floor=document.querySelector('[data-tv-floor]');" +
                "var cap=0;" +
                "if(floor){var u=0,ch=floor.children;for(var i=0;i<ch.length;i++){if(ch[i]===b.v||ch[i].contains(b.v))break;u+=ch[i].offsetHeight;}cap=floor.clientHeight-u;}" +
                "if(cap<16){var p=b.v.parentElement;if(p)cap=p.clientHeight;}" +
                "if(cap>16){b.v.style.height=cap+'px';b.v.style.maxHeight=cap+'px';}" +
                "b.v.style.overflow='hidden';" +
                "var max=Math.max(b.c.offsetHeight,b.c.scrollHeight)-b.v.clientHeight;if(max<8)return;" +
                "if(Date.now()<pause)return;" +
                "y+=1.6*dir;if(y>=max){y=max;dir=-1;pause=Date.now()+1600;}" +
                "if(y<=0){y=0;dir=1;pause=Date.now()+1600;}" +
                "b.c.style.willChange='transform';" +
                "b.c.style.transform='translate3d(0,'+(-Math.round(y))+'px,0)';" +
                "},50);})();";
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
            _updateCheck.Stop();
            if (_keys != null) _keys.Dispose();
            SetThreadExecutionState(EsContinuous);
            Cursor.Show();
        }

        [DllImport("kernel32.dll")]
        private static extern uint SetThreadExecutionState(uint esFlags);
    }
}
