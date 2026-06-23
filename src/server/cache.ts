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

import { config } from "./config";

import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as http from "http";

const cacheDir: string = config.cache?.dir || "cache";
await fs.mkdir(cacheDir, {recursive: true});

/**
 * Set this image in the cache. Responds via res.
 * @param data  Data URI
 * @param res  HTTP response
 */
export async function cacheSet(data: string, res: http.ServerResponse) {
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

    let name: string = "";
    for (let i = 0;; i++) {
        name = `${hash}${(i === 0) ? "" : ("-" + i)}.${ext}`;
        const cacheName = `${cacheDir}/${name}`;
        try {
            await fs.access(cacheName);

            // Already exists, so check if it's the same
            const cd = await fs.readFile(cacheName);
            if (cd.compare(d) === 0)
                break;

        } catch (ex) {
            // Doesn't already exist, make it
            await fs.writeFile(cacheName, d);
            break;

        }
    }

    res.writeHead(200, {"content-type": "text/json"});
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
export async function cacheGet(name: string, res: http.ServerResponse) {
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
        res.writeHead(200, {"content-type": type});
        res.end(d);
    } catch (ex) {
        res.writeHead(404);
        res.end();
    }
}
