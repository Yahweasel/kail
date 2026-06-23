export const events = new EventTarget();

export function dispatch(type: string, detail: any) {
    events.dispatchEvent(new CustomEvent(type, {detail}));
}
