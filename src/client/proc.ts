/*
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

import * as iface from "./iface";

// Cache of images converted to lossy formats
const lossyImageCache: WeakMap<
    iface.MessageContentImage, iface.MessageContentImage
> = new WeakMap();

/**
 * Convert an image to a lossy format (JPEG/WebP) for compatibility with
 * models that have data size limits.
 * @param image  Image to convert
 * @returns The image, possibly in a lossy format
 */
async function lossyImage(
    image: iface.MessageContentImage
): Promise<iface.MessageContentImage> {
    if (lossyImageCache.has(image))
        return lossyImageCache.get(image)!;

    // 1. Convert it to an Image
    const img = new Image();
    img.src = image.image_url.url;
    {
        const ok = await new Promise<boolean>(res => {
            img.onload = () => res(true);
            img.onerror = () => res(false);
        });
        if (!ok) {
            lossyImageCache.set(image, image);
            return image;
        }
    }

    // 2. Draw it on a canvas
    const canvas = new OffscreenCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);

    // 3. Try formats
    let ret: string | null = null;
    async function tryFormat(mime: string, quality: number) {
        const blob = await canvas.convertToBlob({
            type: mime,
            quality
        });
        if (!blob.type.startsWith(mime))
            return false;

        const rdr = new FileReader();
        const rdrP = new Promise<boolean>(res => {
            rdr.onload = () => {
                ret = <string> rdr.result;
                res(true);
            };
            rdr.onerror = () => res(false);
        });
        rdr.readAsDataURL(blob);
        return await rdrP;
    }
    //(await tryFormat("image/webp", 0.8)) ||
        (await tryFormat("image/jpeg", 0.9));

    if (ret) {
        const lossy: iface.MessageContentImage = {
            type: "image_url",
            image_url: {url: ret}
        };
        lossyImageCache.set(image, lossy);
        return lossy;

    } else {
        lossyImageCache.set(image, image);
        return image;

    }
}

/**
 * Convert all images in a conversation to lossy formats for compatibility.
 * @param conv  Conversation to convert
 * @returns Copy of conversation with lossy images
 */
export async function lossyConversation(conv: iface.Message[]): Promise<iface.Message[]> {
    const ret: iface.Message[] = [];

    for (const c of conv) {
        if (
            typeof c.content === "string" ||
            c.content.findIndex(x => x.type === "image_url") < 0
        ) {
            ret.push(c);
            continue;
        }

        const cc: iface.Message = <any> {};
        Object.assign(cc, c);
        cc.content = [];

        for (const part of c.content) {
            if (part.type !== "image_url") {
                cc.content.push(part);
                continue;
            }
            cc.content.push(await lossyImage(part));
        }

        ret.push(cc);
    }

    return ret;
}

/**
 * Fix up data in messages for compatibility. Removes hidden messages and
 * metadata, and removes data: URI headers from audio and video data for
 * llama.cpp compatibility.
 * @param conv  Conversation to fix up
 * @returns Copy of conversation with fixed up data URLs
 */
export async function dataFixup(conv: iface.Message[]): Promise<iface.Message[]> {
    const ret: iface.Message[] = [];

    let skipCount = 0;
    function skipMsg() {
        if (skipCount <= 0)
            return;
        ret.push({
            role: "user",
            content: `SYSTEM MESSAGE: ${skipCount} messages have been elided for context room.`
        });
        skipCount = 0;
    }

    for (const c of conv) {
        if (c.kail_hidden) {
            skipCount++;
            continue;
        }
        skipMsg();

        if (typeof c.content === "string") {
            ret.push(c);
            continue;
        }

        const cc: iface.Message = <any> {};
        Object.assign(cc, c);
        cc.content = [];

        for (const part of c.content) {
            const pp = <any> {};
            Object.assign(pp, part);
            delete pp._meta;
            cc.content.push(pp);

            if (
                part.type === "input_audio" ||
                part.type === "input_video"
            ) {
                let url: string;
                if (part.type === "input_audio")
                    url = part.input_audio.url;
                else
                    url = part.input_video.url;
                const data = {
                    data: url.slice(url.indexOf(",") + 1)
                };

                if (part.type === "input_audio")
                    pp.input_audio = data;
                else
                    pp.input_video = data;
            }

        }

        ret.push(cc);
    }

    skipMsg();

    return ret;
}

