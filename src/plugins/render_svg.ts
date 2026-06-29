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

if (typeof Image === "undefined")
    throw Error("The render_svg tool requires the web client.");

const fsBase = await fs.getFilesystemBase("images");

/**
 * Tool function to render SVG to a raster image.
 * @param conv  Conversation
 * @param arg  JSON string with "svg" property containing SVG data
 * @returns Rendered image as message content, or error string
 */
async function render_svg(
    conv: iface.Conversation, arg: string
): Promise<iface.ToolResponse> {
    const argObj = JSON.parse(arg);

    let blob = new Blob([
        argObj.svg
    ], {
        type: "image/svg+xml"
    });

    // Load it as an image
    const img = new Image();
    const imgP = new Promise<string | null>(res => {
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
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    blob = await canvas.convertToBlob();

    // Turn the blob into a data URL
    const rdr = new FileReader();
    const dataP = new Promise(res => {
        rdr.onload = () => res(rdr.result!);
    });
    rdr.readAsDataURL(blob);
    const data = await dataP;

    // And make it into a message
    return await fs.saveImage(conv, fsBase, [<iface.MessageContentImage> {
        type: "image_url",
        image_url: {url: data}
    }]);
}

/**
 * SVG rendering tool definition.
 */
const render_svg_tool: iface.Tool = {
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

declare let KAIL: iface.KAIL;
KAIL.registerToolGroup("render_svg", "Render SVG");
KAIL.registerTool("render_svg", render_svg_tool);
