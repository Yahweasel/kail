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

declare let KAIL: iface.KAIL;

/**
 * Utility function to get the string from a tool result.
 */
function toolString(res: iface.ToolResponse) {
    let res2: string | iface.MessageContent[];
    if ((<iface.ToolAction> res).response)
        res2 = (<iface.ToolAction> res).response;
    else
        res2 = <string | iface.MessageContent[]> res;

    if (typeof res2 === "string") {
        return res2;

    } else {
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
export let filesystemBase: string | null = null;

// See if the filesystem is supported
{
    try {
        const mcp = "./mcp.mjs";
        // @ts-ignore
        await import(mcp);
        if (
            KAIL.tools.read_file &&
            KAIL.tools.write_file &&
            KAIL.tools.list_allowed_directories &&
            KAIL.tools.list_directory &&
            KAIL.tools.create_directory
        ) {
            // Check where we're allowed
            const res = toolString(await KAIL.tools.list_allowed_directories.function(
                <any> null, "{}"
            ));
            const allowed = res.split("\n").filter(x => x.startsWith("/"));

            if (allowed.length)
                filesystemBase = allowed[0];
        }
    } catch (ex) {}
}

/**
 * Get a filesystem base for your files if possible.
 */
export async function getFilesystemBase(name: string): Promise<string | null> {
    if (!filesystemBase)
        return null;

    const base = `${filesystemBase}/${name}`;
    await KAIL.tools.create_directory.function(
        <any> null, JSON.stringify({path: base})
    );

    return base;
}

/**
 * Read a file.
 * @param base  Base directory, treated like cwd
 * @param file  File to read
 */
export async function readFile(base: string, file: string): Promise<string | null> {
    if (!file.startsWith("/"))
        file = `${base}/${file}`;
    const cont = toolString(await KAIL.tools.read_file.function(
        <any> null, JSON.stringify({path: file})
    ));
    if (/^error:/i.test(cont))
        return null;
    return cont;
}

/**
 * Write a file.
 * @param base  Base directory, treated like cwd
 * @param file  File to write
 * @param data  Data to write to the file
 */
export async function writeFile(
    base: string, file: string, data: string
): Promise<void> {
    if (!file.startsWith("/"))
        file = `${base}/${file}`;
    await KAIL.tools.write_file.function(
        <any> null, JSON.stringify({path: file, content: data})
    );
}

/**
 * List a directory.
 * @param base  Base directory, treated like cwd
 * @param dir  Directory to list
 */
export async function listDir(base: string, dir: string): Promise<string[]> {
    if (!dir.startsWith("/"))
        dir = `${base}/${dir}`;
    const cont = toolString(await KAIL.tools.list_directory.function(
        <any> null, JSON.stringify({path: dir})
    ));
    const ret: string[] = [];
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
export async function writeFreshFile(
    base: string, prefix: string, suffix: string, data: string
): Promise<string> {
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
export async function saveImage(
    base: string | null, msg: string | iface.MessageContent[]
) {
    if (!base || typeof msg === "string")
        return msg;

    for (const part of msg) {
        if (part.type !== "image_url")
            continue;
        const file = await writeFreshFile(
            base, "image", ".b64", part.image_url.url
        );
        msg.push({
            type: "text",
            text: `Image written to file: ${file}`
        });
    }

    return msg;
}

