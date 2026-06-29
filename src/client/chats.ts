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

import { dce } from "./dom";
import * as events from "./events";
import * as iface from "./iface";
import "./public";
import * as ui from "./ui";

declare let KAIL: iface.KAIL;

declare let localforage: any;

const lf: any = localforage.createInstance({
    name: "kail"
});

let maxConversationId = -1;

/**
 * All current conversations.
 */
export const conversations: Record<number, iface.Conversation> = await (async () => {
    const cv = <number[] | null> await lf.getItem("conversations");
    const ret = <Record<number, iface.Conversation>> Object.create(null);
    if (!cv) return ret;
    for (const id of cv) {
        const cvi = <iface.Conversation> await lf.getItem(`conv${id}`);
        if (!cvi) continue;
        cvi.id = id;
        if (id > maxConversationId)
            maxConversationId = id;
        ret[id] = cvi;
    }
    return ret;
})();

interface ConversationButton {
    box: HTMLElement;
    title: HTMLElement;
    dl: HTMLElement;
    del: HTMLElement;
}

/**
 * The buttons in the chat list for each conversation.
 */
export const conversationButtons: Record<number, ConversationButton> =
    Object.create(null);

/**
 * Create a chat list box element for a conversation.
 * @param conv  Conversation to create a box for
 * @returns Object containing the box element and its sub-elements
 */
function chatListBox(conv: iface.Conversation): ConversationButton {
    const box = dce("div");
    box.className = "chat-item";
    box.innerHTML = `
        <svg class="chat-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9a2 2 0 0 1-2 2H4l-3 3V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2z"/></svg>
        <span class="chat-item-label"></span>
        <div class="chat-item-actions">
            <button class="chat-action-btn" title="Download as JSON">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8M5 7l3 3 3-3"/><rect x="2" y="11" width="12" height="3" rx="1"/></svg>
            </button>
            <button class="chat-action-btn danger" title="Delete conversation">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 4 4 14 12 14 13 4"/><line x1="2" y1="4" x2="14" y2="4"/><path d="M6 4V2h4v2"/></svg>
            </button>
        </div>`;
    if (ui.chatList.hasChildNodes())
        ui.chatList.insertBefore(box, ui.chatList.children[0]);
    else
        ui.chatList.appendChild(box);

    box.onclick = () => {
        for (const chat of ui.chatList.children)
            chat.classList.remove("active");
        box.classList.add("active");
        ui.setCurrentConversation(conv);
        ui.setCursor(null);
    };

    const title = <HTMLElement> box.children[1];
    title.innerText = title.title = conv.name || (conv.id + "");

    const dl = <HTMLElement> box.children[2].children[0];
    dl.onclick = () => {
        const fn = `${conv.id}.json`;
        const file = new File([
            JSON.stringify(conv, null, 2)
        ], fn, {
            type: "application/json"
        });
        const url = URL.createObjectURL(file);
        const a = dce("a");
        a.href = url;
        a.download = fn;
        a.click();
        URL.revokeObjectURL(url);
    };

    const del = <HTMLElement> box.children[2].children[1];
    del.onclick = ev => {
        const yes = confirm(`Are you sure? “${conv.name || conv.id}” will be deleted and cannot be recovered unless you've backed it up.`);
        if (!yes)
            return;

        ev.stopPropagation();

        // Remove the conversation
        box.remove();
        delete conversations[conv.id]
        delete conversationButtons[conv.id];
        lf.removeItem(`conv${conv.id}`);

        // And clear the UI if it's current
        if (ui.currentConversation === conv)
            newConversation();
    };

    const ret = {
        box,
        title,
        dl,
        del
    };
    conversationButtons[conv.id] = ret;
    return ret;
}

/**
 * Push a conversation to the conversation list.
 * @param conv  Conversation to push
 */
export async function convListPush(conv: iface.Conversation) {
    return chatListBox(conv);
}

for (const convId in conversations)
    await convListPush(conversations[convId]);

// Watch for conversation names to change
events.events.addEventListener("conversation.name", (ev: any) => {
    const conv: iface.Conversation = ev.detail.conv;
    const name = conv.name || (conv.id + "");
    const btn = conversationButtons[conv.id];
    if (btn)
        btn.title.innerText = btn.title.title = name;

    if (conv === ui.currentConversation)
        ui.currentChatTitle.innerText = name;
});

/**
 * Start a new conversation. Does *not* add it to any lists, as it doesn't
 * formally exist until it has messages in it.
 */
export async function newConversation() {
    for (const chat of ui.chatList.children)
        chat.classList.remove("active");
    ui.setCurrentConversation({
        id: -1,
        messages: []
    });
    ui.setCursor(null);
}

ui.newChatBtn.onclick = newConversation;
newConversation();

/**
 * Push a message to a conversation. Will also push the conversation to the
 * conversation list if applicable.
 * @param conv  Conversation to modify
 * @param msg  Message to push
 */
export async function convPush(conv: iface.Conversation, msg: iface.Message | null) {
    if (msg)
        conv.messages.push(msg);

    if (conv.id < 0) {
        conv.id = ++maxConversationId;
        conversations[conv.id] = conv;

        if (ui.currentConversation === conv)
            ui.currentChatTitle.innerText = conv.name || (conv.id+"");

        const btn = await convListPush(conv);
        for (const chat of ui.chatList.children)
            chat.classList.remove("active");
        btn.box.classList.add("active");

        const ids = Object.keys(conversations).map(x => +x);
        await lf.setItem("conversations", ids);
    }
    await lf.setItem(`conv${conv.id}`, conv);
}


// Ability to upload conversations
ui.chatUploadBtn.onchange = async () => {
    for (const file of ui.chatUploadBtn.files!) {
        try {
            const conv = JSON.parse(await file.text());
            if (!(conv.messages instanceof Array))
                throw Error("This does not appear to be a conversation");
            conv.id = -1;

            ui.setCurrentConversation(conv);
            await convPush(conv, null);

        } catch (ex) {
            alert(`Error loading ${file.name}: ${ex}`);

        }
    }
}


// Settings live here because this is where all saving and loading goes
const models: string[] = await (async () => {
    try {
        const f = await fetch("/v1/models");
        const m = await f.json();
        return m.data.map((x: any) => x.id);
    } catch (ex) {
        console.error(ex);
        return ["default"];
    }
})();

for (const model of models) {
    const opt = dce("option");
    opt.value = model;
    opt.innerText = model;
    ui.settings.model.appendChild(opt);
}

// Generic settings saving
async function settingValue(
    el: HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement,
    save: string
) {
    el.addEventListener("change", () => {
        lf.setItem(`settings-${save}`, el.value);
    });

    const saved = await lf.getItem(`settings-${save}`);
    if (typeof saved === "string")
        el.value = saved;
}

async function settingCheckbox(el: HTMLInputElement, save: string) {
    el.addEventListener("change", () => {
        lf.setItem(`settings-${save}`, el.checked);
    });

    const saved = await lf.getItem(`settings-${save}`);
    if (typeof saved === "boolean")
        el.checked = saved;
}


// Model saving
async function onModelChange() {
    KAIL.model = ui.settings.model.value;
    ui.modelBadge.innerText = ui.settings.model.value;
};

await settingValue(ui.settings.model, "model");
ui.settings.model.onchange = onModelChange;
if (!ui.settings.model.value)
    ui.settings.model.value = models[0];
onModelChange();

// Other settings
await settingCheckbox(ui.settings.forceName, "force-name");
await settingValue(ui.settings.reqParams, "req-parameters");
await settingCheckbox(ui.settings.toolsEnabled, "tools-enabled");


// Add a toggle for a tool
async function settingAddTool(
    groupId: string, group: iface.ToolGroup, tool: iface.Tool
) {
    // First set up the group box
    let groupBox: HTMLElement;
    let groupDefaultChk: HTMLInputElement;
    if (!ui.settings.toolGroupSegs[groupId]) {
        groupBox = ui.settings.toolGroupSegs[groupId] = dce("div");
        groupBox.innerHTML = `
            <div class="settings-section-title">Tool: ${group.name}</div>
        `;
        ui.settings.toolsSeg.appendChild(groupBox);

        const groupDefault = dce("div");
        groupDefault.className = "settings-row";
        groupDefault.innerHTML = `
            <div class="settings-row-info">
                <div class="settings-row-label">Default for ${group.name.replace(/[^a-zA-Z0-9: _-]/g, "_")}</div>
                <div class="settings-row-desc">Enable this tool group by default?</div>
            </div>
            <label class="toggle">
                <input type="checkbox" ${ui.settings.toolsEnabled.checked ? "checked " : ""}/>
                <span class="toggle-slider"></span>
            </label>
        `;
        groupBox.appendChild(groupDefault);

        groupDefaultChk = <HTMLInputElement> groupDefault.children[1].children[0];
        await settingCheckbox(groupDefaultChk, `tool-group-enabled-${groupId}`);

    } else {
        groupBox = ui.settings.toolGroupSegs[groupId];
        groupDefaultChk = <HTMLInputElement> groupBox.children[1].children[1].children[0];
    }

    const box = dce("div");
    box.className = "settings-row";
    box.innerHTML = `
        <div class="settings-row-info">
            <div class="settings-row-label">${tool.name.replace(/[^a-zA-Z0-9_-]/g, "_")}</div>
        </div>
        <label class="toggle">
            <input type="checkbox" ${groupDefaultChk.checked ? "checked " : ""}/>
            <span class="toggle-slider"></span>
        </label>
    `;
    groupBox.appendChild(box);

    const el = <HTMLInputElement> box.children[1].children[0];
    await settingCheckbox(el, `tool-enabled-${tool.name}`);
    el.onchange = () => {
        tool.enabled = el.checked;
    };
    tool.enabled = el.checked;

    events.events.addEventListener("tools-enabled-default", (_: Event) => {
        el.checked = ui.settings.toolsEnabled.checked;
        el.dispatchEvent(new Event("change"));

        groupDefaultChk.checked = ui.settings.toolsEnabled.checked;
        groupDefaultChk.dispatchEvent(new Event("change"));
    });

    groupDefaultChk.addEventListener("change", _ => {
        el.checked = groupDefaultChk.checked;
        el.dispatchEvent(new Event("change"));
    });
}

events.events.addEventListener("register-tool", (ev: any) => {
    settingAddTool(ev.detail.groupId, ev.detail.group, ev.detail.tool);
});

// Change all tools when the default is changed
ui.settings.toolsEnabled.onchange = () => {
    events.dispatch("tools-enabled-default", null);
};
