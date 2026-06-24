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

import * as chats from "./chats";
import { dce } from "./dom";
import * as events from "./events";
import * as iface from "./iface";
import * as ui from "./ui";

import * as smd from "streaming-markdown";

/**
 * Tools, to be filled in by other sources.
 */
export const tools: Record<string, iface.Tool> = Object.create(null);

/**
 * Function to register a tool (add it to the tools list).
 * @param tool  Tool to register
 */
export function registerTool(tool: iface.Tool) {
    tools[tool.name] = tool;
    events.dispatch("register-tool", {tool});
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
KAIL.tools = tools;
KAIL.registerTool = registerTool;
(<any> KAIL).simpleRemoteTool = simpleRemoteTool;


// Cache of images converted to lossy formats
const lossyImageCache: WeakMap<
    iface.MessageContentImage, iface.MessageContentImage
> = new WeakMap();

/**
 * Convert an image to a lossy format (JPEG/WebP) for compatibility with
 * models that have data size limits.
 * @param image  Image to convert
 * @returns The image, possibly in a lossy format
 */
async function lossyImage(
    image: iface.MessageContentImage
): Promise<iface.MessageContentImage> {
    if (lossyImageCache.has(image))
        return lossyImageCache.get(image)!;

    // 1. Convert it to an Image
    const img = new Image();
    img.src = image.image_url.url;
    {
        const ok = await new Promise<boolean>(res => {
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
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);

    // 3. Try formats
    let ret: string | null = null;
    async function tryFormat(mime: string, quality: number) {
        const blob = await canvas.convertToBlob({
            type: mime,
            quality
        });
        if (!blob.type.startsWith(mime))
            return false;

        const rdr = new FileReader();
        const rdrP = new Promise<boolean>(res => {
            rdr.onload = () => {
                ret = <string> rdr.result;
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
        const lossy: iface.MessageContentImage = {
            type: "image_url",
            image_url: {url: ret}
        };
        lossyImageCache.set(image, lossy);
        return lossy;

    } else {
        lossyImageCache.set(image, image);
        return image;

    }
}

/**
 * Convert all images in a conversation to lossy formats for compatibility.
 * @param conv  Conversation to convert
 * @returns Copy of conversation with lossy images
 */
async function lossyConversation(conv: iface.Message[]): Promise<iface.Message[]> {
    const ret: iface.Message[] = [];

    for (const c of conv) {
        if (
            typeof c.content === "string" ||
            c.content.findIndex(x => x.type === "image_url") < 0
        ) {
            ret.push(c);
            continue;
        }

        const cc: iface.Message = <any> {};
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
 * Remove the data: URI header from audio and video data for llama.cpp
 * compatibility.
 * @param conv  Conversation to fix up
 * @returns Copy of conversation with fixed up data URLs
 */
async function dataFixup(conv: iface.Message[]): Promise<iface.Message[]> {
    const ret: iface.Message[] = [];

    for (const c of conv) {
        if (
            typeof c.content === "string" ||
            c.content.findIndex(x => x.type.startsWith("input_")) < 0
        ) {
            ret.push(c);
            continue;
        }

        const cc: iface.Message = <any> {};
        Object.assign(cc, c);
        cc.content = [];

        for (const part of c.content) {
            let url: string;
            if (part.type === "input_audio") {
                url = part.input_audio.url;
            } else if (part.type === "input_video") {
                url = part.input_video.url;
            } else {
                continue;
            }
            const data = {
                data: url.slice(url.indexOf(",") + 1)
            };

            const pp = <any> {};
            Object.assign(pp, part);
            if (part.type === "input_audio")
                pp.input_audio = data;
            else if (part.type === "input_video")
                pp.input_video = data;

            cc.content.push(pp);
        }

        ret.push(cc);
    }

    return ret;
}



/**
 * Perform completion steps on this conversation. What exactly constitutes
 * completion steps depends on the conversation, but generally, a user message
 * expects a response, and an assistant message may want to use a tool.
 * @param conv  Conversation to complete
 */
export async function complete(conv: iface.Conversation) {
    while (true) {
        if (ui.manualMode)
            break;

        const lastMessage = conv.messages[conv.messages.length-1];

        if (
            lastMessage.role === "user" ||
            lastMessage.role === "tool"
        ) {
            // Need assistant completion
            if (!await completeAssistant(conv))
                break;

        } else if (
            lastMessage.role === "assistant" &&
            lastMessage.tool_calls
        ) {
            // Assistant message, but with function calls
            for (const tc of lastMessage.tool_calls) {
                const tool = tools[tc.function.name];

                const msg: iface.Message = {
                    role: "tool",
                    tool_call_id: tc.id,
                    content: ""
                };

                // Make the message box early so that it doesn't seem stuck
                const loadingBox = ui.mkMsgBox(conv, msg);
                loadingBox.body.innerText = "...";

                const p = (async () => {
                    if (tool) {
                        try {
                            return await tool.function(conv, tc.function.arguments);
                        } catch (ex) {
                            return `ERROR: ${ex}`;
                        }
                    } else {
                        return "";
                    }
                })();

                const stopP = new Promise<string>(res => {
                    ui.stop(() => res("ERROR: Canceled"));
                });

                msg.content = await Promise.race([p, stopP]);
                ui.stop(null);

                await chats.convPush(conv, msg);

                // Now fix the box
                loadingBox.box.remove();
                ui.mkMsgBox(conv, msg);
            }

        } else {
            // Complete
            break;

        }
    }
}

/**
 * Complete an assistant message (call the AI) and handle streaming response.
 * @param conv  Conversation to complete
 * @returns True if completion succeeded, false if cancelled or failed
 */
async function completeAssistant(conv: iface.Conversation) {
    const msg = conv.inProgress = <iface.Message> {
        role: "assistant",
        content: ""
    };

    let cursor: HTMLElement | null = null;
    let box: ReturnType<typeof ui.mkMsgBox> | null = null;
    let smdNode: HTMLElement | null = null;
    let smdRender: smd.Default_Renderer | null = null;
    let smdParser: smd.Parser | null = null;
    let currentFunctionIdx = -1;

    function customCursor(f: any) {
        return function(data: any) {
            try {
                cursor!.remove();
            } catch (ex) {}
            const ret = f.apply(void 0, arguments);
            try {
                data.nodes[data.index].appendChild(cursor);
            } catch (ex) {}
            return ret;
        };
    }

    function mkSMD(node: HTMLElement) {
        smdRender = smd.default_renderer(node);
        smdRender.add_token = customCursor(smd.default_add_token);
        smdRender.end_token = customCursor(smd.default_end_token);
        smdRender.add_text = customCursor(smd.default_add_text);
        smdParser = smd.parser(smdRender);
        smdNode = node;
    }

    function getCursor() {
        cursor = ui.cursor;
        if (!cursor) {
            box = ui.mkMsgBox(conv, msg);

            cursor = dce("span");
            cursor.className = "streaming-cursor";
            ui.setCursor(cursor);
            box.body.appendChild(cursor);

            mkSMD(box.body);
        }
    }

    function moveCursor(to: HTMLElement) {
        smd.parser_end(smdParser!);
        to.appendChild(cursor!);
        mkSMD(to);
    }

    function insertAtCursor(text: string, tool = false) {
        if (tool) {
            const lines = text.split("\n");
            for (let li = 0; li < lines.length; li++) {
                const line = lines[li];
                if (li > 0)
                    cursor!.insertAdjacentHTML("beforebegin", "<br/>");
                cursor!.insertAdjacentText("beforebegin", line);
            }
        } else {
            smd.parser_write(smdParser!, text);
        }
    }

    if (conv === ui.currentConversation)
        getCursor();


    try {
        const inputMessages = await dataFixup(conv.messages);

        // Set up our query with the settings
        const req: any = {
            model: ui.settings.model.value,
            stream: true,
            messages: inputMessages,
            tools: Object.values(tools).filter(x => x.enabled).map(x => x.schema)
        };

        // Force naming
        if (
            !conv.name &&
            ui.settings.forceName.checked &&
            tools["set_chat_name"] &&
            tools["set_chat_name"].enabled
        ) {
            // Force the AI to set a chat title first
            req.tool_choice = "required";

            if (conv.messages.findIndex(x => x.role === "assistant") >= 0) {
                /* It just used some other tool, so really *force it* to name
                 * the chat */
                req.tools = req.tools.filter(
                    (x: any) => x.function.name === "set_chat_name"
                );
                req.thinking_budget_tokens = 0;
            }
        }

        // Other request parameters
        {
            const reqParams = ui.settings.reqParams.value.trim();
            if (reqParams)
                Object.assign(req, JSON.parse(reqParams));
        }


        // Prepare for stopping
        const abortC = new AbortController();
        ui.stop(() => abortC.abort());

        // Query the AI
        const reqInit: RequestInit = {
            signal: abortC.signal,
            method: "POST",
            headers: {
                "content-type": "application/json"
            },
            body: JSON.stringify(req)
        };
        let f = await fetch("/v1/chat/completions", reqInit);

        if (f.status === 413 /* content too large */) {
            // Try lossy
            req.messages = await lossyConversation(inputMessages);
            reqInit.body = JSON.stringify(req);
            f = await fetch("/v1/chat/completions", reqInit);
        }

        if (f.status < 200 || f.status >= 300) {
            let detail = null;
            try {
                detail = await f.json();
            } catch (ex) {}
            throw Error(`${f.status} ${f.statusText}: ${JSON.stringify(detail)}`);
        }

        // Get and stream the content
        let input = "";
        const tdr = new TextDecoderStream();
        f.body!.pipeTo(tdr.writable);
        for await (const chunk of tdr.readable) {
            input += chunk;
            const lines = input.split("\n");
            input = lines.pop()!;
            for (const line of lines) {
                if (!line) continue;
                const parts = /^data: *(.*)/.exec(line);
                if (!parts) throw Error(`Invalid data from completion server: ${line}`);
                if (parts[1][0] === "[") continue;
                const res = JSON.parse(parts[1]);
                const delta = res.choices[0].delta;

                // To handle scrolling non-aggressively
                const scrolledToBottom =
                    ui.messages.scrollHeight -
                    ui.messages.scrollTop -
                    ui.messages.clientHeight <= 4;

                // Append this delta, whatever it may be
                if (delta.reasoning_content) {
                    if (conv === ui.currentConversation) {
                        getCursor();
                        if (!msg.reasoning_content) {
                            /* No reasoning content yet, so there's no reasoning
                             * content box */
                            const rbox = ui.mkCollapsible("reasoning");
                            box!.body.appendChild(rbox.box);
                            moveCursor(rbox.body);
                        }
                        insertAtCursor(delta.reasoning_content);
                    }

                    if (!msg.reasoning_content)
                        msg.reasoning_content = "";
                    msg.reasoning_content += delta.reasoning_content;

                } else if (delta.tool_calls) {
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

                        if (typeof tool_call.id === "string")
                            tc.id += tool_call.id;
                        if (typeof tool_call.call_id === "string")
                            tc.call_id += tool_call.call_id;
                        if (typeof tool_call.function === "object") {
                            if (typeof tool_call.function.name === "string")
                                tc.function.name += tool_call.function.name;
                            if (typeof tool_call.function.arguments === "string")
                                tc.function.arguments += tool_call.function.arguments;
                        }

                        if (conv === ui.currentConversation) {
                            getCursor();
                            if (idx !== currentFunctionIdx) {
                                // No tool call content yet, so make the box
                                const tbox = ui.mkCollapsible(
                                    "tool-use", `: ${tc.function.name}`
                                );
                                box!.body.appendChild(tbox.box);
                                moveCursor(tbox.body);
                            }
                            if (tool_call.function && tool_call.function.arguments)
                                insertAtCursor(tool_call.function.arguments, true);
                        }

                        currentFunctionIdx = idx;
                    }

                } else if (delta.content) {
                    if (conv === ui.currentConversation) {
                        getCursor();
                        if (smdNode !== box!.body) {
                            /* There was reasoning, so put the cursor out of the
                             * reasoning box */
                            moveCursor(box!.body);
                        }
                        insertAtCursor(delta.content);
                    }

                    msg.content += delta.content;

                } else if (
                    delta.content === null || Object.keys(delta).length === 0
                ) {
                    // Just a keepalive

                } else {
                    throw Error(JSON.stringify(delta));

                }

                // Conditionally keep it scrolled
                if (scrolledToBottom)
                    ui.messages.scrollTop = ui.messages.scrollHeight;
            }
        }

        if (cursor)
            (<any> cursor).remove();

    } catch (ex) {
        msg.role = "system";
        msg.content += `\n\nERROR: ${ex}`;

    }

    ui.stop(null);
    ui.setCursor(null);
    ui.messages.scrollTop = ui.messages.scrollTop;

    if (conv.inProgress) {
        const msg = conv.inProgress;
        delete conv.inProgress;
        await chats.convPush(conv, msg);

        if (box)
            box.box.remove();

        if (ui.currentConversation === conv)
            ui.mkMsgBox(conv, msg);

        return true;
    }

    return false;
}
