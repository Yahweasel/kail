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
// Get the list of models first
const models = await (async () => {
    const f = await fetch("/tools/comfy/models");
    return await f.json();
})();
/**
 * Get an image URL from the conversation by index.
 * @param conv  Conversation to search
 * @param imageIdx  Index of image (positive for forward, negative for backward)
 * @returns Image URL, or empty string if not found
 */
function getImage(conv, imageIdx) {
    if (imageIdx >= 0) {
        for (const msg of conv.messages) {
            if (typeof msg.content === "string")
                continue;
            for (const c of msg.content) {
                if (c.type !== "image_url")
                    continue;
                if (imageIdx-- === 0)
                    return c.image_url.url;
            }
        }
    }
    else {
        for (let mi = conv.messages.length - 1; mi >= 0; mi--) {
            const msg = conv.messages[mi];
            if (typeof msg.content === "string")
                continue;
            for (let ci = msg.content.length - 1; ci >= 0; ci--) {
                const c = msg.content[ci];
                if (c.type !== "image_url")
                    continue;
                if (++imageIdx === 0)
                    return c.image_url.url;
            }
        }
    }
    return "";
}
/**
 * Tool function for AI image generation.
 * @param _  Conversation (not used)
 * @param arg  JSON string with generation parameters
 * @returns Generated image as message content, or error string
 */
async function toolImageGeneration(_, arg) {
    const f = await fetch("/tools/comfy/image_generation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: arg
    });
    const r = await f.text();
    try {
        return JSON.parse(r);
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
    const image = getImage(conv, arg.image);
    if (!image) {
        // Image not found!
        return `ERROR: Image with index ${arg.image} not found`;
    }
    arg.image = image;
    const f = await fetch("/tools/comfy/image_edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(arg)
    });
    const r = await f.text();
    try {
        return JSON.parse(r);
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
    const image = getImage(conv, arg.image);
    if (!image) {
        return `ERROR: Image with index ${arg.image} not found`;
    }
    const mask = getImage(conv, arg.mask);
    if (!mask) {
        return `ERROR: Mask image with index ${arg.image} not found`;
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
        return JSON.parse(r);
    }
    catch (ex) {
        console.error(ex);
        return r;
    }
}
// Set up our tools
if (models["image-generation"] && models["image-generation"].length) {
    KAIL.registerTool({
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
    KAIL.registerTool({
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
                            type: "number",
                            description: "Image to edit. This is an index to the image in the current conversation. That is, the first image posted by any party in this conversation has index 0, the second has index 1, etc. You can also use negative indices to index from the end, e.g., the most recent image is -1, second most recent is -2, etc. You should use negative indices whenever possible."
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
    KAIL.registerTool({
        name: "image_edit_mask",
        enabled: true,
        function: toolImageEditMask,
        schema: {
            type: "function",
            function: {
                name: "image_edit_mask",
                description: "Use AI to edit an image in a specified region or regions. Use a mask to specify the region. White pixels will be modified; black pixels will be left unmodified. Grey pixels will be modified partially.",
                parameters: {
                    type: "object",
                    properties: {
                        model: {
                            type: "string",
                            enum: models["image-edit-mask"],
                            description: "Model to use. May be omitted to use the default model."
                        },
                        image: {
                            type: "number",
                            description: "Image to edit. This is an index to the image in the current conversation. That is, the first image posted by any party in this conversation has index 0, the second has index 1, etc. You can also use negative indices to index from the end, e.g., the most recent image is -1, second most recent is -2, etc. You should use negative indices whenever possible."
                        },
                        mask: {
                            type: "number",
                            description: "Mask region(s) to edit. An index to the image, like the image property."
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
