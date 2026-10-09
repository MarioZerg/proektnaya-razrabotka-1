import {defineConfig} from "vite";
import react from "@vitejs/plugin-react-swc";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import {pipeline} from "stream/promises";
import {componentTagger} from "pp-tagger";

// DDoS Guard требует двусторонний app-level keepalive чаще 30s.
// Сервер: text-frame {type:'ping'} каждые 5-9s (рандом — чтобы DDoS Guard
// не триггерился на одинаковые интервалы; Vite-клиент игнорирует, case "ping": break;).
// Клиент: server.hmr.timeout = 7000 ниже понижает pingInterval @vite/client до 7s.
/**
 * Vite/sirv считает *.gz заранее сжатым файлом и ставит Content-Encoding: gzip.
 * Tesseract качает eng.traineddata.gz как есть — браузер распаковывает дважды,
 * движок OCR падает. Отдаём gzip-байты без Content-Encoding и отдельно
 * распакованный eng.traineddata (gzip: false в createWorker).
 */
function unpackTraineddata() {
    const gzPath = path.resolve(__dirname, 'public/ocr/eng.traineddata.gz');
    const rawPath = path.resolve(__dirname, 'public/ocr/eng.traineddata');
    if (!fs.existsSync(gzPath)) return;
    if (fs.existsSync(rawPath) && fs.statSync(rawPath).size > 1000) return;
    fs.writeFileSync(rawPath, zlib.gunzipSync(fs.readFileSync(gzPath)));
}

function copyIfNeeded(fromRel: string, toRel: string) {
    const src = path.resolve(__dirname, fromRel);
    const dst = path.resolve(__dirname, toRel);
    if (!fs.existsSync(src)) return;
    if (fs.existsSync(dst) && fs.statSync(dst).size === fs.statSync(src).size) return;
    fs.mkdirSync(path.dirname(dst), {recursive: true});
    fs.copyFileSync(src, dst);
}

function copyOcrBrowserBundle() {
    const copies: [string, string][] = [
        ['node_modules/tesseract.js/dist/worker.min.js', 'public/ocr/worker.min.js'],
        ['node_modules/tesseract.js/dist/tesseract.esm.min.js', 'public/ocr/tesseract.esm.min.js'],
        ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'public/ocr/tesseract-core-lstm.wasm.js'],
        ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm', 'public/ocr/tesseract-core-lstm.wasm'],
        ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'public/ocr/tesseract-core-simd-lstm.wasm.js'],
        ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', 'public/ocr/tesseract-core-simd-lstm.wasm'],
        ['node_modules/tesseract.js-core/tesseract-core.wasm.js', 'public/ocr/tesseract-core.wasm.js'],
        ['node_modules/tesseract.js-core/tesseract-core.wasm', 'public/ocr/tesseract-core.wasm'],
    ];
    for (const [from, to] of copies) copyIfNeeded(from, to);
}

const ocrAssets = {
    name: 'ocr-assets',
    buildStart() {
        unpackTraineddata();
        copyOcrBrowserBundle();
    },
    configureServer(server: any) {
        unpackTraineddata();
        copyOcrBrowserBundle();
        server.middlewares.use(serveOcrAsset);
    },
    configurePreviewServer(server: any) {
        server.middlewares.use(serveOcrAsset);
    },
    async closeBundle() {
        const gzPath = path.resolve(__dirname, 'public/ocr/eng.traineddata.gz');
        if (!fs.existsSync(gzPath)) return;
        const outDir = path.resolve(__dirname, 'dist/ocr');
        fs.mkdirSync(outDir, {recursive: true});
        await pipeline(
            fs.createReadStream(gzPath),
            zlib.createGunzip(),
            fs.createWriteStream(path.join(outDir, 'eng.traineddata')),
        );
    },
};

function serveOcrAsset(
    req: { url?: string },
    res: { setHeader: (k: string, v: string) => void; statusCode: number; end: () => void; on: (e: string, fn: () => void) => void },
    next: () => void,
) {
    const url = (req.url ?? '').split('?')[0];
    if (url.startsWith('/ocr/') && url.endsWith('.gz')) {
        const file = path.resolve(__dirname, 'public', url.slice(1));
        if (!fs.existsSync(file)) return next();
        res.setHeader('Content-Type', 'application/gzip');
        res.setHeader('Content-Length', String(fs.statSync(file).size));
        fs.createReadStream(file).pipe(res as unknown as NodeJS.WritableStream);
        return;
    }
    next();
}

// HMR-сокет превью рвёт инфраструктура: ingress-nginx на каждом reload
// конфига (захват/освобождение любого dev-пода) через 30 с закрывает все
// соединения старых воркеров; DDoS Guard режет «тихие» соединения. Сам vite
// на любой обрыв перезагружает страницу. Плагин держит превью живым:
// - сервер шлёт состояние «boot:seq» сразу после каждой рассылки клиентам
//   (update, full-reload, error...) и раз в 5-9 с — это и двусторонний
//   keepalive для DDoS Guard (рандом — чтобы не ловить его фильтр одинаковых
//   интервалов). boot меняется на рестарте vite, seq — на каждой рассылке;
// - клиент (скрипт в index.html) подменяет сокет vite-hmr «вечным»: на
//   обрыве тихо переподключается и перезагружает страницу, только если за
//   время разрыва сервер рестартовал или что-то разослал. Не переподключился
//   с трёх попыток — отдаёт обрыв vite, дальше как раньше (ждёт сервер и
//   перезагружает).
// Клиентский ping понижен до 7 с через server.hmr.timeout ниже.
const hmrClient = `(() => {
    const NativeWebSocket = WebSocket;
    class HmrSocket extends EventTarget {
        OPEN = 1;
        readyState = 0;
        state = "";
        queue = [];
        constructor(url, protocols) {
            super();
            this.url = url;
            this.protocols = protocols;
            this.connect(0);
        }
        connect(attempt) {
            const ws = this.ws = new NativeWebSocket(this.url, this.protocols);
            let fresh = true;
            ws.onopen = () => {
                attempt = 0;
                this.queue.splice(0).forEach((data) => ws.send(data));
                if (this.readyState === 0) {
                    this.readyState = 1;
                    this.dispatchEvent(new Event("open"));
                }
            };
            ws.onmessage = (event) => {
                if (event.data.includes('"ezst:hmr"')) {
                    const state = JSON.parse(event.data).data;
                    if (fresh && this.state && this.state !== state) return location.reload();
                    fresh = false;
                    this.state = state;
                }
                this.dispatchEvent(new MessageEvent("message", {data: event.data}));
            };
            ws.onclose = (event) => {
                if (this.readyState === 3) return;
                if (!this.state || attempt === 3) {
                    this.readyState = 3;
                    return this.dispatchEvent(new CloseEvent("close", event));
                }
                setTimeout(() => this.connect(attempt + 1), attempt * 1000);
            };
        }
        send(data) {
            if (this.ws.readyState === 1) this.ws.send(data);
            else this.queue.push(data);
        }
        close(code, reason) {
            this.readyState = 3;
            this.ws.close(code, reason);
        }
    }
    window.WebSocket = new Proxy(NativeWebSocket, {
        construct: (target, args) => args[1] === "vite-hmr" ? new HmrSocket(...args) : new target(...args),
    });
})();`;

const hmrKeepalive = {
    name: 'hmr-ws-keepalive',
    apply: 'serve' as const,
    configureServer(server: any) {
        const boot = Date.now().toString(36);
        let seq = 0;
        const state = () => ({type: 'custom', event: 'ezst:hmr', data: `${boot}:${seq}`});
        const broadcast = server.ws.send.bind(server.ws);
        server.ws.send = (...args: any[]) => {
            seq++;
            broadcast(...args);
            broadcast(state());
        };
        server.ws.on('connection', (socket: any) => socket.send(JSON.stringify(state())));
        let timer: ReturnType<typeof setTimeout> | null = null;
        const tick = () => {
            broadcast(state());
            timer = setTimeout(tick, 5000 + Math.floor(Math.random() * 4000));
        };
        timer = setTimeout(tick, 5000 + Math.floor(Math.random() * 4000));
        server.httpServer?.on('close', () => {
            if (timer) clearTimeout(timer);
        });
    },
    transformIndexHtml: () => [{tag: 'script', children: hmrClient, injectTo: 'head-prepend' as const}],
};

// https://vitejs.dev/config/
export default defineConfig(({mode}) => ({
    plugins: [
        ocrAssets,
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
    optimizeDeps: {
        exclude: ['tesseract.js'],
    },
    server: {
        host: '0.0.0.0',
        port: 5173,
        allowedHosts: true,
        // Ядра OCR — десятки МБ. Следить за ними не нужно: иначе Vite долго
        // поднимается и тормозит HMR.
        watch: {
            ignored: ['**/public/ocr/**', '**/desktop-kiosk/**'],
        },
        hmr: {
            overlay: false, // Disables the error overlay if you only want console errors
            timeout: 7000, // pingInterval @vite/client — нужен <30s для DDoS Guard
        }
    },
}));
