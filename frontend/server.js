const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon'
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
    res.writeHead(status, {
        'Content-Type': type,
        'Cache-Control': 'no-cache'
    });
    res.end(body);
}

const server = http.createServer((req, res) => {
    const cleanUrl = decodeURIComponent((req.url || '/').split('?')[0]);
    const relativePath = cleanUrl === '/' ? '/index.html' : cleanUrl;
    const filePath = path.normalize(path.join(ROOT, relativePath));

    if (!filePath.startsWith(ROOT)) {
        return send(res, 403, 'Forbidden');
    }

    fs.stat(filePath, (statErr, stats) => {
        if (statErr || !stats.isFile()) {
            return send(res, 404, 'Not Found');
        }

        const ext = path.extname(filePath).toLowerCase();
        const type = MIME[ext] || 'application/octet-stream';

        fs.readFile(filePath, (readErr, data) => {
            if (readErr) {
                return send(res, 500, 'Internal Server Error');
            }
            send(res, 200, data, type);
        });
    });
});

server.listen(PORT, () => {
    console.log(`JARVIS frontend available at http://localhost:${PORT}`);
});




