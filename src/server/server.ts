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

import * as cache from "./cache";
import { config } from "./config";
import * as iface from "./iface";

import * as fs from "fs/promises";
import * as http from "http";

// @ts-ignore
import finalhandler from "finalhandler";
// @ts-ignore
import serveStatic from "serve-static";

// Global configuration
const DEFAULT_PORT = 8189;
const PORT = config.port || DEFAULT_PORT;
const CACHE_PATH = "/cache/";
const PLUGINS_PATH = "/plugins";
const PROXY_PATH = "/v1/";
const TOOLS_PATH = "/tools/"

/**
 * Tools registered by plugins.
 */
const tools: Record<string, iface.Tool> = Object.create(null);

/**
 * Register a tool.
 * @param tool  Tool to register
 */
function registerTool(tool: iface.Tool) {
    tools[tool.name] = tool;
}

/**
 * Create a proxy function that forwards requests to a target URL.
 * @param target  Target base URL to proxy to
 * @returns Proxy function for tool requests
 */
function toolFunctionProxy(target: string): iface.ToolFunction {
    return function(req: http.IncomingMessage, res: http.ServerResponse) {
        const targetUrl = new URL(req.url!, target);

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

(<any> globalThis).KAIL = (<any> globalThis).KAIL || {};
declare let KAIL: iface.KAIL;
KAIL.tools = tools;
KAIL.registerTool = registerTool;
(<any> KAIL).toolFunctionProxy = toolFunctionProxy;


// Load any plugins
for (const file of await fs.readdir("plugins/server")) {
    if (!/\.mjs$/.test(file))
        continue;
    try {
        await import(`./plugins/server/${file}`);
    } catch (ex) {
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
    const url = req.url!;
    if (url.startsWith(PROXY_PATH)) {
        completionProxy(req, res);

    } else if (url.startsWith(`${PLUGINS_PATH}/`)) {
        // Send a client plugin back
        req.url = url.slice(PLUGINS_PATH.length);
        pluginsServe(req, res, finalhandler(res, req));

    } else if (url === PLUGINS_PATH) {
        // Get the list of plugins
        const list: string[] = [];
        for (const file of await fs.readdir("plugins/client")) {
            if (!file.endsWith(".mjs"))
                continue;
            list.push(file.slice(0, file.length - 4));
        }

        res.writeHead(200, {"content-type": "application/json"});
        res.end(JSON.stringify(list));

    } else if (url === `${CACHE_PATH}set`) {
        try {
            const parts: Buffer[] = [];
            req.on("data", chunk => parts.push(chunk));
            await new Promise(res => req.on("end", res));
            const buf = Buffer.concat(parts);
            await cache.cacheSet(buf.toString("utf8"), res);
        } catch (_) {
            res.writeHead(500);
            res.end();
        }

    } else if (url.startsWith(CACHE_PATH)) {
        try {
            await cache.cacheGet(url.slice(CACHE_PATH.length), res);
        } catch (_) {
            res.writeHead(500);
            res.end();
        }

    } else if (url.startsWith(TOOLS_PATH)) {
        const parts = url.split("/");
        if (parts.length < 3 || !tools[parts[2]]) {
            res.writeHead(404);
            res.end("Tool not found");
        }

        req.url = `/${parts.slice(3).join("/")}`;
        tools[parts[2]].function(req, res);

    } else {
        serve(req, res, finalhandler(req, res));

    }
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
