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
            ignored: ['**/public/ocr/**'],
        },
        hmr: {
            overlay: false, // Disables the error overlay if you only want console errors
            timeout: 7000, // pingInterval @vite/client — нужен <30s для DDoS Guard
        }
    },
}));
