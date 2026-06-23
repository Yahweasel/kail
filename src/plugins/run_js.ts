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

import type * as iface from "../client/iface";

// Source for the worker to run any JS code
const workerSrc = `
    delete globalThis.Worker;
    delete globalThis.SharedWorker;
    delete globalThis.fetch;
    delete globalThis.XMLHttpRequest;

    const AsyncFunction = (async function() {}).constructor;

    const init = await new Promise(res => {
        addEventListener("message", ev => res(ev.data));
    });

    if (init.canvas) {
        globalThis.canvas = init.canvas;

        globalThis.image = function(idx) {
            postMessage({c: "image", idx});
            return new Promise(res => {
                addEventListener("message", ev => res(ev.data), {once: true});
            });
        };
    }

    let ret = null;
    let error = null;
    try {
        const code = AsyncFunction(init.src);
        ret = await code();
    } catch (ex) {
        error = ex + "";
    }

    if (init.canvas) {
        const img = await init.canvas.convertToBlob();
        postMessage({c: "done", img, error});
    } else {
        postMessage({c: "done", ret, error});
    }
`;

// Function to send an image from this conversation to the worker
async function sendImage(w: Worker, conv: iface.Conversation, idx: number) {
    let imageStr: string | null = null;

    if (idx >= 0) {
        msgLoop1:
        for (const msg of conv.messages) {
            if (typeof msg.content === "string")
                continue;
            for (const c of msg.content) {
                if (c.type !== "image_url")
                    continue;
                if (idx-- === 0) {
                    imageStr = c.image_url.url;
                    break msgLoop1;
                }
            }
        }

    } else {
        msgLoop2:
        for (let mi = conv.messages.length - 1; mi >= 0; mi--) {
            const msg = conv.messages[mi];
            if (typeof msg.content === "string")
                continue;
            for (let ci = msg.content.length - 1; ci >= 0; ci--) {
                const c = msg.content[ci];
                if (c.type !== "image_url")
                    continue;
                if (++idx === 0) {
                    imageStr = c.image_url.url;
                    break msgLoop2;
                }
            }
        }

    }

    // Now convert the image string into an ImageBitmap we can transfer
    let image: ImageBitmap | null = null;
    if (typeof imageStr === "string") {
        const f = await fetch(imageStr);
        const blob = await f.blob();
        image = await createImageBitmap(blob);
    }

    // And send it
    if (image)
        w.postMessage(image, [image]);
    else
        w.postMessage(image);
}

async function jsTool(
    conv: iface.Conversation, arg: string, useCanvas: boolean
): Promise<string | iface.MessageContent[]> {
    const argObj = JSON.parse(arg);

    // Do the code on a worker
    const w = new Worker(
        `data:application/javascript,${encodeURIComponent(workerSrc)}`,
        {type: "module"}
    );
    const wRetP = new Promise<any>(res => {
        w.addEventListener("message", ev => {
            if (ev.data.c === "done")
                res(ev.data);
        });
    });

    if (useCanvas) {
        // Prepare to send images back
        w.addEventListener("message", ev => {
            if (ev.data.c === "image")
                sendImage(w, conv, ev.data.idx);
        });

        // Start the code
        const canvas = new OffscreenCanvas(1024, 1024);
        w.postMessage({canvas, src: argObj.src}, [canvas]);

    } else {
        // Start the code
        w.postMessage({src: argObj.src});

    }

    // Wait for their response
    const wRet = await Promise.race([
        wRetP,
        new Promise(res => setTimeout(() => res({error: "Timeout"}), 30000))
    ]);
    w.terminate();

    // If there was an error, that's it
    if (wRet.error)
        return `ERROR: ${wRet.error}`;

    if (useCanvas) {
        // Turn the blob into a data URL
        const rdr = new FileReader();
        const dataP = new Promise(res => {
            rdr.onload = () => res(rdr.result!);
        });
        rdr.readAsDataURL(wRet.img);
        const data = await dataP;

        // And make it into a message
        return [<iface.MessageContentImage> {
            type: "image_url",
            image_url: {url: data}
        }];

    } else {
        // Just give them the returned value
        if (typeof wRet.ret === "undefined")
            return "undefined";
        else
            return JSON.stringify(wRet.ret);

    }
}

declare let KAIL: iface.KAIL;

KAIL.registerTool({
    name: "run_js",
    enabled: true,
    function: (conv, arg) => jsTool(conv, arg, false),
    schema: {
        type: "function",
        function: {
            name: "run_js",
            description:
`Run JavaScript code. The JavaScript code you provide will be run as the body of an async function, and whatever that function returns will be returned to you. You *must* return at the end of your code; you will not receive the value of the last statement, only whatever is returned.

Examples:
\`\`\`javascript
// WRONG: Returns undefined
let x = 21;
x * 2;
\`\`\`

\`\`\`javascript
// CORRECT: Returns 42
let x = 21;
return x * 2;
\`\`\`

Use this for both simple calculation and executing code. The sandbox the code is run in has no access to the DOM or any other modules.`,
            parameters: {
                type: "object",
                properties: {
                    src: {
                        type: "string",
                        description: "The JavaScript source to run. May be asynchronous (use await)."
                    }
                }
            },
            required: ["src"]
        },
        strict: true
    }
});

KAIL.registerTool({
    name: "js_canvas",
    enabled: true,
    function: (conv, arg) => jsTool(conv, arg, true),
    schema: {
        type: "function",
        function: {
            name: "js_canvas",
            description: "Use a JavaScript OffscreenCanvas to draw. You are given an OffscreenCanvas of size 1024x1024 (though you may change its size) in the global variable `canvas`, and can draw on it using any canvas techniques available. Make sure to create a rendering context first.\n\nThe return from this tool is an image representing the result of drawing on the canvas, and if your code had an error, the error message.\n\nThe code can access previous images with `await image(idx)`, where `idx` is the index of the previous image. Index 0 is the first image in the conversation, index 1 is the second, etc. You can also use negative indices to index from the end, e.g., the most recent image is -1, second most recent is -2, etc. You should use negative indices whenever possible.",
            parameters: {
                type: "object",
                properties: {
                    src: {
                        type: "string",
                        description: "The JavaScript source to run. May be asynchronous (use await)."
                    }
                }
            },
            required: ["src"]
        },
        strict: true
    }
});
