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

import { dce, gebi } from "./dom";
import * as events from "./events";
import * as icons from "./icons";
import * as iface from "./iface";

import * as smd from "streaming-markdown";

/**
 * The chat list container element.
 */
export const chatList = gebi("chat-list")!;
/**
 * The chat upload button for loading conversations from JSON files.
 */
export const chatUploadBtn =
    <HTMLInputElement> gebi("json-upload-input")!;
/**
 * The new chat button to start a new conversation.
 */
export const newChatBtn = gebi("new-chat-btn")!;
/**
 * The sidebar container element.
 */
export const sidebar = gebi("sidebar")!;
/**
 * The button to toggle sidebar visibility.
 */
export const sidebarBtn = gebi("toggle-sidebar-btn")!;
/**
 * The header title showing the current chat name.
 */
export const currentChatTitle = gebi("header-title")!;
/**
 * The model badge showing the current model (header).
 */
export const currentModelBadge = gebi("model-badge")!;
/**
 * The messages container element.
 */
export const messages = gebi("messages")!;

/**
 * The input attachments container for displaying media attachments.
 */
export const inputAttachments = gebi("input-attachments")!;
/**
 * Buttons for selecting who to post as (user, assistant, tool, system).
 */
export const inputPostAsBtns: Record<string, HTMLElement> = {
    user: gebi("post-as-user-btn")!,
    assistant: gebi("post-as-assistant-btn")!,
    tool: gebi("post-as-tool-btn")!,
    system: gebi("post-as-system-btn")!
};
/**
 * Current role for posting messages.
 */
export let inputPostAs: "user" | "assistant" | "tool" | "system" = "user";
/**
 * The button to toggle manual mode.
 */
export const manualToggleBtn = gebi("manual-toggle-btn")!;
/**
 * The hint element shown when manual mode is active.
 */
export const inputHintManualMode = gebi("input-hint-manual-mode")!;
/**
 * Whether manual mode is active (AI does not auto-complete).
 */
export let manualMode = false;

/**
 * The input shell container element.
 */
export const inputShell = gebi("input-shell")!;
/**
 * The message input textarea.
 */
export const inputMessage =
    <HTMLTextAreaElement> gebi("message-input")!;
/**
 * The file input button for attaching files.
 */
export const inputAttachBtn = <HTMLInputElement> gebi("file-input")!;
/**
 * The send button for submitting messages.
 */
export const inputSendBtn = gebi("send-btn")!;
/**
 * The stop button for cancelling ongoing completions.
 */
export const stopBtn = gebi("stop-btn")!;

/**
 * The model badge showing the current model.
 */
export const modelBadge = gebi("model-badge")!;
/**
 * The image element in the lightbox viewer.
 */
export const lightboxImg = <HTMLImageElement> gebi("lightbox-img")!;
/**
 * The lightbox container element.
 */
export const lightbox = gebi("lightbox")!;
/**
 * The lightbox close button.
 */
export const lightboxClose = gebi("lightbox-close")!;

/**
 * Settings UI elements.
 */
export const settings = {
    /**
     * First settings button (in header).
     */
    btn1: gebi("settings-btn")!,
    /**
     * Second settings button.
     */
    btn2: gebi("settings-btn2")!,
    /**
     * Settings overlay panel.
     */
    overlay: gebi("settings-overlay")!,
    /**
     * Settings close button.
     */
    close: gebi("settings-close-btn")!,

    /**
     * Tools settings section.
     */
    toolsSeg: gebi("cfg-tools")!,

    /**
     * Settings sections for each tool group.
     */
    toolGroupSegs: <Record<string, HTMLElement>> Object.create(null),

    /**
     * Model to use.
     */
    model: <HTMLSelectElement> gebi("model-select")!,

    /**
     * Force the model to set a name.
     */
    forceName: <HTMLInputElement> gebi("cfg-force-name")!,

    /**
     * Other request parameters (JSON).
     */
    reqParams: <HTMLTextAreaElement> gebi("cfg-req-parameters")!,

    /**
     * Tools enabled by default?
     */
    toolsEnabled: <HTMLInputElement> gebi("cfg-tools-enabled")!,
};

/**
 * The conversation currently visible in the UI.
 */
export let currentConversation: iface.Conversation =
    <iface.Conversation> <any> null;

/**
 * The cursor for any live updates. Here so that it can be removed if the
 * conversation is switched while it's being drawn.
 */
export let cursor: HTMLElement | null = null;
/**
 * Set the cursor element for streaming updates.
 * @param to  The cursor element, or null to clear
 */
export function setCursor(to: HTMLElement | null) {
    cursor = to;
}


// Set up entity selection
{
    for (const entity in inputPostAsBtns) {
        inputPostAsBtns[entity].onclick = () => {
            inputPostAs = <any> entity;
            for (const other in inputPostAsBtns) {
                inputPostAsBtns[other].classList.toggle("selected", other === entity);
            }
            inputShell.className = `input-shell tint-${entity}`;
            inputSendBtn.className = `tint-${entity}`;
        };
    }
}

// And manual mode
manualToggleBtn.onclick = () => {
    manualMode = !manualMode;
    manualToggleBtn.classList.toggle("active", manualMode);
    inputHintManualMode.classList.toggle("visible", manualMode);
};


/**
 * Metadata for message entity types (label and icon).
 */
const entityMeta = {
  assistant: { label: 'Assistant', icon: icons.assistant },
  user:      { label: 'User',      icon: icons.user },
  tool:      { label: 'Tool',      icon: icons.tool },
  system:    { label: 'System',    icon: icons.system }
};

/**
 * Auto-resize the input textarea based on its content.
 */
export function inputAutoResize() {
    inputMessage.style.height = "auto";
    inputMessage.style.height =
        Math.min(inputMessage.scrollHeight, 200) + "px";
}

inputMessage.oninput = inputAutoResize;


// Helper function to use SMD as a one-shot Markdown tool
function markdown(target: HTMLElement, text: string) {
    const render = smd.default_renderer(target);
    const parser = smd.parser(render);
    smd.parser_write(parser, text);
    smd.parser_end(parser);
}

// Sidebar toggle
sidebarBtn.onclick = (_: MouseEvent) => {
    sidebar.classList.toggle("collapsed");
};


/**
 * Make a box for a message. Returns the actual message content part.
 * @param conv  Conversation the message belongs to
 * @param msg  Message to box
 * @param opts  Options (mainly about what else to include)
 */
export function mkMsgBox(
    conv: iface.Conversation, msg: iface.Message,
    opts: {
        /**
         * Replace an existing box instead of making a new one.
         */
        box?: HTMLElement,

        /**
         * Include action buttons? Default true.
         */
        actions?: boolean,

        /**
         * Include text (non-JSON) action buttons? Default true for non-tool,
         * false for tool.
         */
        text?: boolean
    } = {}
) {
    const box = opts.box || dce("div");

    let meta = entityMeta[msg.role] || entityMeta.assistant;
    const loadSteps: Promise<unknown>[] = [
        new Promise(res => setTimeout(res, 0))
    ];

    // Try to find what tool this is by looking earlier
    let suffix = "";
    if (msg.role === "tool") {
        msgLoop:
        for (const msg2 of conv.messages) {
            if (msg2.role !== "assistant" || !msg2.tool_calls)
                continue;
            for (const tc of msg2.tool_calls) {
                if (tc.id === msg.tool_call_id) {
                    suffix = `: ${tc.function.name}`;
                    break msgLoop;
                }
            }
        }
    }

    box.className = `msg-row entity-${msg.role}`;
    if (msg.kail_hidden)
        box.classList.add('kail-hidden');
    box.innerHTML = `
        <div class="msg-avatar">${meta.icon}</div>
        <div class="msg-content">
            <div class="msg-meta">
                <span class="msg-sender">${meta.label}${suffix}</span>
                <div class="msg-actions"></div>
            </div>
            <div class="msg-body"></div>
        </div>`;
    const body = <HTMLElement> box.children[1].children[1];

    const action = <HTMLElement> box.children[1].children[0].children[1];
    const actionBtns = {
        dlText: <HTMLElement | null> null,
        dlJSON: <HTMLElement | null> null,
        editText: <HTMLElement | null> null,
        editJSON: <HTMLElement | null> null,
        trunc: <HTMLElement | null> null,
        del: <HTMLElement | null> null
    };

    const ret = {
        box,
        body,
        action,
        actionBtns,
        load: <Promise<unknown>> <any> null
    };

    // Fill in the action buttons
    function actionBtn(svg: string, txt: string) {
        const ret = dce("button");
        ret.className = "msg-action-btn";
        ret.innerHTML = `${svg}<span>${txt}</span>`;
        action.appendChild(ret);
        return ret;
    }
    function actionSep() {
        const div = dce("div");
        div.className = "msg-actions-sep";
        action.appendChild(div);
    }

    if (opts.actions !== false) {
        const detail = {conv, msg, box: ret};
        if (opts.text !== false) {
            actionBtns.dlText = actionBtn(icons.download, "dl");
            actionBtns.dlText.onclick = () => events.dispatch("click-msg-dl", detail);
        }
        actionBtns.dlJSON = actionBtn(
            (opts.text !== false) ? icons.code : icons.download,
            (opts.text !== false) ? "JSON" : "dl"
        );
        actionBtns.dlJSON.onclick = () => events.dispatch("click-msg-dl-json", detail);
        actionSep();
        if (opts.text !== false) {
            actionBtns.editText = actionBtn(icons.edit, "edit");
            actionBtns.editText.onclick = () => events.dispatch("click-msg-edit", detail);
        }
        actionBtns.editJSON = actionBtn(
            (opts.text !== false) ? icons.code : icons.edit,
            (opts.text !== false) ? "JSON" : "edit"
        );
        actionBtns.editJSON.onclick = () => events.dispatch("click-msg-edit-json", detail);
        actionSep();
        // Hidden state toggle button
        const hiddenBtn = actionBtn(icons.hidden, msg.kail_hidden ? "show" : "hide");
        hiddenBtn.onclick = () => events.dispatch("click-msg-hidden-toggle", detail);
        actionSep();
        actionBtns.trunc = actionBtn(icons.trunc, "trunc");
        actionBtns.trunc.onclick = () => events.dispatch("click-msg-trunc", detail);
        actionBtns.del = actionBtn(icons.del, "del");
        actionBtns.del.onclick = () => events.dispatch("click-msg-del", detail);
    }


    if (msg.reasoning_content) {
        const rbox = mkCollapsible("reasoning");
        markdown(rbox.body, msg.reasoning_content);
        body.appendChild(rbox.box);
    }

    const content: iface.MessageContent[] = (typeof msg.content === "string")
        ? [{type: "text", text: msg.content}]
        : msg.content;

    for (const part of content) {
        switch (part.type) {
            case "text":
                if (msg.role === "tool") {
                    const tbox = mkCollapsible("tool");
                    body.appendChild(tbox.box);
                    tbox.body.innerText = part.text;
                } else {
                    const p = dce("p");
                    markdown(p, part.text);
                    body.appendChild(p);
                }
                break;

            case "image_url":
            {
                const img = dce("img");
                img.className = "msg-image";
                loadSteps.push(new Promise(res => {
                    img.onload = img.onerror = res;
                }));
                img.src = part.image_url.url;
                img.alt = "image";
                body.appendChild(img);

                img.onclick = () => openLightbox(part.image_url.url);
                break;
            }

            case "input_audio":
            {
                const audio = dce("audio");
                audio.controls = true;
                audio.src = part.input_audio.url;
                body.appendChild(audio);
                break;
            }

            case "input_video":
            {
                const video = dce("video");
                video.controls = true;
                loadSteps.push(new Promise(res => {
                    video.onload = video.onerror = res;
                }));
                video.src = part.input_video.url;
                body.appendChild(video);
                break;
            }
        }
    }

    if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
            const tbox = mkCollapsible(
                "tool-use", `: ${tc.function.name}`
            );
            tbox.body.innerText = tc.function.arguments;
            body.appendChild(tbox.box);
        }
    }

    if (!opts.box)
        messages.appendChild(box);

    ret.load = Promise.all(loadSteps);
    return ret;
}

// Show an image in the lightbox
function openLightbox(src: string) {
    lightboxImg.src = src;
    lightbox.classList.add("visible");
}

// Close the lightbox
function closeLightbox() {
    lightbox.classList.remove("visible");
}
lightbox.onclick = lightboxClose.onclick = closeLightbox;

/**
 * Set the current conversation and put its messages in the message area.
 * @param conv  Conversation to show
 */
export function setCurrentConversation(conv: iface.Conversation) {
    currentConversation = conv;
    messages.innerHTML = "";
    const loadSteps: Promise<unknown>[] = [];
    for (const message of conv.messages) {
        const box = mkMsgBox(conv, message);
        loadSteps.push(box.load);
    }

    let name = conv.name || (conv.id + "");
    if (!conv.name && name === "-1")
        name = "New chat";

    currentChatTitle.classList.remove("editing");
    currentChatTitle.contentEditable = "false";
    currentChatTitle.innerText = name;

    (async () => {
        await Promise.all(loadSteps);
        messages.scrollTop = messages.scrollHeight;
    })();

    inputMessage.select();
}

// Collapsible trigger
function toggleCollapsible(ev: MouseEvent) {
   (<HTMLElement> ev.target!).closest(".collapsible-block")!.classList.toggle("open");
}


/**
 * Build a collapsible box (reasoning, tool use)
 * @param type  Type of collapsible box. "tool-use" is for the assistant using a
 *              tool, and "tool" is the tool itself.
 * @param labelSuffix  Suffix to add to the label, e.g., the specific tool.
 * @returns Object containing the box element and body element
 */
export function mkCollapsible(
    type: "reasoning" | "tool-use" | "tool", labelSuffix: string = ""
) {
    const cls  = type === "reasoning" ? "reasoning" : "tool-use";
    const icon = type === "reasoning" ? icons.reasoning : icons.tool;
    const label = (
            type === "reasoning" ? "Reasoning" :
            type === "tool-use" ? "Tool call" :
            "Tool"
        ) + labelSuffix;
    const badge = type === "reasoning" ? "THINKING" : "TOOL";
    const box = dce("div");
    box.className = `collapsible-block ${cls}`;
    box.innerHTML = `
        <div class="collapsible-trigger">
            ${icon}
            <span class="block-label">${label}</span>
            <span class="block-badge">${badge}</span>
            <svg class="chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg>
        </div>
        <div class="collapsible-body"></div>`;
    (<HTMLElement> box.children[0]).onclick = toggleCollapsible;

    let body = <HTMLElement> box.children[1];
    if (type === "tool-use" || type === "tool") {
        const code = dce("code");
        body.appendChild(code);
        body = code;
    }

    return {box, body};
}


/**
 * Set up the stop button.
 */
export function stop(fn: (()=>unknown)|null) {
    stopBtn.classList.toggle("visible", !!fn);
    stopBtn.onclick = fn;
}


// Settings control
function openSettings() {
    settings.overlay.classList.add("visible");
}
/**
 * Close settings modal when clicking overlay.
 * @param ev  Click event
 */
function closeSettings(ev: Event) {
    if (ev.target === settings.overlay)
        closeSettingsDirect();
}
/**
 * Close settings modal directly.
 */
function closeSettingsDirect() {
    settings.overlay.classList.remove('visible');
}

settings.btn1.onclick = openSettings;
settings.btn2.onclick = openSettings;
settings.overlay.onclick = closeSettings;
settings.close.onclick = closeSettingsDirect;


// Allow the user to edit the chat name
currentChatTitle.onclick = () => {
    if (currentChatTitle.classList.contains("editing"))
        return;
    currentChatTitle.classList.add("editing");
    currentChatTitle.contentEditable = "true";
    currentChatTitle.focus();
    const range = document.createRange();
    range.selectNodeContents(currentChatTitle);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
};

currentChatTitle.onkeydown = (ev: KeyboardEvent) => {
    if (ev.key === "Enter") {
        ev.preventDefault();
        currentChatTitle.blur();
    }
};

currentChatTitle.onblur = (_: FocusEvent) => {
    if (!currentChatTitle.classList.contains("editing"))
        return;
    currentChatTitle.classList.remove("editing");
    currentChatTitle.contentEditable = "false";

    const title = currentChatTitle.textContent.trim();
    if (title)
        currentConversation.name = title;
    else
        delete currentConversation.name;

    events.dispatch("conversation.name", {conv: currentConversation});
};

// Escape is the ultimate closer
document.body.onkeydown = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
        ev.preventDefault();
        closeLightbox();
        closeSettingsDirect();
    }
};
