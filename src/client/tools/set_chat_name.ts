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

import * as ai from "../ai";
import * as chats from "../chats";
import * as events from "../events";
import * as iface from "../iface";

async function set_chat_name(chat: iface.Conversation, args: string) {
    const obj = JSON.parse(args);
    chat.name = obj.name;
    events.dispatch("conversation.name", {conv: chat});
    const btn = chats.conversationButtons[chat.id];
    if (btn)
        btn.title.innerText = btn.title.title = obj.name;
    return "";
}

ai.tools.set_chat_name = {
    name: "set_chat_name",
    enabled: true,
    function: set_chat_name,
    schema: {
        type: "function",
        function: {
            name: "set_chat_name",
            description: "Set the name of the current conversation. You should do this at least once before your first response to the user, and are free to do it at any time if the previous name of the chat is no longer suitable.",
            parameters: {
                type: "object",
                properties: {
                    name: {
                        type: "string",
                        description: "The name for the chat"
                    }
                },
                required: ["name"]
            },
            strict: true
        }
    }
};
