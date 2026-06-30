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

import * as iface from "../client/iface";
import * as proc from "../client/proc";
import "../client/public";

import * as fs from "fs/promises";
import * as path from "path";

declare let KAIL: iface.KAIL;

// Handle arguments
function usage() {
    console.log(
`Use: kail-cli [conversation file] [options]
Options:
    -c|--config <config file>
    -m|--model <model name>
    -p|--prompt-file <prompt file>
    -P|--prompt <prompt>
`);
}

let configFile: string | null = null;
let cmdLineModel: string | null = null;
let convFile: string | null = null;
let promptFile: string | null = null;
let prompt: string | null = null;
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

    } else if (!convFile) {
        convFile = arg;

    } else {
        usage();
        process.exit(1);

    }
}

// Try to get our configuration
let config = <any> {};
if (configFile) {
    config = JSON.parse(await fs.readFile(configFile, "utf8"));
} else {
    try {
        config = JSON.parse(await fs.readFile("kail-cli-config.json", "utf8"));
    } catch (ex) {
        try {
            config = JSON.parse(await fs.readFile(
                `${path.dirname(process.argv[1])}/kail-cli-config.json`, "utf8"
            ));
        } catch (ex) {}
    }
}

if (cmdLineModel)
    config.model = cmdLineModel;
if (!config.model) {
    console.error(
`You must provide a model, either through config.model or the -m command line
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
        } catch (ex) {
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
export async function complete(conv: iface.Conversation) {
    while (true) {
        const lastMessage = conv.messages[conv.messages.length-1];

        if (
            !lastMessage ||
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
                const tool = KAIL.tools[tc.function.name];

                const msg: iface.Message = {
                    role: "tool",
                    tool_call_id: tc.id,
                    content: ""
                };

                const toolRes = await (async () => {
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

                if ((<iface.ToolAction> toolRes).response) {
                    const act = <iface.ToolAction> toolRes;
                    msg.content = act.response;
                    if (act.meta)
                        msg._meta = act.meta;
                } else {
                    msg.content = <any> toolRes;
                }

                /* MCP is allowed to send images in an alt format that we
                 * don't/can't support. */
                if (msg.content instanceof Array) {
                    for (const partT of msg.content) {
                        const part = <any> partT;
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

        } else {
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
async function completeAssistant(conv: iface.Conversation) {
    const msg = conv.inProgress = <iface.Message> {
        role: "assistant",
        content: ""
    };

    let inThought = false;
    let currentFunctionIdx = -1;

    try {
        const inputMessages = await proc.dataFixup(conv.messages);

        // Set up our query with the settings
        const req: any = {
            model: config.model,
            stream: true,
            messages: inputMessages,
            tools: Object.values(KAIL.tools).filter(x => x.enabled).map(x => x.schema)
        };

        // Other request parameters
        if (config.reqParams)
            Object.assign(req, config.reqParams);


        // Query the AI
        const reqInit: RequestInit = {
            method: "POST",
            headers: {
                "content-type": "application/json"
            },
            body: JSON.stringify(req)
        };
        let f = await fetch(`${KAIL.host}/v1/chat/completions`, reqInit);

        if (f.status === 413 /* content too large */) {
            // Try lossy
            req.messages = await proc.lossyConversation(inputMessages);
            reqInit.body = JSON.stringify(req);
            f = await fetch(`${KAIL.host}/v1/chat/completions`, reqInit);
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
                if (!line || line === ":") continue;
                const parts = /^data: *(.*)/.exec(line);
                if (!parts) {
                    throw Error(
                        `Invalid data from completion server: ${JSON.stringify(line)}`
                    );
                }
                if (parts[1][0] === "[") continue;
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

                } else if (delta.content) {
                    msg.content += delta.content;
                    process.stdout.write(delta.content);

                } else if (
                    delta.content === null || Object.keys(delta).length === 0
                ) {
                    // Just a keepalive

                } else {
                    throw Error(JSON.stringify(delta));

                }
            }
        }

    } catch (ex) {
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
let conv: iface.Conversation = {
    id: 0,
    messages: []
};
if (convFile) {
    let exists = false;
    try {
        await fs.access(convFile);
        exists = true;
    } catch (ex) {}
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

} else if (promptFile) {
    conv.messages.push({
        role: "user",
        content: await fs.readFile(promptFile, "utf8")
    });

}

// And do the actual AI
await complete(conv);
