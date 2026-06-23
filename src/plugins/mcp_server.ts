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

import * as iface from "../server/iface";

import * as fs from "fs/promises";
import * as http from "http";

import * as mcp from "@modelcontextprotocol/sdk/client/index.js";
import * as mcpTransport from "@modelcontextprotocol/sdk/shared/transport.js";
import * as mcpStdio from "@modelcontextprotocol/sdk/client/stdio.js";
import * as mcpHTTP from "@modelcontextprotocol/sdk/client/streamableHttp.js";

type HTTPOptions =
    mcpHTTP.StreamableHTTPClientTransportOptions & {url: string};

// Load in the configuration
let config: {
    mcpServers?: Record<
        string,
        mcpStdio.StdioServerParameters | HTTPOptions
    >
} = {};
try {
    config = JSON.parse(await fs.readFile("config/mcp/config.json", "utf8"));
} catch (ex) {
    console.error(ex);
}

const mcpServers: Record<string, {
    client: mcp.Client,
    transport: mcpTransport.Transport,
    tools: Record<
        string,
        Awaited<ReturnType<typeof mcp.Client.prototype.listTools>>["tools"][0]
    >
}> = Object.create(null);


// Connect to each MTP server
for (const name in config.mcpServers||{}) {
    const mcpConfig = config.mcpServers![name];
    try {
        const client = new mcp.Client({
            name: "kail",
            version: "1.0.0"
        });
        let transport;
        if ((<any> mcpConfig).command) {
            transport = new mcpStdio.StdioClientTransport(
                <mcpStdio.StdioServerParameters> mcpConfig
            );
        } else if ((<any> mcpConfig).url) {
            transport = new mcpHTTP.StreamableHTTPClientTransport(
                (<any> mcpConfig).url,
                <mcpHTTP.StreamableHTTPClientTransportOptions> mcpConfig
            );
        } else {
            throw new Error("Unsupported MCP configuration");
        }
        await client.connect(transport);

        const res = await client.listTools();
        const tools: Record<string, typeof res.tools[0]> = Object.create(null);
        for (const tool of res.tools)
            tools[tool.name] = tool;
        mcpServers[name] = {
            client, transport, tools
        };

    } catch (ex) {
        console.error(ex);

    }

}


// Function for tool handling
async function mcpTool(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.url === "/") {
        // Just the list
        const list: Record<string, typeof mcpServers["x"]["tools"][0]> =
            Object.create(null);

        for (const name1 in mcpServers) {
            const group = mcpServers[name1];
            for (const name2 in group.tools)
                list[`${name1}/${name2}`] = group.tools[name2];
        }

        res.writeHead(200, {"content-type": "application/json"});
        res.end(JSON.stringify(list));
        return;
    }

    // If it wasn't the list, it should be a tool
    const urlParts = req.url!.split("/");
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
    let arg: any = null;
    {
        const parts: Buffer[] = [];
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
    res.writeHead(200, {"content-type": "application/json"});
    res.end(JSON.stringify(toolRes.content));
}


// Register (if applicable)
declare let KAIL: iface.KAIL;
KAIL.registerTool({
    name: "mcp",
    enabled: true,
    function: mcpTool
});
