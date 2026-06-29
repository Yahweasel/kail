/**
 * Global event target for application-wide events.
 */
export const events = new EventTarget();

const KAILEvent =
    typeof CustomEvent !== "undefined"
    ? CustomEvent
    : class KAILEvent extends Event {
        constructor(type: string, opts: {detail?: any} = {}) {
            super(type);
            this.detail = opts.detail || null;
        }

        detail: any;
    }

/**
 * Dispatch a custom event on the global event target.
 * @param type  Type of event to dispatch
 * @param detail  Detail object to include with the event
 */
export function dispatch(type: string, detail: any) {
    events.dispatchEvent(new KAILEvent(type, {detail}));
}
