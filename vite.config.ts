import {defineConfig} from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import {componentTagger} from "pp-tagger";

// DDoS Guard требует двусторонний app-level keepalive чаще 30s.
// Сервер: text-frame {type:'ping'} каждые 5-9s (рандом — чтобы DDoS Guard
// не триггерился на одинаковые интервалы; Vite-клиент игнорирует, case "ping": break;).
// Клиент: server.hmr.timeout = 7000 ниже понижает pingInterval @vite/client до 7s.
const hmrKeepalive = {
    name: 'hmr-ws-keepalive',
    configureServer(server: any) {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const tick = () => {
            server.ws?.send({type: 'ping'});
            timer = setTimeout(tick, 5000 + Math.floor(Math.random() * 4000));
        };
        timer = setTimeout(tick, 5000 + Math.floor(Math.random() * 4000));
        server.httpServer?.on('close', () => {
            if (timer) clearTimeout(timer);
        });
    },
};

// https://vitejs.dev/config/
export default defineConfig(({mode}) => ({
    plugins: [
        react(),
        hmrKeepalive,
        mode === 'development' &&
        componentTagger(),
    ].filter(Boolean),
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    build: {
        rollupOptions: {
            output: {
                // Раскладываем внешние библиотеки по отдельным файлам, чтобы при входе
                // не качалось лишнее. Библиотеки печати (штрихкоды, QR, PDF) нужны только
                // на страницах печати — пусть грузятся там, а не на экране входа.
                // ВАЖНО: библиотеки печати (jspdf, html2canvas, qrcode, jsbarcode) здесь
                // НЕ перечисляем. Если задать им общий файл, сборщик считает его нужным
                // сразу и подключает к странице входа — тяжёлый PDF качался бы всем.
                // Они подгружаются сами в момент печати (динамический import).
                manualChunks(id: string) {
                    if (!id.includes('node_modules')) return;
                    if (id.includes('react-router')) return 'router';
                    if (id.includes('@radix-ui')) return 'ui';
                    if (id.includes('react-dom') || id.includes('/react/')) return 'react';
                },
            },
        },
    },
    server: {
        host: '0.0.0.0',
        port: 5173,
        allowedHosts: true,
        hmr: {
            overlay: false, // Disables the error overlay if you only want console errors
            timeout: 7000, // pingInterval @vite/client — нужен <30s для DDoS Guard
        }
    },
}));
