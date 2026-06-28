KAIL (Keep AI Local, pronounced like Kyle or like kale) is an AI chat system for
people who like to tinker with AI rather than just use it, and people who think
of AI as autocomplete on steroids (i.e., what it is) rather than a
proto-intelligence. It allows a high level of control. It's intended only for
local use and has no provision for accounts, sharing, etc. All data is stored
in the browser.

One of the author's mottos with respect to AI is “always gaslight AI”. Thus,
part of the design of KAIL is to allow the user to change history, inject AI
messages, and otherwise do things that are not in the normal order of AI-user
interaction.


## Configuration

Copy the `config-example` directory to `config` and change anything you need to
suit you. Subdirectories of `config` are for plugins; if you don't intend to
use any plugins, you can remove them.


## Running and using

Install dependencies with `npm i` then run with `node server.mjs`. Connect to
http://localhost:8189 (or whatever port you've configured) with any web
browser.

All data is saved in your browser's local storage, not on the server. The
server is stateless.

The interface is similar to most other AI chat systems, just with some extra
options exposed.


## Building

Build with `make`, `npm run build`, or `rollup -c`.


## Plugins

KAIL has a plugin system for both server-side and client-side plugins.
Currently, plugins can only correspond to tools, and all tools are exposed to
the AI as generic function calls. The plugins are allowed to see the entire
conversation history, unlike MCP, which is useful for tools to, e.g., allow
editing previous images.

You can find the relevant interface in `src/client/iface.ts` for the client,
and `src/server/iface.ts` for the server. The interface `KAIL` is exposed
globally as the variable `KAIL`. Plugins should be in `plugins/client/*.mjs`
and `plugins/server/*.mjs`.

KAIL comes with several built-in plugins. The source for built-in plugins is in
`src/plugins`.

### MCP

The most obvious and necessary plugin is an MCP client. An example
configuration for using [this DuckDuckGo MCP
server](https://github.com/nickclyde/duckduckgo-mcp-server) is provided. For
HTTP MCP clients, set `url` instead of `command`.

If you load the standard filesystem server through MCP, the image plugins below
will save their images to the filesystem, and load images from the filesystem.
This can allow you to share images between conversations.

### Comfy

The `comfy` plugin provides image generation and editing through
[ComfyUI](https://github.com/Comfy-Org/ComfyUI/). In addition to ComfyUI
itself, it requires
[comfyui-api-wrapper](https://github.com/ai-dock/comfyui-api-wrapper).
Configure the port in `config/comfy/config.json`, and add any workflows you
need in the `workflows` subdirectory. Workflow examples are provided for Flux.2
Klein 4B.

Why not just use an MCP server for ComfyUI? Feel free to! But the answer is
that the `comfy` plugin can edit images generated earlier in the conversation,
even by other tools.

### JS and Canvas

The `run_js` plugin allows the AI to run JavaScript code (isolated in a
WebWorker), as well as produce images by drawing on a JavaScript canvas.

### SVG rendering

The `render_svg` plugin allows the AI to render SVG images as raster images.
This is mainly useful to provide some feedback from the (text-based) SVG
generation within the language component of the LLM to the vision component of
the LLM.
