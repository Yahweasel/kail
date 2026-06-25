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

/**
 * The core of everything: a message.
 */
export interface Message {
    role: "system" | "assistant" | "user" | "tool";
    reasoning_content?: string;
    content: string | MessageContent[];
    tool_calls?: FunctionCall[];
    tool_call_id?: string;

    /**
     * A custom addition meaning “hide this message”.
     */
    kail_hidden?: boolean;
}

/**
 * Text message content.
 */
export interface MessageContentText {
    type: "text";
    text: string;
}

/**
 * Image message content. In practice, image_url.url will always be a data: URL.
 */
export interface MessageContentImage {
    type: "image_url";
    image_url: {url: string};
}

/**
 * Audio message content. In practice, input_audio.url will always be a data:
 * URL.
 */
export interface MessageContentAudio {
    type: "input_audio";
    input_audio: {url: string};
}

/**
 * Video message content. In practice, input_video.url will always be a data:
 * URL.
 */
export interface MessageContentVideo {
    type: "input_video";
    input_video: {url: string};
}


/**
 * All valid message types.
 */
export type MessageContent =
    MessageContentText |
    MessageContentImage |
    MessageContentAudio |
    MessageContentVideo;

/**
 * A function call from the AI.
 */
export interface FunctionCall {
    id: string;
    call_id?: string;
    type: string;
    function: {
        name: string;
        arguments: string;
    };
}

/**
 * A conversation is a sequence of messages and some metadata.
 */
export interface Conversation {
    id: number;
    name?: string;
    messages: Message[];
    inProgress?: Message;
}

/**
 * Option tool actions.
 */
export interface ToolAction {
    /**
     * The actual response.
     */
    response: string | MessageContent[];

    /**
     * To indicate that the tool changed previous messages in the conversation.
     */
    changedHistory?: boolean;
}

/**
 * All responses a tool is allowed.
 */
export type ToolResponse = string | MessageContent[] | ToolAction;


/**
 * Function type for client-side tools.
 */
export type ToolFunction =
    (conv: Conversation, arg: string) => Promise<ToolResponse>;

/**
 * Our side of tools: the actual function and its schema.
 */
export interface Tool {
    name: string;
    enabled: boolean;
    function: ToolFunction;
    schema: any;
}

/**
 * The public interface for plugins, under the global name `KAIL`.
 */
export interface KAIL {
    tools: Record<string, Tool>;
    registerTool: (tool: Tool) => unknown;
};
