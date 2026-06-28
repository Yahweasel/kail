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
 * Utility function to expand a return message into its largest form.
 */
function expandMessage(
    msg: iface.ToolResponse
): iface.ToolAction & {response: iface.MessageContent[]} {
    if (typeof msg === "string") {
        return {
            response: [<iface.MessageContentText> {
                type: "text",
                text: msg
            }]
        };

    } else if (msg instanceof Array) {
        return {
            response: msg
        };

    } else {
        if (typeof msg.response === "string") {
            msg.response = [<iface.MessageContentText> {
                type: "text",
                text: msg.response
            }];
        }

        return <any> msg;

    }
}

/**
 * Utility function to combine a base directory and filename.
 */
function baseFile(base: string, file: string): string {
    if (file.startsWith("/"))
        return file;
    if (base.endsWith("/"))
        return `${base}${file}`;
    return `${base}/${file}`;
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
 * Get a filesystem base for your files.
 */
export async function getFilesystemBase(name: string): Promise<string> {
    if (!filesystemBase)
        return `/${name}`;

    const base = `${filesystemBase}/${name}`;
    await KAIL.tools.create_directory.function(
        <any> null, JSON.stringify({path: base})
    );

    return base;
}

/**
 * Read a file.
 * @param conv  Conversation to read from
 * @param base  Base directory, treated like cwd
 * @param file  File to read
 * @returns File content, or null if not present
 */
export async function readFile(
    conv: iface.Conversation, base: string, file: string
): Promise<string | null> {
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

    const cont = toolString(await KAIL.tools.read_file.function(
        <any> null, JSON.stringify({path: file})
    ));
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
export async function writeFile(
    info: {
        base: string,
        file: string,
        data: string
    },
    msg: iface.ToolResponse,
    type: string
): Promise<iface.ToolAction> {
    let {base, file, data} = info;
    file = baseFile(base, file);

    const out = expandMessage(msg);

    if (!filesystemBase) {
        // Pseudo-FS, put it in _meta
        out.meta = out.meta || {};
        out.meta.fs = {};
        out.meta.fs[file] = data;

    } else {
        // Real FS
        await KAIL.tools.write_file.function(
            <any> null, JSON.stringify({path: file, content: data})
        );

    }

    out.response.push(<iface.MessageContentText> {
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
export async function listDir(
    conv: iface.Conversation, base: string, dir: string
): Promise<string[]> {
    dir = baseFile(base, dir);

    const ret: string[] = [];

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

    } else {
        // Real FS
        const cont = toolString(await KAIL.tools.list_directory.function(
            <any> null, JSON.stringify({path: dir})
        ));
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
export async function writeFreshFile(
    conv: iface.Conversation,
    info: {
        base: string,
        prefix: string,
        suffix: string,
        data: string
    },
    msg: iface.ToolResponse,
    type: string
): Promise<iface.ToolAction> {
    let {base, prefix, suffix, data} = info;

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
export async function saveImage(
    conv: iface.Conversation, base: string, msg: iface.ToolResponse
): Promise<iface.ToolResponse> {
    if (typeof msg === "string")
        return msg;
    let msgContent: iface.MessageContent[];
    if (msg instanceof Array)
        msgContent = msg;
    else if (typeof msg.response === "string")
        return msg;
    else
        msgContent = msg.response;

    for (const part of msgContent) {
        if (part.type !== "image_url")
            continue;
        msg = await writeFreshFile(
            conv,
            {
                base,
                prefix: "image",
                suffix: ".b64",
                data: part.image_url.url
            },
            msg, "Image"
        );
    }

    return msg;
}

