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

declare let KAIL: iface.KAIL;

// See if we can use the filesystem
const fsBase = await fs.getFilesystemBase("images");

// Get the list of models first
const models: Record<string, string[]> = await (async () => {
    const f = await fetch(`${KAIL.host}/tools/comfy/models`);
    return await f.json();
})();

/**
 * Get an image from a file.
 * @param conv  Conversation
 * @param file  Filename
 * @returns Image URL, or empty string if not found
 */
async function getImage(conv: iface.Conversation, file: string) {
    return await fs.readFile(conv, fsBase, file) || "";
}


/**
 * Tool function for AI image generation.
 * @param conv  Conversation
 * @param arg  JSON string with generation parameters
 * @returns Generated image as message content, or error string
 */
async function toolImageGeneration(
    conv: iface.Conversation, arg: string
): Promise<iface.ToolResponse> {
    const f = await fetch(`${KAIL.host}/tools/comfy/image_generation`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: arg
    });
    const r = await f.text();
    try {
        return await fs.saveImage(conv, fsBase, JSON.parse(r));
    } catch (ex) {
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
async function toolImageEdit(
    conv: iface.Conversation, argS: string
): Promise<iface.ToolResponse> {
    // Get the image
    const arg = JSON.parse(argS);
    const image: string = await getImage(conv, arg.image);

    if (!image) {
        // Image not found!
        return `ERROR: Image ${arg.image} not found`;
    }

    arg.image = image;

    const f = await fetch(`${KAIL.host}/tools/comfy/image_edit`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify(arg)
    });
    const r = await f.text();
    try {
        return await fs.saveImage(conv, fsBase, JSON.parse(r));
    } catch (ex) {
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
async function toolImageEditMask(
    conv: iface.Conversation, argS: string
): Promise<iface.ToolResponse> {
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

    const f = await fetch(`${KAIL.host}/tools/comfy/image_edit_mask`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify(arg)
    });
    const r = await f.text();
    try {
        return await fs.saveImage(conv, fsBase, JSON.parse(r));
    } catch (ex) {
        console.error(ex);
        return r;
    }
}


KAIL.registerToolGroup("comfy", "ComfyUI");


// Set up our tools
if (models["image-generation"] && models["image-generation"].length) {
    KAIL.registerTool("comfy", <iface.Tool> {
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
    KAIL.registerTool("comfy", <iface.Tool> {
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
    KAIL.registerTool("comfy", <iface.Tool> {
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
                            description:"Filename of the image to edit."
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
