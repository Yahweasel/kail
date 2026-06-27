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
 * Get a filesystem base for your files if possible.
 */
async function getFilesystemBase(name) {
    if (!filesystemBase)
        return null;
    const base = `${filesystemBase}/${name}`;
    await KAIL.tools.create_directory.function(null, JSON.stringify({ path: base }));
    return base;
}
/**
 * Write a file.
 * @param base  Base directory, treated like cwd
 * @param file  File to write
 * @param data  Data to write to the file
 */
async function writeFile(base, file, data) {
    if (!file.startsWith("/"))
        file = `${base}/${file}`;
    await KAIL.tools.write_file.function(null, JSON.stringify({ path: file, content: data }));
}
/**
 * List a directory.
 * @param base  Base directory, treated like cwd
 * @param dir  Directory to list
 */
async function listDir(base, dir) {
    if (!dir.startsWith("/"))
        dir = `${base}/${dir}`;
    const cont = toolString(await KAIL.tools.list_directory.function(null, JSON.stringify({ path: dir })));
    const ret = [];
    for (const line of cont.split("\n")) {
        const parts = /^\[[^\]]*\] (.*)/.exec(line);
        if (!parts)
            continue;
        ret.push(parts[1]);
    }
    return ret;
}
/**
 * Write a fresh file, given by a prefix and extension. A numeric, counting
 * suffix will be added to avoid conflicts.
 * @param base  Base directory
 * @param prefix  File prefix, must not have directory indirection
 * @param suffix  File suffix
 * @param data  Data to write
 * @returns Full name of the written file
 */
async function writeFreshFile(base, prefix, suffix, data) {
    const list = await listDir(base, base);
    for (let idx = 0;; idx++) {
        const fn = `${prefix}-${idx.toString().padStart(6, "0")}${suffix}`;
        if (list.indexOf(fn) >= 0)
            continue;
        await writeFile(base, fn, data);
        return `${base}/${fn}`;
    }
}
/**
 * Save this image to the filesystem and report its location, if applicable.
 * @param base  Base directory. May be null, in which case this does nothing.
 * @param msg  Current message to be sent
 * @returns Message to be sent with saved location
 */
async function saveImage(base, msg) {
    if (!base || typeof msg === "string")
        return msg;
    for (const part of msg) {
        if (part.type !== "image_url")
            continue;
        const file = await writeFreshFile(base, "image", ".b64", part.image_url.url);
        msg.push({
            type: "text",
            text: `Image written to file: ${file}`
        });
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
 * @param _  Conversation (not used)
 * @param arg  JSON string with "svg" property containing SVG data
 * @returns Rendered image as message content, or error string
 */
async function render_svg(_, arg) {
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
    return await saveImage(fsBase, [{
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
