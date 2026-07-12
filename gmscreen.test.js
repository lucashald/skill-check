import { test } from "node:test";
import assert from "node:assert/strict";
import { gmscreenRole } from "./gmscreen.js";

const card = (role) => ({ data: { extensions: role === undefined ? {} : { gmscreen_role: role } } });

test("reads an explicit npc", () => {
    assert.equal(gmscreenRole(card("npc")), "npc");
});

test("reads an explicit gm", () => {
    assert.equal(gmscreenRole(card("gm")), "gm");
});

test("returns null when unset", () => {
    assert.equal(gmscreenRole(card(undefined)), null);
});

test("returns null for a malformed value", () => {
    assert.equal(gmscreenRole(card("dungeonmaster")), null);
});

test("tolerates a missing character", () => {
    assert.equal(gmscreenRole(null), null);
    assert.equal(gmscreenRole(undefined), null);
});
