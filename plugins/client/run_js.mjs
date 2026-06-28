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
/**
 * Utility function to get the string from a tool result.
 */
function toolString(res) {
    let res2;
    if (res.response)
        res2 = res.response;
    else
        res2 = res;
    if (typeof res2 === "string") {
        return res2;
    }
    else {
        for (const part of res2) {
            if (part.type === "text")
                return part.text;
        }
        return "";
    }
}
/**
 * Utility function to expand a return message into its largest form.
 */
function expandMessage(msg) {
    if (typeof msg === "string") {
        return {
            response: [{
                    type: "text",
                    text: msg
                }]
        };
    }
    else if (msg instanceof Array) {
        return {
            response: msg
        };
    }
    else {
        if (typeof msg.response === "string") {
            msg.response = [{
                    type: "text",
                    text: msg.response
                }];
        }
        return msg;
    }
}
/**
 * Utility function to combine a base directory and filename.
 */
function baseFile(base, file) {
    if (file.startsWith("/"))
        return file;
    if (base.endsWith("/"))
        return `${base}${file}`;
    return `${base}/${file}`;
}
/**
 * Filesystem base to use for non-FS tools.
 */
let filesystemBase = null;
// See if the filesystem is supported
{
    try {
        const mcp = "./mcp.mjs";
        // @ts-ignore
        await import(mcp);
        if (KAIL.tools.read_file &&
            KAIL.tools.write_file &&
            KAIL.tools.list_allowed_directories &&
            KAIL.tools.list_directory &&
            KAIL.tools.create_directory) {
            // Check where we're allowed
            const res = toolString(await KAIL.tools.list_allowed_directories.function(null, "{}"));
            const allowed = res.split("\n").filter(x => x.startsWith("/"));
            if (allowed.length)
                filesystemBase = allowed[0];
        }
    }
    catch (ex) { }
}
/**
 * Get a filesystem base for your files.
 */
async function getFilesystemBase(name) {
    if (!filesystemBase)
        return `/${name}`;
    const base = `${filesystemBase}/${name}`;
    await KAIL.tools.create_directory.function(null, JSON.stringify({ path: base }));
    return base;
}
/**
 * Read a file.
 * @param conv  Conversation to read from
 * @param base  Base directory, treated like cwd
 * @param file  File to read
 * @returns File content, or null if not present
 */
async function readFile(conv, base, file) {
    file = baseFile(base, file);
    if (!filesystemBase) {
        // No real filesystem, check the history
        for (let mi = conv.messages.length - 1; mi >= 0; mi--) {
            const msg = conv.messages[mi];
            if (!msg._meta || !msg._meta.fs)
                continue;
            if (file in msg._meta.fs)
                return msg._meta.fs[file];
        }
        return null;
    }
    const cont = toolString(await KAIL.tools.read_file.function(null, JSON.stringify({ path: file })));
    if (/^error:/i.test(cont))
        return null;
    return cont;
}
/**
 * Write a file.
 * @param info  Information on the file to write
 * @param msg  What to return to the user by default
 * @param type  How to describe the data in the return message
 * @returns Message to be sent with saved location
 */
async function writeFile(info, msg, type) {
    let { base, file, data } = info;
    file = baseFile(base, file);
    const out = expandMessage(msg);
    if (!filesystemBase) {
        // Pseudo-FS, put it in _meta
        out.meta = out.meta || {};
        out.meta.fs = {};
        out.meta.fs[file] = data;
    }
    else {
        // Real FS
        await KAIL.tools.write_file.function(null, JSON.stringify({ path: file, content: data }));
    }
    out.response.push({
        type: "text",
        text: `${type} written to file: ${file}`
    });
    return out;
}
/**
 * List a directory.
 * @param conv  Previous conversation
 * @param base  Base directory, treated like cwd
 * @param dir  Directory to list
 * @returns Directory content
 */
async function listDir(conv, base, dir) {
    dir = baseFile(base, dir);
    const ret = [];
    if (!filesystemBase) {
        // Pseudo-FS
        const dirSlash = `${dir}/`;
        for (const msg of conv.messages) {
            if (!msg._meta || !msg._meta.fs)
                continue;
            for (const file in msg._meta.fs) {
                if (file.startsWith(dirSlash)) {
                    ret.push(file.slice(dirSlash.length));
                }
            }
        }
    }
    else {
        // Real FS
        const cont = toolString(await KAIL.tools.list_directory.function(null, JSON.stringify({ path: dir })));
        for (const line of cont.split("\n")) {
            const parts = /^\[[^\]]*\] (.*)/.exec(line);
            if (!parts)
                continue;
            ret.push(parts[1]);
        }
    }
    return ret;
}
/**
 * Write a fresh file, given by a prefix and extension. A numeric, counting
 * suffix will be added to avoid conflicts.
 * @param conv  Previous conversation
 * @param info  Information on the file to write
 * @param msg  What to return to the user by default
 * @param type  How to describe the data in the return message
 * @returns Message to be sent with saved location
 */
async function writeFreshFile(conv, info, msg, type) {
    let { base, prefix, suffix, data } = info;
    const list = await listDir(conv, base, base);
    for (let idx = 0;; idx++) {
        const fn = `${prefix}-${idx.toString().padStart(6, "0")}${suffix}`;
        if (list.indexOf(fn) >= 0)
            continue;
        return await writeFile({
            base,
            file: fn,
            data
        }, msg, type);
    }
}
/**
 * `saveFreshImage for saving image data already contained in a message.
 * @param conv  Previous conversation
 * @param base  Filesystem base to save to
 * @param msg  Current message to be sent
 * @returns Message to be sent with saved location
 */
async function saveImage(conv, base, msg) {
    if (typeof msg === "string")
        return msg;
    let msgContent;
    if (msg instanceof Array)
        msgContent = msg;
    else if (typeof msg.response === "string")
        return msg;
    else
        msgContent = msg.response;
    for (const part of msgContent) {
        if (part.type !== "image_url")
            continue;
        msg = await writeFreshFile(conv, {
            base,
            prefix: "image",
            suffix: ".b64",
            data: part.image_url.url
        }, msg, "Image");
    }
    return msg;
}

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
const fsBase = await getFilesystemBase("images");
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
 * @param image  Image filename
 */
async function sendImage(w, conv, image) {
    const imageStr = await readFile(conv, fsBase, image);
    // Now convert the image string into an ImageBitmap we can transfer
    let ib = null;
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
async function jsTool(conv, arg) {
    const argObj = JSON.parse(arg);
    // Do the code on a worker
    const w = new Worker(`data:application/javascript,${encodeURIComponent(workerSrc)}`, { type: "module" });
    const wRetP = new Promise(res => {
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
    w.postMessage({ src: argObj.src });
    // Wait for their response
    const wRet = await Promise.race([
        wRetP,
        new Promise(res => setTimeout(() => res({ error: "Timeout" }), 30000))
    ]);
    w.terminate();
    // If there was an error, that's it
    if (wRet.error)
        return `ERROR: ${wRet.error}`;
    if (wRet.img) {
        // Turn the blob into a data URL
        const rdr = new FileReader();
        const dataP = new Promise(res => {
            rdr.onload = () => res(rdr.result);
        });
        rdr.readAsDataURL(wRet.img);
        const data = await dataP;
        // And make it into a message
        return await saveImage(conv, fsBase, [{
                type: "image_url",
                image_url: { url: data }
            }]);
    }
    else {
        // Just give them the returned value
        if (typeof wRet.ret === "undefined")
            return "undefined";
        else
            return JSON.stringify(wRet.ret);
    }
}
KAIL.registerToolGroup("run_js", "Run JavaScript");
KAIL.registerTool("run_js", {
    name: "run_js",
    enabled: true,
    function: jsTool,
    schema: {
        type: "function",
        function: {
            name: "run_js",
            description: `Run JavaScript code. The JavaScript code you provide will be run as the body of an async function, and whatever that function returns will be returned to you. You *must* return at the end of your code; you will not receive the value of the last statement, only whatever is returned.

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

You have access to image files with \`await image(name)\`, where \`name\` is the filename of an image file. \`await image(name)\` returns an ImageBitmap.`,
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
