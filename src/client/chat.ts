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

import * as ai from "./ai";
import * as chats from "./chats";
import { dce } from "./dom";
import * as events from "./events";
import * as iface from "./iface";
import * as ui from "./ui";

const attachments: string[] = [];

ui.inputAttachBtn.onchange = (_: Event) => {
    for (const file of Array.from(ui.inputAttachBtn.files!)) {
        const rdr = new FileReader();
        rdr.onload = (_: ProgressEvent<FileReader>) => {
            attachments.push(<string> rdr.result);
            renderAttachments();
        };
        rdr.readAsDataURL(file);
    }
    ui.inputAttachBtn.value = "";
};

/**
 * Render the attachment thumbnails in the input area.
 */
function renderAttachments() {
    ui.inputAttachments.innerHTML = "";
    attachments.forEach((data, idx) => {
        const box = dce("div");
        box.className = "attachment-thumb";

        if (/^data:audio/.test(data)) {
            const disp = dce("audio");
            disp.controls = true;
            disp.src = data;
            box.appendChild(disp);

        } else if (/^data:video/.test(data)) {
            const disp = dce("video");
            disp.controls = true;
            disp.src = data;
            box.appendChild(disp);

        } else {
            // Assume image
            const disp = dce("img");
            disp.src = data;
            disp.alt = "attachment";
            box.appendChild(disp);

        }

        const close = dce("button");
        close.className = "attachment-remove";
        close.onclick = () => {
            attachments.splice(idx, 1);
            renderAttachments();
        };
        close.innerText = "✕";
        box.appendChild(close);

        ui.inputAttachments.appendChild(box);
    });
    ui.inputAttachments.classList.toggle(
        "has-items", attachments.length > 0
    );
}

/**
 * Send the current input message.
 */
async function sendMessage() {
    const conv = ui.currentConversation;
    if (conv.inProgress) {
        // Can't send a message while another message is in progress
        return;
    }

    const text = ui.inputMessage.value.trim();
    ui.inputMessage.value = "";

    // Build the message content
    const content: iface.MessageContent[] = [];
    while (attachments.length) {
        const data = attachments.shift()!;

        if (/^data:audio/.test(data)) {
            content.push(<iface.MessageContentAudio> {
                type: "input_audio",
                input_audio: {url: data}
            });

        } else if (/^data:video/.test(data)) {
            content.push(<iface.MessageContentVideo> {
                type: "input_video",
                input_video: {url: data}
            });

        } else {
            // Assume image
            content.push(<iface.MessageContentImage> {
                type: "image_url",
                image_url: {url: data}
            });

        }
    }
    renderAttachments();

    const textContent: iface.MessageContentText = {
        type: "text",
        text
    };
    content.push(textContent);

    const msg: iface.Message = {
        role: ui.inputPostAs,
        content: content
    };

    // Handle special content
    if (ui.inputPostAs === "assistant") {
        // Can include thought
        const parts = /^\s*<think>([\s\S]*)<\/think>\s*([\s\S]*)/.exec(text);
        if (parts) {
            msg.reasoning_content = parts[1];
            textContent.text = parts[2];
        }

    } else if (ui.inputPostAs === "tool") {
        // Can include the ID
        const parts = /^\s*<id>([\s\S]*)<\/id>\s*([\s\S]*)/.exec(text);
        if (parts) {
            msg.tool_call_id = parts[1];
            textContent.text = parts[2];
        }

    }

    // Simple case
    if (msg.content.length === 1) {
        msg.content = (<iface.MessageContentText> content[0]).text;
    }

    ui.inputPostAsBtns.user.click();

    ui.inputAutoResize();
    await chats.convPush(conv, msg);
    const box = ui.mkMsgBox(conv, msg);
    await box.load;
    ui.messages.scrollTop = ui.messages.scrollHeight;
    await ai.complete(conv);
}

ui.inputMessage.onkeydown = function(ev: KeyboardEvent) {
    if (ev.key === "Enter" && !ev.shiftKey) {
        // Send message
        ev.preventDefault();
        sendMessage();
    }
}

ui.inputSendBtn.onclick = sendMessage;


/**
 * Download a message as a file.
 * @param conv  Conversation the message belongs to
 * @param msg  Message to download
 * @param json  Whether to download as JSON (true) or plain text (false)
 */
function downloadMessage(
    conv: iface.Conversation,
    msg: iface.Message,
    json: boolean
) {
    const name = `${conv.id}-${conv.messages.indexOf(msg)}.${json?"json":"txt"}`;

    let data: string;
    if (json) {
        data = JSON.stringify(msg, null, 2);

    } else {
        data = "";

        if (msg.reasoning_content)
            data += `<think>\n${msg.reasoning_content}\n</think>\n`;

        if (msg.tool_call_id)
            data += `<id>${msg.tool_call_id}</id>\n`;

        if (typeof msg.content === "string") {
            data += msg.content;
        } else {
            for (const part of msg.content) {
                if (part.type !== "text")
                    continue;
                data += part.text;
            }
        }

        if (msg.tool_calls) {
            for (const tool of msg.tool_calls) {
                data += `\n<tool>${tool.function.name}(${tool.function.arguments})</tool>`;
            }
        }

    }

    const file = new File([
        data
    ], name, {
        type: "application/json"
    });
    const url = URL.createObjectURL(file);
    const a = dce("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
}

events.events.addEventListener("click-msg-dl", (ev: any) => {
    downloadMessage(ev.detail.conv, ev.detail.msg, false);
});
events.events.addEventListener("click-msg-dl-json", (ev: any) => {
    downloadMessage(ev.detail.conv, ev.detail.msg, true);
});


/**
 * Edit a message, replacing its content with an editable textarea.
 * @param conv  Conversation the message belongs to
 * @param msg  Message to edit
 * @param box  Message box to replace with editor
 * @param json  Whether to edit as JSON (true) or plain text (false)
 */
function editMessage(
    conv: iface.Conversation,
    msg: iface.Message,
    box: ReturnType<typeof ui.mkMsgBox>,
    json: boolean
) {
    box.body.innerHTML = "";
    box.action.style.display = "none";

    const editArea = dce("textarea");
    editArea.className = "msg-edit-area";
    box.body.appendChild(editArea);

    // Set value one way or the other
    if (json) {
        editArea.value = JSON.stringify(msg, null, 2);

    } else {
        let value = "";

        if (msg.reasoning_content)
            value += `<think>\n${msg.reasoning_content}\n</think>\n`;

        if (msg.tool_call_id)
            value += `<id>${msg.tool_call_id}</id>\n`;

        if (typeof msg.content === "string") {
            value += msg.content;

        } else {
            for (const part of msg.content) {
                if (part.type !== "text")
                    continue;
                value += part.text;
            }

        }

        if (msg.tool_calls) {
            for (const tool of msg.tool_calls)
                value += `\n<tool>\n${JSON.stringify(tool, null, 2)}\n</tool>`;
        }

        editArea.value = value;

    }

    const editActions = dce("div");
    editActions.className = "msg-edit-actions";
    editActions.innerHTML =
        `<button class="edit-confirm-btn">Save</button>
        <button class="edit-cancel-btn">Cancel</button>`;
    box.body.appendChild(editActions);

    const ok = <HTMLElement> editActions.children[0];
    const cancel = <HTMLElement> editActions.children[1];

    // Generic function to finalize a change
    function finalize() {
        ui.mkMsgBox(conv, msg, {
            box: box.box
        });
    }
    cancel.onclick = finalize;

    async function save() {
        finalize();
        await chats.convPush(conv, null);
        await ai.complete(conv);
    }

    // Set OK one way or the other
    if (json) {
        ok.onclick = () => {
            try {
                const msg2 = JSON.parse(editArea.value);

                if (typeof msg2.role !== "string")
                    throw Error("msg.role must be a string");
                msg.role = msg2.role;

                if (typeof msg2.reasoning_content !== "undefined") {
                    if (typeof msg2.reasoning_content !== "string")
                        throw Error("msg.reasoning_content must be a string if present");
                    msg.reasoning_content = msg2.reasoning_content;

                } else {
                    delete msg.reasoning_content;

                }

                if (
                    typeof msg2.content !== "string" &&
                    !(msg2.content instanceof Array)
                ) {
                    throw Error("msg.content must be a string or array");
                }
                msg.content = msg2.content;

                if (typeof msg2.tool_calls !== "undefined") {
                    if (!(msg2.tool_calls instanceof Array))
                        throw Error("msg.tool_calls must be an array if present");
                    msg.tool_calls = msg2.tool_calls;

                } else {
                    delete msg.tool_calls;

                }

                if (typeof msg2.tool_call_id !== "undefined") {
                    if (typeof msg2.tool_call_id !== "string")
                        throw Error("msg.tool_call_id must be a string if present");
                    msg.tool_call_id = msg2.tool_call_id;

                } else {
                    delete msg.tool_call_id;

                }

                save();

            } catch (ex) {
                alert(ex + "");

            }
        };

    } else { // !json
        ok.onclick = () => {
            try {
                let content = editArea.value;

                // Reasoning
                {
                    const parts = /^\s*<think>([\s\S]*)<\/think>([\s\S]*)/.exec(content);
                    if (parts) {
                        msg.reasoning_content = parts[1].trim();
                        content = parts[2].trim();
                    } else {
                        delete msg.reasoning_content;
                    }
                }

                // Tool ID
                {
                    const parts = /^\s*<id>([\s\S]*)<\/id>([\s\S]*)/.exec(content);
                    if (parts) {
                        msg.tool_call_id = parts[1].trim();
                        content = parts[2].trim();
                    } else {
                        delete msg.tool_call_id;
                    }
                }

                // Tool calls
                {
                    const parts = content.split("<tool>");
                    if (parts.length > 1) {
                        content = parts.shift()!.trim();
                        msg.tool_calls = [];
                        for (const part of parts) {
                            const parts = /^([\s\S]*)<\/tool>/.exec(part);
                            const call = JSON.parse(parts ? parts[1] : part);
                            msg.tool_calls.push(call);
                        }
                    } else {
                        delete msg.tool_calls;
                    }
                }

                // The actual content
                if (typeof msg.content === "string") {
                    msg.content = content;

                } else {
                    for (const part of msg.content) {
                        if (part.type === "text") {
                            part.text = content;
                            break;
                        }
                    }

                }

                save();

            } catch (ex) {
                alert(ex + "");

            }
        };

    }
}

events.events.addEventListener("click-msg-edit", (ev: any) => {
    editMessage(ev.detail.conv, ev.detail.msg, ev.detail.box, false);
});
events.events.addEventListener("click-msg-edit-json", (ev: any) => {
    editMessage(ev.detail.conv, ev.detail.msg, ev.detail.box, true);
});


/**
 * Change the hidden state of a message.
 * @param conv  Conversation the message belongs to
 * @param msg  The message to hide/unhide
 * @param box  Message box to reformat
 */
async function toggleMessageHidden(
    conv: iface.Conversation,
    msg: iface.Message,
    box: ReturnType<typeof ui.mkMsgBox>
) {
    if (msg.kail_hidden)
        delete msg.kail_hidden;
    else
        msg.kail_hidden = true;
    ui.mkMsgBox(conv, msg, {box: box.box});
    await chats.convPush(conv, null);
}

events.events.addEventListener("click-msg-hidden-toggle", (ev: any) => {
    toggleMessageHidden(ev.detail.conv, ev.detail.msg, ev.detail.box);
});


/**
 * Delete a message, and possibly all messages after it.
 * @param conv  Conversation the message belongs to
 * @param msg  Message to delete
 * @param box  Message box to remove
 * @param trunc  Whether to truncate (delete message and all after) or just delete this message
 */
async function deleteMessage(
    conv: iface.Conversation,
    msg: iface.Message,
    box: ReturnType<typeof ui.mkMsgBox>,
    trunc: boolean
) {
    const yes = confirm(
        `Are you sure? This message${trunc ? " and all later messages" : ""} will be deleted.`
    );
    if (!yes)
        return;

    const msgIdx = conv.messages.indexOf(msg);
    const boxIdx = Array.from(ui.messages.children).indexOf(box.box);
    if (msgIdx < 0 || boxIdx < 0)
        return;

    if (trunc) {
        conv.messages.splice(msgIdx, 1/0);
        for (let bi = ui.messages.children.length - 1; bi >= boxIdx; bi--)
            ui.messages.children[bi].remove();

    } else {
        conv.messages.splice(msgIdx, 1);
        box.box.remove();

    }

    await chats.convPush(conv, null);
    await ai.complete(conv);
}

events.events.addEventListener("click-msg-del", (ev: any) => {
    deleteMessage(ev.detail.conv, ev.detail.msg, ev.detail.box, false);
});
events.events.addEventListener("click-msg-trunc", (ev: any) => {
    deleteMessage(ev.detail.conv, ev.detail.msg, ev.detail.box, true);
});
