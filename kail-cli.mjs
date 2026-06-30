import * as fs from 'fs/promises';
import * as path from 'path';

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
/* global Reflect, Promise, SuppressedError, Symbol, Iterator */


function __values(o) {
    var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
    if (m) return m.call(o);
    if (o && typeof o.length === "number") return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
    throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
}

function __asyncValues(o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
}

typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
};

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
// Cache of images converted to lossy formats
const lossyImageCache = new WeakMap();
/**
 * Convert an image to a lossy format (JPEG/WebP) for compatibility with
 * models that have data size limits.
 * @param image  Image to convert
 * @returns The image, possibly in a lossy format
 */
async function lossyImage(image) {
    if (lossyImageCache.has(image))
        return lossyImageCache.get(image);
    // 1. Convert it to an Image
    const img = new Image();
    img.src = image.image_url.url;
    {
        const ok = await new Promise(res => {
            img.onload = () => res(true);
            img.onerror = () => res(false);
        });
        if (!ok) {
            lossyImageCache.set(image, image);
            return image;
        }
    }
    // 2. Draw it on a canvas
    const canvas = new OffscreenCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    // 3. Try formats
    let ret = null;
    async function tryFormat(mime, quality) {
        const blob = await canvas.convertToBlob({
            type: mime,
            quality
        });
        if (!blob.type.startsWith(mime))
            return false;
        const rdr = new FileReader();
        const rdrP = new Promise(res => {
            rdr.onload = () => {
                ret = rdr.result;
                res(true);
            };
            rdr.onerror = () => res(false);
        });
        rdr.readAsDataURL(blob);
        return await rdrP;
    }
    //(await tryFormat("image/webp", 0.8)) ||
    (await tryFormat("image/jpeg", 0.9));
    if (ret) {
        const lossy = {
            type: "image_url",
            image_url: { url: ret }
        };
        lossyImageCache.set(image, lossy);
        return lossy;
    }
    else {
        lossyImageCache.set(image, image);
        return image;
    }
}
/**
 * Convert all images in a conversation to lossy formats for compatibility.
 * @param conv  Conversation to convert
 * @returns Copy of conversation with lossy images
 */
async function lossyConversation(conv) {
    const ret = [];
    for (const c of conv) {
        if (typeof c.content === "string" ||
            c.content.findIndex(x => x.type === "image_url") < 0) {
            ret.push(c);
            continue;
        }
        const cc = {};
        Object.assign(cc, c);
        cc.content = [];
        for (const part of c.content) {
            if (part.type !== "image_url") {
                cc.content.push(part);
                continue;
            }
            cc.content.push(await lossyImage(part));
        }
        ret.push(cc);
    }
    return ret;
}
/**
 * Fix up data in messages for compatibility. Removes hidden messages and
 * metadata, and removes data: URI headers from audio and video data for
 * llama.cpp compatibility.
 * @param conv  Conversation to fix up
 * @returns Copy of conversation with fixed up data URLs
 */
async function dataFixup(conv) {
    const ret = [];
    let skipCount = 0;
    function skipMsg() {
        if (skipCount <= 0)
            return;
        ret.push({
            role: "user",
            content: `SYSTEM MESSAGE: ${skipCount} messages have been elided for context room.`
        });
        skipCount = 0;
    }
    for (const c of conv) {
        if (c.kail_hidden) {
            skipCount++;
            continue;
        }
        skipMsg();
        if (typeof c.content === "string") {
            ret.push(c);
            continue;
        }
        const cc = {};
        Object.assign(cc, c);
        cc.content = [];
        for (const part of c.content) {
            const pp = {};
            Object.assign(pp, part);
            delete pp._meta;
            cc.content.push(pp);
            if (part.type === "input_audio" ||
                part.type === "input_video") {
                let url;
                if (part.type === "input_audio")
                    url = part.input_audio.url;
                else
                    url = part.input_video.url;
                const data = {
                    data: url.slice(url.indexOf(",") + 1)
                };
                if (part.type === "input_audio")
                    pp.input_audio = data;
                else
                    pp.input_video = data;
            }
        }
        ret.push(cc);
    }
    skipMsg();
    return ret;
}

/**
 * Global event target for application-wide events.
 */
const events = new EventTarget();
const KAILEvent = typeof CustomEvent !== "undefined"
    ? CustomEvent
    : class KAILEvent extends Event {
        constructor(type, opts = {}) {
            super(type);
            this.detail = opts.detail || null;
        }
    };
/**
 * Dispatch a custom event on the global event target.
 * @param type  Type of event to dispatch
 * @param detail  Detail object to include with the event
 */
function dispatch(type, detail) {
    events.dispatchEvent(new KAILEvent(type, { detail }));
}

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
/**
 * Tool groups, to be filled in by other sources.
 */
const toolGroups = Object.create(null);
/**
 * Tools, to be filled in by other sources.
 */
const tools = Object.create(null);
/**
 * Function to register a tool group.
 * @param id  Internal ID for the group
 * @param name  Public name for the group
 */
function registerToolGroup(id, name) {
    if (toolGroups[id])
        return;
    toolGroups[id] = { name, tools: Object.create(null) };
}
/**
 * Function to register a tool (add it to the tools list).
 * @param group  The group to register the tool in
 * @param tool  Tool to register
 */
function registerTool(group, tool) {
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
    dispatch("register-tool", {
        groupId: group, group: toolGroups[group], tool
    });
}
/**
 * Create a simple tool function for a tool handled by the server.
 * @param name  Tool name
 */
function simpleRemoteTool(name) {
    return async (conv, arg) => {
        try {
            const f = await fetch(`/tools/${name}`, {
                method: "POST",
                headers: {
                    "content-type": "application/json"
                },
                body: JSON.stringify({ conv, arg })
            });
            return await f.json();
        }
        catch (ex) {
            return `ERROR: ${ex}`;
        }
    };
}
globalThis.KAIL = globalThis.KAIL || {};
KAIL.toolGroups = toolGroups;
KAIL.tools = tools;
KAIL.registerToolGroup = registerToolGroup;
KAIL.registerTool = registerTool;
KAIL.simpleRemoteTool = simpleRemoteTool;

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
// Handle arguments
function usage() {
    console.log(`Use: kail-cli [conversation file] [options]
Options:
    -c|--config <config file>
    -m|--model <model name>
    -p|--prompt-file <prompt file>
    -P|--prompt <prompt>
`);
}
let configFile = null;
let cmdLineModel = null;
let convFile = null;
let promptFile = null;
let prompt = null;
for (let ai = 2; ai < process.argv.length; ai++) {
    const arg = process.argv[ai];
    if (arg[0] === "-") {
        switch (arg) {
            case "-c":
            case "--config":
                configFile = process.argv[++ai];
                break;
            case "-m":
            case "--model":
                cmdLineModel = process.argv[++ai];
                break;
            case "-p":
            case "--prompt-file":
                promptFile = process.argv[++ai];
                break;
            case "-P":
            case "--prompt":
                prompt = process.argv[++ai];
                break;
            case "-h":
            case "--help":
                usage();
                process.exit(0);
            default:
                usage();
                process.exit(1);
        }
    }
    else if (!convFile) {
        convFile = arg;
    }
    else {
        usage();
        process.exit(1);
    }
}
// Try to get our configuration
let config = {};
if (configFile) {
    config = JSON.parse(await fs.readFile(configFile, "utf8"));
}
else {
    try {
        config = JSON.parse(await fs.readFile("kail-cli-config.json", "utf8"));
    }
    catch (ex) {
        try {
            config = JSON.parse(await fs.readFile(`${path.dirname(process.argv[1])}/kail-cli-config.json`, "utf8"));
        }
        catch (ex) { }
    }
}
if (cmdLineModel)
    config.model = cmdLineModel;
if (!config.model) {
    console.error(`You must provide a model, either through config.model or the -m command line
argument.
`);
    process.exit(1);
}
KAIL.cliConfig = config;
KAIL.host = config.host || "http://localhost:8189";
KAIL.model = config.model;
// Load tools
{
    const toolDir = `${path.dirname(process.argv[1])}/plugins/client`;
    for (const file of await fs.readdir(toolDir)) {
        if (!/\.mjs$/.test(file))
            continue;
        try {
            await import(`${toolDir}/${file}`);
        }
        catch (ex) {
            console.error(ex);
        }
    }
    if (config.whitelist) {
        for (const tool in KAIL.tools)
            KAIL.tools[tool].enabled = false;
        for (const tool of config.whitelist) {
            if (tool in KAIL.tools)
                KAIL.tools[tool].enabled = true;
        }
    }
    if (config.blacklist) {
        for (const tool of config.blacklist) {
            if (tool in KAIL.tools)
                KAIL.tools[tool].enabled = false;
        }
    }
}
/**
 * Perform completion steps on this conversation. What exactly constitutes
 * completion steps depends on the conversation, but generally, a user message
 * expects a response, and an assistant message may want to use a tool.
 * @param conv  Conversation to complete
 */
async function complete(conv) {
    while (true) {
        const lastMessage = conv.messages[conv.messages.length - 1];
        if (!lastMessage ||
            lastMessage.role === "user" ||
            lastMessage.role === "tool") {
            // Need assistant completion
            if (!await completeAssistant(conv))
                break;
        }
        else if (lastMessage.role === "assistant" &&
            lastMessage.tool_calls) {
            // Assistant message, but with function calls
            for (const tc of lastMessage.tool_calls) {
                const tool = KAIL.tools[tc.function.name];
                const msg = {
                    role: "tool",
                    tool_call_id: tc.id,
                    content: ""
                };
                const toolRes = await (async () => {
                    if (tool) {
                        try {
                            return await tool.function(conv, tc.function.arguments);
                        }
                        catch (ex) {
                            return `ERROR: ${ex}`;
                        }
                    }
                    else {
                        return "";
                    }
                })();
                if (toolRes.response) {
                    const act = toolRes;
                    msg.content = act.response;
                    if (act.meta)
                        msg._meta = act.meta;
                }
                else {
                    msg.content = toolRes;
                }
                /* MCP is allowed to send images in an alt format that we
                 * don't/can't support. */
                if (msg.content instanceof Array) {
                    for (const partT of msg.content) {
                        const part = partT;
                        if (part.type === "image") {
                            part.type = "image_url";
                            part.image_url = {
                                url: `data:${part.mimeType};base64,${part.data}`
                            };
                            delete part.mimeType;
                            delete part.data;
                        }
                    }
                }
                conv.messages.push(msg);
            }
        }
        else {
            // Complete
            break;
        }
        // Save the conversation as it is now
        if (convFile) {
            await fs.writeFile(`${convFile}.tmp`, JSON.stringify(conv, null, 2));
            await fs.rename(`${convFile}.tmp`, convFile);
        }
    }
}
/**
 * Complete an assistant message (call the AI) and handle streaming response.
 * @param conv  Conversation to complete
 * @returns True if completion succeeded, false if cancelled or failed
 */
async function completeAssistant(conv) {
    var _a, e_1, _b, _c;
    const msg = conv.inProgress = {
        role: "assistant",
        content: ""
    };
    let inThought = false;
    let currentFunctionIdx = -1;
    try {
        const inputMessages = await dataFixup(conv.messages);
        // Set up our query with the settings
        const req = {
            model: config.model,
            stream: true,
            messages: inputMessages,
            tools: Object.values(KAIL.tools).filter(x => x.enabled).map(x => x.schema)
        };
        // Other request parameters
        if (config.reqParams)
            Object.assign(req, config.reqParams);
        // Query the AI
        const reqInit = {
            method: "POST",
            headers: {
                "content-type": "application/json"
            },
            body: JSON.stringify(req)
        };
        let f = await fetch(`${KAIL.host}/v1/chat/completions`, reqInit);
        if (f.status === 413 /* content too large */) {
            // Try lossy
            req.messages = await lossyConversation(inputMessages);
            reqInit.body = JSON.stringify(req);
            f = await fetch(`${KAIL.host}/v1/chat/completions`, reqInit);
        }
        if (f.status < 200 || f.status >= 300) {
            let detail = null;
            try {
                detail = await f.json();
            }
            catch (ex) { }
            throw Error(`${f.status} ${f.statusText}: ${JSON.stringify(detail)}`);
        }
        // Get and stream the content
        let input = "";
        const tdr = new TextDecoderStream();
        f.body.pipeTo(tdr.writable);
        try {
            for (var _d = true, _e = __asyncValues(tdr.readable), _f; _f = await _e.next(), _a = _f.done, !_a; _d = true) {
                _c = _f.value;
                _d = false;
                const chunk = _c;
                input += chunk;
                const lines = input.split("\n");
                input = lines.pop();
                for (const line of lines) {
                    if (!line || line === ":")
                        continue;
                    const parts = /^data: *(.*)/.exec(line);
                    if (!parts) {
                        throw Error(`Invalid data from completion server: ${JSON.stringify(line)}`);
                    }
                    if (parts[1][0] === "[")
                        continue;
                    const res = JSON.parse(parts[1]);
                    const delta = res.choices[0].delta;
                    // Possibly end things
                    if (inThought && !delta.reasoning_content) {
                        process.stdout.write("\n</think>\n");
                        inThought = false;
                    }
                    if (currentFunctionIdx >= 0 && !delta.tool_calls) {
                        process.stdout.write(")\n</tool>\n");
                        currentFunctionIdx = -1;
                    }
                    // Append this delta, whatever it may be
                    if (delta.reasoning_content) {
                        if (!msg.reasoning_content) {
                            msg.reasoning_content = "";
                            process.stdout.write("<think>\n");
                            inThought = true;
                        }
                        process.stdout.write(delta.reasoning_content);
                        msg.reasoning_content += delta.reasoning_content;
                    }
                    else if (delta.tool_calls) {
                        for (const tool_call of delta.tool_calls) {
                            const idx = tool_call.index || ((currentFunctionIdx < 0)
                                ? 0 : currentFunctionIdx);
                            msg.tool_calls = msg.tool_calls || [];
                            while (msg.tool_calls.length <= idx) {
                                msg.tool_calls.push({
                                    id: "",
                                    type: "function",
                                    function: {
                                        name: "",
                                        arguments: ""
                                    }
                                });
                            }
                            const tc = msg.tool_calls[idx];
                            if (idx !== currentFunctionIdx) {
                                if (currentFunctionIdx >= 0)
                                    process.stdout.write("\n</tool>\n");
                                currentFunctionIdx = idx;
                                process.stdout.write("<tool>\n");
                            }
                            if (typeof tool_call.id === "string")
                                tc.id += tool_call.id;
                            if (typeof tool_call.call_id === "string")
                                tc.call_id += tool_call.call_id;
                            if (typeof tool_call.function === "object") {
                                if (typeof tool_call.function.name === "string") {
                                    tc.function.name += tool_call.function.name;
                                    process.stdout.write(tool_call.function.name);
                                }
                                if (typeof tool_call.function.arguments === "string") {
                                    tc.function.arguments += tool_call.function.arguments;
                                    process.stdout.write(tool_call.function.arguments);
                                }
                            }
                        }
                    }
                    else if (delta.content) {
                        msg.content += delta.content;
                        process.stdout.write(delta.content);
                    }
                    else if (delta.content === null || Object.keys(delta).length === 0) {
                        // Just a keepalive
                    }
                    else {
                        throw Error(JSON.stringify(delta));
                    }
                }
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (!_d && !_a && (_b = _e.return)) await _b.call(_e);
            }
            finally { if (e_1) throw e_1.error; }
        }
    }
    catch (ex) {
        msg.role = "system";
        msg.content += `\n\nERROR: ${ex}`;
        process.stdout.write(`\n\nERROR: ${ex}`);
    }
    process.stdout.write("\n\n");
    if (conv.inProgress) {
        const msg = conv.inProgress;
        delete conv.inProgress;
        conv.messages.push(msg);
        return true;
    }
    return false;
}
// Load in the conversation so far
let conv = {
    id: 0,
    messages: []
};
if (convFile) {
    let exists = false;
    try {
        await fs.access(convFile);
        exists = true;
    }
    catch (ex) { }
    if (exists)
        conv = JSON.parse(await fs.readFile(convFile, "utf8"));
}
// Add the prompt
if (typeof prompt === "string") {
    if (promptFile) {
        console.error("Specify only one of a prompt file or a prompt.");
        process.exit(1);
    }
    conv.messages.push({
        role: "user",
        content: prompt
    });
}
else if (promptFile) {
    conv.messages.push({
        role: "user",
        content: await fs.readFile(promptFile, "utf8")
    });
}
// And do the actual AI
await complete(conv);

export { complete };
