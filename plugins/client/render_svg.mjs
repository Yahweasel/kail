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
/**
 * Tool function to render SVG to a raster image.
 * @param conv  Conversation
 * @param arg  JSON string with "svg" property containing SVG data
 * @returns Rendered image as message content, or error string
 */
async function render_svg(conv, arg) {
    const argObj = JSON.parse(arg);
    let blob = new Blob([
        argObj.svg
    ], {
        type: "image/svg+xml"
    });
    // Load it as an image
    const img = new Image();
    const imgP = new Promise(res => {
        img.onload = () => res(null);
        img.onerror = ev => res(ev + "");
    });
    img.src = URL.createObjectURL(blob);
    {
        const err = await imgP;
        if (typeof err === "string")
            return err;
    }
    // Draw it on a canvas
    const canvas = new OffscreenCanvas(img.width || 320, img.height || 240);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    blob = await canvas.convertToBlob();
    // Turn the blob into a data URL
    const rdr = new FileReader();
    const dataP = new Promise(res => {
        rdr.onload = () => res(rdr.result);
    });
    rdr.readAsDataURL(blob);
    const data = await dataP;
    // And make it into a message
    return await saveImage(conv, fsBase, [{
            type: "image_url",
            image_url: { url: data }
        }]);
}
/**
 * SVG rendering tool definition.
 */
const render_svg_tool = {
    name: "render_svg",
    enabled: true,
    function: render_svg,
    schema: {
        type: "function",
        function: {
            name: "render_svg",
            description: "Render an SVG to a raster image.",
            parameters: {
                type: "object",
                properties: {
                    svg: {
                        type: "string",
                        description: "The SVG data."
                    }
                }
            },
            required: ["svg"]
        },
        strict: true
    }
};
KAIL.registerToolGroup("render_svg", "Render SVG");
KAIL.registerTool("render_svg", render_svg_tool);
