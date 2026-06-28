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
// See if we can use the filesystem
const fsBase = await getFilesystemBase("images");
// Get the list of models first
const models = await (async () => {
    const f = await fetch("/tools/comfy/models");
    return await f.json();
})();
/**
 * Get an image from a file.
 * @param conv  Conversation
 * @param file  Filename
 * @returns Image URL, or empty string if not found
 */
async function getImage(conv, file) {
    return await readFile(conv, fsBase, file) || "";
}
/**
 * Tool function for AI image generation.
 * @param conv  Conversation
 * @param arg  JSON string with generation parameters
 * @returns Generated image as message content, or error string
 */
async function toolImageGeneration(conv, arg) {
    const f = await fetch("/tools/comfy/image_generation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: arg
    });
    const r = await f.text();
    try {
        return await saveImage(conv, fsBase, JSON.parse(r));
    }
    catch (ex) {
        console.error(ex);
        return r;
    }
}
/**
 * Tool function for AI image editing.
 * @param conv  Conversation to get the source image from
 * @param argS  JSON string with edit parameters including image index
 * @returns Edited image as message content, or error string
 */
async function toolImageEdit(conv, argS) {
    // Get the image
    const arg = JSON.parse(argS);
    const image = await getImage(conv, arg.image);
    if (!image) {
        // Image not found!
        return `ERROR: Image ${arg.image} not found`;
    }
    arg.image = image;
    const f = await fetch("/tools/comfy/image_edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(arg)
    });
    const r = await f.text();
    try {
        return await saveImage(conv, fsBase, JSON.parse(r));
    }
    catch (ex) {
        console.error(ex);
        return r;
    }
}
/**
 * Tool function for AI masked image editing.
 * @param conv  Conversation to get source image and mask from
 * @param argS  JSON string with edit parameters including image and mask indices
 * @returns Edited image as message content, or error string
 */
async function toolImageEditMask(conv, argS) {
    // Get the image
    const arg = JSON.parse(argS);
    const image = await getImage(conv, arg.image);
    if (!image) {
        return `ERROR: Image ${arg.image} not found`;
    }
    const mask = await getImage(conv, arg.mask);
    if (!mask) {
        return `ERROR: Mask image ${arg.mask} not found`;
    }
    arg.image = image;
    arg.mask = mask;
    const f = await fetch("/tools/comfy/image_edit_mask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(arg)
    });
    const r = await f.text();
    try {
        return await saveImage(conv, fsBase, JSON.parse(r));
    }
    catch (ex) {
        console.error(ex);
        return r;
    }
}
KAIL.registerToolGroup("comfy", "ComfyUI");
// Set up our tools
if (models["image-generation"] && models["image-generation"].length) {
    KAIL.registerTool("comfy", {
        name: "image_generation",
        enabled: true,
        function: toolImageGeneration,
        schema: {
            type: "function",
            function: {
                name: "image_generation",
                description: "Use AI to generate an image.",
                parameters: {
                    type: "object",
                    properties: {
                        model: {
                            type: "string",
                            enum: models["image-generation"],
                            description: "Model to use. May be omitted to use the default model."
                        },
                        prompt: {
                            type: "string",
                            description: "A caption for the image to generate (the prompt)."
                        },
                        width: {
                            type: "number",
                            description: "Width in pixels of image to generate."
                        },
                        height: {
                            type: "number",
                            description: "Height in pixels of image to generate."
                        },
                        seed: {
                            type: "number",
                            description: "Optional random seed, for reproducible results. If provided, must be between 0 and 0x7fffffff (i.e., a 31-bit integer). If absent, a random seed will be used."
                        }
                    }
                },
                required: ["prompt"]
            },
            strict: true
        }
    });
}
if (models["image-edit"] && models["image-edit"].length) {
    KAIL.registerTool("comfy", {
        name: "image_edit",
        enabled: true,
        function: toolImageEdit,
        schema: {
            type: "function",
            function: {
                name: "image_edit",
                description: "Use AI to edit an image.",
                parameters: {
                    type: "object",
                    properties: {
                        model: {
                            type: "string",
                            enum: models["image-edit"],
                            description: "Model to use. May be omitted to use the default model."
                        },
                        image: {
                            type: "string",
                            description: "Filename of the image to edit."
                        },
                        prompt: {
                            type: "string",
                            description: "The instruction on how to edit the image."
                        },
                        seed: {
                            type: "number",
                            description: "Optional random seed, for reproducible results. If provided, must be between 0 and 0x7fffffff (i.e., a 31-bit integer). If absent, a random seed will be used."
                        }
                    }
                },
                required: ["image", "prompt"]
            },
            strict: true
        }
    });
}
if (models["image-edit-mask"] && models["image-edit-mask"].length) {
    KAIL.registerTool("comfy", {
        name: "image_edit_mask",
        enabled: true,
        function: toolImageEditMask,
        schema: {
            type: "function",
            function: {
                name: "image_edit_mask",
                description: "Use AI to edit an image in a specified region or regions. Use a mask to specify the region. White pixels will be modified; black pixels will be left unmodified. Grey pixels will be modified partially. You can use `run_js`'s canvas functionality to create a mask.",
                parameters: {
                    type: "object",
                    properties: {
                        model: {
                            type: "string",
                            enum: models["image-edit-mask"],
                            description: "Model to use. May be omitted to use the default model."
                        },
                        image: {
                            type: "string",
                            description: "Filename of the image to edit."
                        },
                        mask: {
                            type: "string",
                            description: "Mask region(s) to edit, given by a mask image file."
                        },
                        prompt: {
                            type: "string",
                            description: "The instruction on how to edit the image. Note that the mask does not direct the instruction, it only prevents the editing model from editing outside the mask, so the instruction must still either be specific about what region of the image you intend to edit, or describe edits that would affect the entire image."
                        },
                        seed: {
                            type: "number",
                            description: "Optional random seed, for reproducible results. If provided, must be between 0 and 0x7fffffff (i.e., a 31-bit integer). If absent, a random seed will be used."
                        }
                    }
                },
                required: ["image", "mask", "prompt"]
            },
            strict: true
        }
    });
}
