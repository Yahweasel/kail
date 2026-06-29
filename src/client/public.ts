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

import * as events from "./events";
import * as iface from "./iface";

/**
 * Tool groups, to be filled in by other sources.
 */
export const toolGroups: Record<string, iface.ToolGroup> = Object.create(null);

/**
 * Tools, to be filled in by other sources.
 */
export const tools: Record<string, iface.Tool> = Object.create(null);

/**
 * Function to register a tool group.
 * @param id  Internal ID for the group
 * @param name  Public name for the group
 */
export function registerToolGroup(id: string, name: string) {
    if (toolGroups[id])
        return;
    toolGroups[id] = {name, tools: Object.create(null)};
}


/**
 * Function to register a tool (add it to the tools list).
 * @param group  The group to register the tool in
 * @param tool  Tool to register
 */
export function registerTool(group: string, tool: iface.Tool) {
    registerToolGroup(group, group);
    toolGroups[group].tools[tool.name] = tool;

    // Try variations of the name for the registered tool
    let tryName = tool.name;
    if (tools[tryName])
        tryName = `${group}_${tool.name}`;
    let idx = 2;
    while (tools[tryName])
        tryName = `${group}_${tool.name}_${idx++}`;

    // And register it with the chosen name
    tools[tryName] = tool;
    tool.name = tryName;
    tool.schema.function.name = tryName;

    events.dispatch("register-tool", {
        groupId: group, group: toolGroups[group], tool
    });
}

/**
 * Create a simple tool function for a tool handled by the server.
 * @param name  Tool name
 */
export function simpleRemoteTool(name: string): iface.ToolFunction {
    return async (conv: iface.Conversation, arg: string) => {
        try {
            const f = await fetch(`/tools/${name}`, {
                method: "POST",
                headers: {
                    "content-type": "application/json"
                },
                body: JSON.stringify({conv, arg})
            });
            return await f.json();
        } catch (ex) {
            return `ERROR: ${ex}`;
        }
    };
}

(<any> globalThis).KAIL = (<any> globalThis).KAIL || {};
declare let KAIL: iface.KAIL;
KAIL.toolGroups = toolGroups;
KAIL.tools = tools;
KAIL.registerToolGroup = registerToolGroup;
KAIL.registerTool = registerTool;
(<any> KAIL).simpleRemoteTool = simpleRemoteTool;
