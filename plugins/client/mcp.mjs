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
// Get the list of MCP endpoints from the server
const list = await (async () => {
    const f = await fetch(`${KAIL.host}/tools/mcp`);
    return await f.json();
})();
/**
 * Tool callback function for MCP tools.
 * @param url  MCP tool URL identifier
 * @param arg  JSON string of arguments
 * @returns Tool result from MCP server
 */
async function mcpTool(url, arg) {
    const f = await fetch(`${KAIL.host}/tools/mcp/${url}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: arg
    });
    return await f.json();
}
// Register each tool
for (const groupName in list) {
    const groupList = list[groupName];
    const groupId = `mcp_${groupName}`;
    KAIL.registerToolGroup(groupId, `MCP: ${groupName}`);
    for (const url in groupList) {
        const tool = groupList[url];
        KAIL.registerTool(groupId, {
            name: tool.name,
            enabled: true,
            function: (_, arg) => mcpTool(url, arg),
            schema: {
                type: "function",
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema,
                    strict: true
                }
            }
        });
    }
}
