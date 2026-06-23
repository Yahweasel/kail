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

const workerSrc = `
    const init = await new Promise(res => {
        addEventListener("message", ev => res(ev.data));
    });
    globalThis.canvas = init.canvas;
    globalThis.image = function(idx) {
        postMessage({c: "image", idx});
        return new Promise(res => {
            addEventListener("message", ev => res(ev.data), {once: true});
        });
    };
    let error = null;
    try {
        const code = encodeURIComponent(
            "await (async () => {\\n" +
            init.src +
            "\\n})();\\n"
        );
        await import(\`data:application/javascript,\${code}\`);
    } catch (ex) {
        error = ex + "";
    }
    const img = await init.canvas.convertToBlob();
    postMessage({c: "done", img, error});
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

async function js_canvas(
    conv: iface.Conversation, arg: string
): Promise<string | iface.MessageContent[]> {
    const argObj = JSON.parse(arg);

    // Do the code on a worker
    const w = new Worker(
        `data:application/javascript,${encodeURIComponent(workerSrc)}`,
        {type: "module"}
    );
    const wRetP = new Promise(res => {
        w.addEventListener("message", ev => {
            if (ev.data.c === "done")
                res(ev.data);
        });
    });

    // Prepare to send images back
    w.addEventListener("message", ev => {
        if (ev.data.c === "image")
            sendImage(w, conv, ev.data.idx);
    });


    const canvas = new OffscreenCanvas(1024, 1024);
    w.postMessage({canvas, src: argObj.src}, [canvas]);

    // Wait for their response
    const wRet = <any> await wRetP;
    w.terminate();

    // Turn the blob into a data URL
    const rdr = new FileReader();
    const dataP = new Promise(res => {
        rdr.onload = () => res(rdr.result!);
    });
    rdr.readAsDataURL(wRet.img);
    const data = await dataP;

    // And make it into a message
    const ret: iface.MessageContent[] = [<iface.MessageContentImage> {
        type: "image_url",
        image_url: {url: data}
    }];

    if (wRet.error) {
        // The AI never understands if the image is also here
        return `ERROR: ${wRet.error}`;
        /*
        ret.push(<iface.MessageContentText> {
            type: "text",
            text: `ERROR: ${wRet.error}`
        });
        */
    }

    return ret;
}

const js_canvas_tool = <iface.Tool> {
    name: "js_canvas",
    enabled: true,
    function: js_canvas,
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
};

declare let KAIL: iface.KAIL;
KAIL.registerTool(js_canvas_tool);
