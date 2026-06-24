import * as fs from 'fs/promises';
import * as mcp from '@modelcontextprotocol/sdk/client/index.js';
import * as mcpStdio from '@modelcontextprotocol/sdk/client/stdio.js';
import * as mcpHTTP from '@modelcontextprotocol/sdk/client/streamableHttp.js';

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
// Load in the configuration
let config = {};
try {
    config = JSON.parse(await fs.readFile("config/mcp/config.json", "utf8"));
}
catch (ex) {
    console.error(ex);
}
const mcpServers = Object.create(null);
// Connect to each MTP server
for (const name in config.mcpServers || {}) {
    const mcpConfig = config.mcpServers[name];
    try {
        const client = new mcp.Client({
            name: "kail",
            version: "1.0.0"
        });
        let transport;
        if (mcpConfig.command) {
            transport = new mcpStdio.StdioClientTransport(mcpConfig);
        }
        else if (mcpConfig.url) {
            transport = new mcpHTTP.StreamableHTTPClientTransport(mcpConfig.url, mcpConfig);
        }
        else {
            throw new Error("Unsupported MCP configuration");
        }
        await client.connect(transport);
        const res = await client.listTools();
        const tools = Object.create(null);
        for (const tool of res.tools)
            tools[tool.name] = tool;
        mcpServers[name] = {
            client, transport, tools
        };
    }
    catch (ex) {
        console.error(ex);
    }
}
/**
 * Function for handling MCP tool requests.
 * @param req  HTTP request
 * @param res  HTTP response
 */
async function mcpTool(req, res) {
    if (req.url === "/") {
        // Just the list
        const list = Object.create(null);
        for (const name1 in mcpServers) {
            const group = mcpServers[name1];
            for (const name2 in group.tools)
                list[`${name1}/${name2}`] = group.tools[name2];
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(list));
        return;
    }
    // If it wasn't the list, it should be a tool
    const urlParts = req.url.split("/");
    if (urlParts.length !== 3) {
        res.writeHead(500);
        res.end("ERROR: Invalid request");
        return;
    }
    const server = mcpServers[urlParts[1]];
    if (!server) {
        res.writeHead(500);
        res.end(`ERROR: MCP server ${urlParts[1]} not found`);
        return;
    }
    // Get the argument
    let arg = null;
    {
        const parts = [];
        req.on("data", chunk => parts.push(chunk));
        await new Promise(res => req.on("end", res));
        const buf = Buffer.concat(parts);
        arg = JSON.parse(buf.toString("utf8"));
    }
    // Make the call
    const toolRes = await server.client.callTool({
        name: urlParts[2],
        arguments: arg
    });
    // And return the result
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(toolRes.content));
}
KAIL.registerTool({
    name: "mcp",
    enabled: true,
    function: mcpTool
});
