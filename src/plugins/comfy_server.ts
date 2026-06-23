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

import type * as iface from "../server/iface";

import * as fs from "fs/promises";
import * as http from "http";

declare let KAIL: iface.KAIL;

const config = JSON.parse(await fs.readFile("config/comfy/config.json", "utf8"));

// Models as they're supposed to appear in JSON
interface ModelImageGeneration {
    type: "image-generation";
    model: {
        name: string,
        megapixels: number,
        default_width: number,
        default_height: number,
        vae_scale: number
    };
    properties: {
        prompt: string,
        width: string,
        height: string,
        seed: string,
        output: string
    };
    workflow: any;
}

interface ModelImageEdit {
    type: "image-edit";
    model: {
        name: string,
        megapixels: number,
        vae_scale: number
    };
    properties: {
        input: string,
        prompt: string,
        seed: string,
        output: string
    };
    workflow: any;
}

interface ModelImageEditMask {
    type: "image-edit-mask";
    model: {
        name: string,
        megapixels: number,
        vae_scale: number
    };
    properties: {
        input: string,
        mask: string,
        prompt: string,
        seed: string,
        output: string
    };
    workflow: any;
}

type Model = ModelImageGeneration | ModelImageEdit | ModelImageEditMask;

const models = {
    "image-generation":
        <Record<string, ModelImageGeneration>> Object.create(null),
    "image-edit":
        <Record<string, ModelImageEdit>> Object.create(null),
    "image-edit-mask":
        <Record<string, ModelImageEditMask>> Object.create(null),
};


// Read in all available models
for (const file of await fs.readdir("config/comfy/workflows")) {
    const model = <Model> JSON.parse(await fs.readFile(
        `config/comfy/workflows/${file}`, "utf8"
    ));

    switch (model.type) {
        case "image-generation":
            models["image-generation"][model.model.name] = model;
            break;

        case "image-edit":
            models["image-edit"][model.model.name] = model;
            break;

        case "image-edit-mask":
            models["image-edit-mask"][model.model.name] = model;
            break;
    }
}


// Helper function to round to a VAE-OK scale
function vaeRound(x: number, vaeScale: number) {
    x = Math.round(x / vaeScale) * vaeScale;
    if (x <= 0)
        x = vaeScale;
    return x;
}

// Generic "maybe seed" to use a seed if set or random otherwise
function maybeSeed(seed: any) {
    if (
        typeof seed === "number" &&
        ~~seed === seed &&
        seed >= 0 &&
        seed <= 0x7fffffff
    ) {
        return seed;
    }

    return ~~(Math.random() * 0x7fffffff);
}

// Generic setter for a path
function pathSet(obj: any, path: string, value: any) {
    const parts = path.split(".");
    const last = parts.pop()!;
    for (const part of parts)
        obj = obj[part];
    obj[last] = value;
}

// Helper function to make the actual request
async function comfyCall(res: http.ServerResponse, workflow: any) {
    try {
        // Then make our request
        const f = await fetch(`${config.host}/generate/sync`, {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({
                input: {
                    workflow_json: workflow,
                    return_outputs_as_base64: true
                }
            })
        });
        const ret = await f.json();

        // Check that we have the data
        if (
            !ret || !ret.output || !ret.output[0] ||
            !ret.output[0].data || !ret.output[0].mimetype
        ) {
            console.error(ret);
            res.writeHead(500);
            res.end("Unexpected error generating image")
            return;
        }
        const out = ret.output[0];

        // And make our response
        res.writeHead(200, {"content-type": "application/json"});
        res.end(JSON.stringify([{
            type: "image_url",
            image_url: {url: `data:${out.mimetype};base64,${out.data}`}
        }]));

    } catch (ex) {
        res.writeHead(500);
        res.end(`Unexpected error generating image: ${ex}`);

    }
}


// Prepare our proxies
async function proxy(req: http.IncomingMessage, res: http.ServerResponse) {
    // Read in the body
    let body: any = null;
    try {
        const parts: Buffer[] = [];
        req.on("data", chunk => parts.push(chunk));
        await new Promise(res => req.on("end", res));
        const bodyRaw = Buffer.concat(parts);
        body = JSON.parse(bodyRaw.toString("utf8"));
    } catch (ex) {}

    switch (req.url) {
        case "/models":
        {
            // List all available models
            const ret: Record<string, string[]> = {};
            for (const key in <any> models)
                ret[key] = Object.keys((<any> models)[key]);
            res.writeHead(200, {"content-type": "application/json"});
            res.end(JSON.stringify(ret));
            break;
        }

        case "/image_generation":
        {
            if (!body || !body.prompt) {
                res.writeHead(500);
                res.end("Improperly formatted request");
                break;
            }

            // Make sure there are image-generation models
            if (Object.keys(models["image-generation"]).length === 0) {
                res.writeHead(500);
                res.end("Image generation not supported");
                break;
            }

            // Make sure they used a valid model
            let modelName = Object.keys(models["image-generation"])[0];
            if (typeof body.model === "string")
                modelName = body.model;
            const model = models["image-generation"][modelName];
            if (!model) {
                res.writeHead(500);
                res.end(`Unrecognized model ${modelName}`);
                break;
            }

            // Handle options
            const workflow = JSON.parse(JSON.stringify(
                model.workflow
            ));
            pathSet(workflow, model.properties.prompt, body.prompt);
            if (typeof body.width === "number") {
                pathSet(
                    workflow, model.properties.width,
                    vaeRound(body.width, model.model.vae_scale)
                );
            }
            if (typeof body.height === "number") {
                pathSet(
                    workflow, model.properties.height,
                    vaeRound(body.height, model.model.vae_scale)
                );
            }
            pathSet(workflow, model.properties.seed, maybeSeed(body.seed));

            await comfyCall(res, workflow);

            break;
        }

        case "/image_edit":
        {
            if (!body || !body.image || !body.prompt) {
                res.writeHead(500);
                res.end("Improperly formatted request");
                break;
            }

            // Make sure there are image-edit models
            if (Object.keys(models["image-edit"]).length === 0) {
                res.writeHead(500);
                res.end("Image editing not supported");
                break;
            }

            // Make sure they used a valid model
            let modelName = Object.keys(models["image-edit"])[0];
            if (typeof body.model === "string")
                modelName = body.model;
            const model = models["image-edit"][modelName];
            if (!model) {
                res.writeHead(500);
                res.end(`Unrecognized model ${modelName}`);
                break;
            }

            // Handle options
            const workflow = JSON.parse(JSON.stringify(
                model.workflow
            ));
            pathSet(workflow, model.properties.input, body.image);
            pathSet(workflow, model.properties.prompt, body.prompt);
            pathSet(workflow, model.properties.seed, maybeSeed(body.seed));

            await comfyCall(res, workflow);

            break;
        }

        case "/image_edit_mask":
        {
            if (!body || !body.image || !body.mask || !body.prompt) {
                res.writeHead(500);
                res.end("Improperly formatted request");
                break;
            }

            // Make sure there are image-edit-mask models
            if (Object.keys(models["image-edit-mask"]).length === 0) {
                res.writeHead(500);
                res.end("Masked image editing not supported");
                break;
            }

            // Make sure they used a valid model
            let modelName = Object.keys(models["image-edit-mask"])[0];
            if (typeof body.model === "string")
                modelName = body.model;
            const model = models["image-edit-mask"][modelName];
            if (!model) {
                res.writeHead(500);
                res.end(`Unrecognized model ${modelName}`);
                break;
            }

            // Handle options
            const workflow = JSON.parse(JSON.stringify(
                model.workflow
            ));
            pathSet(workflow, model.properties.input, body.image);
            pathSet(workflow, model.properties.mask, body.mask);
            pathSet(workflow, model.properties.prompt, body.prompt);
            pathSet(workflow, model.properties.seed, maybeSeed(body.seed));

            await comfyCall(res, workflow);

            break;
        }

        default:
            res.writeHead(404);
            res.end("Tool not found");
    }
}


KAIL.registerTool(<iface.Tool> {
    name: "comfy",
    enabled: true,
    function: proxy
});
