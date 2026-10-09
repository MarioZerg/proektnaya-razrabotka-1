using System;
using System.Collections.Generic;
using System.IO;

namespace YarplanLider
{
    /// <summary>
    /// Настройки рядом с exe: адрес телевизора, разрешённый хост и PIN выхода.
    /// </summary>
    internal sealed class KioskConfig
    {
        public string Url { get; private set; }
        public string Host { get; private set; }
        public string Pin { get; private set; }

        public KioskConfig()
        {
            Url = "https://yarplan.ru/lider";
            Host = "yarplan.ru";
            Pin = "2580";
        }

        public static KioskConfig Load()
        {
            var cfg = new KioskConfig();
            var path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "kiosk.ini");
            if (!File.Exists(path)) return cfg;

            var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var raw in File.ReadAllLines(path))
            {
                var line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("#") || line.StartsWith(";")) continue;
                var eq = line.IndexOf('=');
                if (eq <= 0) continue;
                map[line.Substring(0, eq).Trim()] = line.Substring(eq + 1).Trim();
            }

            string url, host, pin;
            if (map.TryGetValue("url", out url) && !string.IsNullOrWhiteSpace(url)) cfg.Url = url;
            if (map.TryGetValue("host", out host) && !string.IsNullOrWhiteSpace(host)) cfg.Host = host;
            if (map.TryGetValue("pin", out pin) && !string.IsNullOrWhiteSpace(pin)) cfg.Pin = pin;
            return cfg;
        }

        public bool IsAllowed(Uri uri)
        {
            if (uri == null) return false;
            if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) return false;
            var host = uri.Host.TrimEnd('.');
            return host.Equals(Host, StringComparison.OrdinalIgnoreCase)
                || host.EndsWith("." + Host, StringComparison.OrdinalIgnoreCase);
        }

        public static string UserDataFolder()
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "YarplanLider",
                "WebView2");
            Directory.CreateDirectory(dir);
            return dir;
        }
    }
}
