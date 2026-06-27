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

import * as fs from "./fs-helper";

import type * as iface from "../client/iface";

const fsBase = await fs.getFilesystemBase("images");

// Source for the worker to run any JS code
const workerSrc = `
    delete globalThis.Worker;
    delete globalThis.SharedWorker;
    delete globalThis.fetch;
    delete globalThis.XMLHttpRequest;

    globalThis.document = {
        createElement: x => {
            if (x === "canvas") return new OffscreenCanvas(1024, 1024);
            return null;
        },

        getElementById: x => {
            if (x === "canvas") return new OffscreenCanvas(1024, 1024);
            return null;
        }
    };

    const AsyncFunction = (async function() {}).constructor;

    const init = await new Promise(res => {
        addEventListener("message", ev => res(ev.data));
    });

    globalThis.image = function(image) {
        postMessage({c: "image", image});
        return new Promise(res => {
            addEventListener("message", ev => res(ev.data), {once: true});
        });
    };

    try {
        const code = AsyncFunction(init.src);
        const ret = await code();

        if (ret instanceof OffscreenCanvas) {
            const img = await ret.convertToBlob();
            postMessage({c: "done", img});
        } else {
            postMessage({c: "done", ret});
        }
    } catch (ex) {
        postMessage({c: "done", error: ex + ""});
    }
`;

/**
 * Send an image from the conversation to a worker.
 * @param w  Worker to send the image to
 * @param conv  Conversation to get the image from
 * @param image  Image name or index
 */
async function sendImage(
    w: Worker, conv: iface.Conversation, image: number | string
) {
    let imageStr: string | null = null;

    if (typeof image === "string" && fsBase) {
        imageStr = await fs.readFile(fsBase, image);

    } else if (typeof image === "number" && image >= 0) {
        let idx = image;
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

    } else if (typeof image === "number") {
        let idx = image;
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
    let ib: ImageBitmap | null = null;
    if (typeof imageStr === "string") {
        const f = await fetch(imageStr);
        const blob = await f.blob();
        ib = await createImageBitmap(blob);
    }

    // And send it
    if (ib)
        w.postMessage(ib, [ib]);
    else
        w.postMessage(ib);
}

/**
 * Tool function to run JavaScript code in a sandboxed worker.
 * @param conv  Conversation to get images from (if needed)
 * @param arg  JSON string with "src" property containing JavaScript source
 * @returns Execution result or error string
 */
async function jsTool(
    conv: iface.Conversation, arg: string
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

    // Prepare to send images back
    w.addEventListener("message", ev => {
        if (ev.data.c === "image")
            sendImage(w, conv, ev.data.image);
    });

    // Start the code
    w.postMessage({src: argObj.src});

    // Wait for their response
    const wRet = await Promise.race([
        wRetP,
        new Promise(res => setTimeout(() => res({error: "Timeout"}), 30000))
    ]);
    w.terminate();

    // If there was an error, that's it
    if (wRet.error)
        return `ERROR: ${wRet.error}`;

    if (wRet.img) {
        // Turn the blob into a data URL
        const rdr = new FileReader();
        const dataP = new Promise(res => {
            rdr.onload = () => res(rdr.result!);
        });
        rdr.readAsDataURL(wRet.img);
        const data = await dataP;

        // And make it into a message
        return await fs.saveImage(fsBase, [<iface.MessageContentImage> {
            type: "image_url",
            image_url: {url: data}
        }]);

    } else {
        // Just give them the returned value
        if (typeof wRet.ret === "undefined")
            return "undefined";
        else
            return JSON.stringify(wRet.ret);

    }
}

declare let KAIL: iface.KAIL;

KAIL.registerToolGroup("run_js", "Run JavaScript");

KAIL.registerTool("run_js", {
    name: "run_js",
    enabled: true,
    function: jsTool,
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

Use this for both simple calculation and executing code. The sandbox the code is run in has no access to the DOM or any other modules.

You have access to OffscreenCanvas. If you return an OffscreenCanvas, it will be converted to an image and returned. In this way, you can use this tool to draw.

` + (fsBase
    ? `You have access to image files with \`await image(name)\`, where \`name\` is the filename of an image file. \`await image(name)\` returns an ImageBitmap.`
    : `You have access to previous images in the conversation with \`await image(idx)\`, where \`idx\` is the index of the previous image. Index 0 is the first image in the conversation, index 1 is the second, etc. You can also use negative indices to index from the end, e.g., the most recent image is -1, the second most recent is -2, etc. You should use negative indices whenever possible. \`await image(idx)\` returns an ImageBitmap.`
),
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
