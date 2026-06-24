/**
 * Create a new DOM element.
 * @param tagName  Tag name of the element to create
 * @param options  Options for element creation
 * @returns The newly created element
 */
export const dce = document.createElement.bind(document);
/**
 * Get an element by its ID.
 * @param elementId  ID of the element to get
 * @returns The element with the given ID, or null if not found
 */
export const gebi = document.getElementById.bind(document);
