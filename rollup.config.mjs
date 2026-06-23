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

import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

const plugins = [nodeResolve(), typescript()];

function plugin(name) {
    return {
        input: `src/plugins/${name}.ts`,
        output: {
            file: `plugins/client/${name}.mjs`,
            format: "es"
        },
        plugins
    };
}

function pluginServer(name) {
    return {
        input: `src/plugins/${name}_server.ts`,
        output: {
            file: `plugins/server/${name}.mjs`,
            format: "es"
        },
        plugins
    };
}

export default [{
    input: "src/client/client.ts",
    output: {
        file: "static/kail.mjs",
        format: "es"
    },
    plugins
}, {
    input: "src/server/server.ts",
    external: ["serve-static", "finalhandler"],
    output: {
        file: "server.mjs",
        format: "es"
    },
    plugins
},
    pluginServer("comfy"),
    plugin("comfy"),
    plugin("js_canvas"),
{
    input: "src/plugins/mcp_server.ts",
    external: [
        "@modelcontextprotocol/sdk/client/index.js",
        "@modelcontextprotocol/sdk/client/stdio.js",
        "@modelcontextprotocol/sdk/client/streamableHttp.js"
    ],
    output: {
        file: "plugins/server/mcp.mjs",
        format: "es"
    },
    plugins
},
    plugin("mcp"),
    plugin("render_svg"),
];
