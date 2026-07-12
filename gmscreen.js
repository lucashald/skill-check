// Reader for the neutral, extension-agnostic gmscreen card role flag.
// No SillyTavern imports so it is Node-testable and browser-importable.
export function gmscreenRole(character) {
    const role = character?.data?.extensions?.gmscreen_role;
    return role === "gm" || role === "npc" ? role : null;
}
