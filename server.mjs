import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import * as http from 'http';
import finalhandler from 'finalhandler';
import serveStatic from 'serve-static';

const config = JSON.parse(await fs.readFile("config/config.json", "utf8"));

/*
 * Copyright (c) 2026 Yahweasel
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED “AS IS” AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */
var _a;
const cacheDir = ((_a = config.cache) === null || _a === void 0 ? void 0 : _a.dir) || "cache";
await fs.mkdir(cacheDir, { recursive: true });
/**
 * Set this image in the cache. Responds via res.
 * @param data  Data URI
 * @param res  HTTP response
 */
async function cacheSet(data, res) {
    if (!data.startsWith("data:")) {
        res.writeHead(500);
        res.end();
        return;
    }
    const f = await fetch(data);
    const d = await f.bytes();
    const c = crypto.createHash("sha1");
    c.update(d);
    const hash = c.digest("hex");
    let ext = "bin";
    const ct = f.headers.get("content-type");
    if (ct === "image/png")
        ext = "png";
    else if (ct === "image/webp")
        ext = "webp";
    else if (ct === "image/jpeg")
        ext = "jpg";
    let name = "";
    for (let i = 0;; i++) {
        name = `${hash}${(i === 0) ? "" : ("-" + i)}.${ext}`;
        const cacheName = `${cacheDir}/${name}`;
        try {
            await fs.access(cacheName);
            // Already exists, so check if it's the same
            const cd = await fs.readFile(cacheName);
            if (cd.compare(d) === 0)
                break;
        }
        catch (ex) {
            // Doesn't already exist, make it
            await fs.writeFile(cacheName, d);
            break;
        }
    }
    res.writeHead(200, { "content-type": "text/json" });
    res.end(JSON.stringify({
        name,
        url: `${config.cache.url}/cache/${name}`
    }));
}
/**
 * Get a file from the cache.
 * @param name  Filename
 * @param res  HTTP response
 */
async function cacheGet(name, res) {
    if (/[^0-9a-z\.-]/.test(name)) {
        res.writeHead(404);
        res.end();
        return;
    }
    // Figure out the type
    let type = "application/octet-stream";
    if (name.endsWith(".png"))
        type = "image/png";
    else if (name.endsWith(".webp"))
        type = "image/webp";
    else if (name.endsWith(".jpg"))
        type = "image/jpeg";
    try {
        const d = await fs.readFile(`${cacheDir}/${name}`);
        res.writeHead(200, { "content-type": type });
        res.end(d);
    }
    catch (ex) {
        res.writeHead(404);
        res.end();
    }
}

/*!
 * Copyright (c) 2026 Yahweasel
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED “AS IS” AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */
// Global configuration
const DEFAULT_PORT = 8189;
const PORT = config.port || DEFAULT_PORT;
const CACHE_PATH = "/cache/";
const PLUGINS_PATH = "/plugins";
const PROXY_PATH = "/v1/";
const TOOLS_PATH = "/tools/";
// Tools to be filled in by plugins
const tools = Object.create(null);
function registerTool(tool) {
    tools[tool.name] = tool;
}
function toolFunctionProxy(target) {
    return function (req, res) {
        const targetUrl = new URL(req.url, target);
        const proxyReq = http.request(targetUrl, {
            method: req.method,
            headers: req.headers
        }, proxyRes => {
            res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
            proxyRes.pipe(res);
        });
        req.pipe(proxyReq);
        proxyReq.on("error", ex => {
            console.error(ex);
            res.writeHead(502);
            res.end("Bad Gateway");
        });
    };
}
globalThis.KAIL = globalThis.KAIL || {};
KAIL.tools = tools;
KAIL.registerTool = registerTool;
KAIL.toolFunctionProxy = toolFunctionProxy;
// Load any plugins
for (const file of await fs.readdir("plugins/server")) {
    if (!/\.mjs$/.test(file))
        continue;
    try {
        await import(`./plugins/server/${file}`);
    }
    catch (ex) {
        console.error(`Failed to load plugin ${file}: ${ex}`);
    }
}
// Default proxy
const completionProxy = toolFunctionProxy(config.openai.host);
// Set up the web server
const serve = serveStatic(`${process.cwd()}/static`);
const pluginsServe = serveStatic(`${process.cwd()}/plugins/client`);
const server = http.createServer();
server.on("request", async (req, res) => {
    const url = req.url;
    if (url.startsWith(PROXY_PATH)) {
        completionProxy(req, res);
    }
    else if (url.startsWith(`${PLUGINS_PATH}/`)) {
        // Send a client plugin back
        req.url = url.slice(PLUGINS_PATH.length);
        pluginsServe(req, res, finalhandler(res, req));
    }
    else if (url === PLUGINS_PATH) {
        // Get the list of plugins
        const list = [];
        for (const file of await fs.readdir("plugins/client")) {
            if (!file.endsWith(".mjs"))
                continue;
            list.push(file.slice(0, file.length - 4));
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(list));
    }
    else if (url === `${CACHE_PATH}set`) {
        try {
            const parts = [];
            req.on("data", chunk => parts.push(chunk));
            await new Promise(res => req.on("end", res));
            const buf = Buffer.concat(parts);
            await cacheSet(buf.toString("utf8"), res);
        }
        catch (_) {
            res.writeHead(500);
            res.end();
        }
    }
    else if (url.startsWith(CACHE_PATH)) {
        try {
            await cacheGet(url.slice(CACHE_PATH.length), res);
        }
        catch (_) {
            res.writeHead(500);
            res.end();
        }
    }
    else if (url.startsWith(TOOLS_PATH)) {
        const parts = url.split("/");
        if (parts.length < 3 || !tools[parts[2]]) {
            res.writeHead(404);
            res.end("Tool not found");
        }
        req.url = `/${parts.slice(3).join("/")}`;
        tools[parts[2]].function(req, res);
    }
    else {
        serve(req, res, finalhandler(req, res));
    }
});
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
