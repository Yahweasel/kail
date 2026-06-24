/**
 * Global event target for application-wide events.
 */
export const events = new EventTarget();

/**
 * Dispatch a custom event on the global event target.
 * @param type  Type of event to dispatch
 * @param detail  Detail object to include with the event
 */
export function dispatch(type: string, detail: any) {
    events.dispatchEvent(new CustomEvent(type, {detail}));
}
