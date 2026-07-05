import { extension_settings } from "../../../extensions.js";
import { getContext } from "../../../extensions.js";

// Wrapper to get saveSettingsDebounced from context API
function saveSettingsDebounced() {
    const context = getContext();
    if (context && typeof context.saveSettingsDebounced === 'function') {
        context.saveSettingsDebounced();
    } else {
        console.log('[Skill Check] saveSettingsDebounced not available, settings may not persist');
    }
}

const extensionName = "skill-check";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// Default outcome instructions per tier (editable in the character sheet popup)
const defaultOutcomeTexts = {
    critical_failure: 'FAILED BADLY. Narrate a serious setback, complication, or injury. Do not soften the failure. Do not speak for the user.',
    failure: 'FAILED. Narrate the user not achieving their goal. There may be minor consequences. Do not speak for the user.',
    success: 'SUCCEEDED. Narrate the user achieving their goal. Do not speak for the user.',
    strong_success: 'SUCCEEDED EXCEPTIONALLY. Narrate an impressive, skillful, or lucky outcome. Do not speak for the user.'
};

const outcomeTierLabels = {
    critical_failure: 'Critical Failure',
    failure: 'Failure',
    success: 'Success',
    strong_success: 'Strong Success'
};

// Default settings
const defaultSettings = {
    enabled: true,
    useDndStyle: false, // false = flat bonuses (stat IS the modifier), true = DND style (modifier = (stat-10)/2)
    stats: {
        stat1: 0,
        stat2: 0,
        stat3: 0,
        stat4: 0,
        stat5: 0,
        stat6: 0
    },
    statNames: {
        stat1: 'STR',
        stat2: 'DEX',
        stat3: 'CON',
        stat4: 'INT',
        stat5: 'WIS',
        stat6: 'CHA'
    },
    difficulty: 12, // Fallback DC when the AI hasn't declared one
    useLlmDifficulty: true, // Use [SKILL DC: ...] tags declared by the AI in its messages
    injectGmInstructions: true, // Teach the AI the tag protocol via an injected prompt
    contextMessages: 5, // How many recent messages to search for a [SKILL DC] tag
    nextRollDc: 0, // One-shot manual DC override for the next roll (0 = none)
    level: 1,
    pendingLevelUps: 0,
    unconfirmedLevelUps: 0, // Level-ups detected but not yet applied or dismissed
    hp: { current: 20, max: 20 },
    lastProcessedMessageIndex: -1, // Track last message index processed for tags
    lastAppliedChanges: null, // { messageIndex, mesHash, changes } for undo / swipe reversal
    inventory: [], // Array of { name: string, quantity: number }
    spells: [], // Array of { name: string }
    injectCharacterSheet: true, // Inject character sheet into context
    appendRollWithoutSending: true, // If true, append roll to message but don't auto-send
    hideTagsInChat: true, // Cosmetically hide protocol tags in rendered chat messages
    outcomeTexts: { ...defaultOutcomeTexts }, // Editable outcome instructions per tier
    rollHistory: [] // Most recent rolls, newest first (capped at 10)
};

// Stats array for iteration (internal keys)
const statKeys = ['stat1', 'stat2', 'stat3', 'stat4', 'stat5', 'stat6'];

// Get display name for a stat
function getStatName(statKey) {
    const settings = extension_settings[extensionName];
    return settings?.statNames?.[statKey] || statKey.toUpperCase();
}

// Get recent chat context for scanning
// Returns array of messages (newest last) instead of joined string
function getRecentContext(messageCount = 5) {
    try {
        console.log('[Skill Check] getRecentContext called, messageCount:', messageCount);
        // Access SillyTavern's chat context
        const context = getContext();
        console.log('[Skill Check] getContext imported:', typeof getContext);
        console.log('[Skill Check] context exists:', !!context);

        if (context && context.chat && context.chat.length > 0) {
            console.log('[Skill Check] Chat messages count:', context.chat.length);
            const recent = context.chat.slice(-messageCount);
            // Log for debugging
            const recentText = recent.map((m, i) => {
                const label = m.is_user ? '[User]' : '[AI]';
                return `${label} ${m.mes || ''}`;
            }).join('\n');
            console.log('[Skill Check] Recent context:\n', recentText.substring(0, 500));
            // Return array of messages (for recency weighting)
            return recent;
        } else {
            console.warn('[Skill Check] No chat context available or chat is empty');
        }
    } catch (e) {
        console.warn('[Skill Check] Could not access chat context:', e);
    }
    return [];
}

// ===== LLM-DECLARED DIFFICULTY (TAG PROTOCOL) =====
// The AI declares challenge difficulty explicitly with tags in its messages:
//   [SKILL DC: 15]                - one DC for the next check, any stat
//   [SKILL DC: STR 18, DEX 12]    - per-stat DCs
//   [SKILL DC: 15 | Rusty Lock]   - optional label after a pipe
// "DC" without "SKILL" is also accepted.
const DC_TAG_REGEX = /\[\s*(?:SKILL\s+)?DC\s*:\s*([^\]|]+?)(?:\s*\|\s*([^\]]+?))?\s*\]/gi;

// Parse the body of a DC tag. Returns { dcs, label } or null.
// dcs is either { ANY: n } or a map of stat names to DCs, e.g. { STR: 18, DEX: 12 }.
function parseDcTagBody(body, label) {
    const trimmed = body.trim();

    const flat = trimmed.match(/^(\d+)$/);
    if (flat) {
        return { dcs: { ANY: parseInt(flat[1]) }, label: label ? label.trim() : null };
    }

    const dcs = {};
    for (const part of trimmed.split(',')) {
        const m = part.trim().match(/^([A-Za-z]{1,6})\s+(\d+)$/);
        if (!m) return null;
        dcs[m[1].toUpperCase()] = parseInt(m[2]);
    }

    return Object.keys(dcs).length > 0 ? { dcs, label: label ? label.trim() : null } : null;
}

// Find the most recent DC tag in the given messages (newest message wins,
// last tag within a message wins). Returns { dcs, label } or null.
function findLatestDcTag(messages) {
    if (!Array.isArray(messages)) return null;

    for (let i = messages.length - 1; i >= 0; i--) {
        const text = messages[i].mes || '';
        let latest = null;
        let match;
        DC_TAG_REGEX.lastIndex = 0;
        while ((match = DC_TAG_REGEX.exec(text)) !== null) {
            const parsed = parseDcTagBody(match[1], match[2]);
            if (parsed) latest = parsed;
        }
        if (latest) {
            console.log(`[Skill Check] Found DC tag in message ${i}:`, latest);
            return latest;
        }
    }

    return null;
}

// Get active difficulty for a stat
function getActiveDifficulty(statDisplayName) {
    console.log('[Skill Check] ===== getActiveDifficulty called for stat:', statDisplayName, '=====');
    const settings = extension_settings[extensionName];

    // One-shot manual override for the next roll
    if (settings.nextRollDc > 0) {
        const dc = settings.nextRollDc;
        settings.nextRollDc = 0; // Consumed
        saveSettingsDebounced();
        console.log('[Skill Check] Using one-shot manual DC override:', dc);
        // source is shown in the user-facing toast; label is what the AI sees
        return { difficulty: dc, source: 'Manual DC', label: null };
    }

    // AI-declared difficulty via [SKILL DC] tags
    if (settings.useLlmDifficulty) {
        const recentMessages = getRecentContext(settings.contextMessages || 5);
        const tag = findLatestDcTag(recentMessages);
        if (tag) {
            const statDc = tag.dcs[statDisplayName.toUpperCase()];
            const dc = statDc !== undefined ? statDc : tag.dcs.ANY;
            if (dc !== undefined) {
                console.log('[Skill Check] Using AI-declared difficulty:', dc, 'label:', tag.label);
                return {
                    difficulty: dc,
                    source: tag.label || 'AI-declared DC',
                    label: tag.label || null
                };
            }
            console.log('[Skill Check] DC tag found but has no DC for', statDisplayName, '- falling back to default');
        }
    }

    // Fall back to default difficulty
    console.log('[Skill Check] Falling back to default difficulty:', settings.difficulty);
    return { difficulty: settings.difficulty, source: null, label: null };
}

// Get display text for the currently declared challenge
function getCurrentChallengeDisplay() {
    const settings = extension_settings[extensionName];

    if (settings.nextRollDc > 0) {
        return `<span class="challenge-manual">DC ${settings.nextRollDc}</span> <small>(manual, next roll only)</small>`;
    }

    if (!settings.useLlmDifficulty) {
        return '<span class="challenge-none">AI-declared DCs disabled</span>';
    }

    const tag = findLatestDcTag(getRecentContext(settings.contextMessages || 5));
    if (!tag) {
        return '<span class="challenge-none">None declared</span>';
    }

    const dcText = tag.dcs.ANY !== undefined
        ? `DC ${tag.dcs.ANY}`
        : Object.entries(tag.dcs).map(([stat, dc]) => `${stat} ${dc}`).join(', ');
    const labelText = tag.label ? `${tag.label} — ` : '';
    return `<span class="challenge-detected">${labelText}${dcText}</span>`;
}

// Update the DC badge in the stat button row and highlight stat buttons
// that have an AI-declared DC. Called on new messages and settings changes.
function updateDcBadge() {
    const settings = extension_settings[extensionName];
    const badge = $('#skill-check-dc-badge');
    if (!badge.length) return;

    $('.skill-check-btn').removeClass('has-dc');

    if (settings.nextRollDc > 0) {
        badge.text(`Next roll: DC ${settings.nextRollDc} (manual)`).show();
        return;
    }

    if (!settings.useLlmDifficulty) {
        badge.hide();
        return;
    }

    const tag = findLatestDcTag(getRecentContext(settings.contextMessages || 5));
    if (!tag) {
        badge.hide();
        return;
    }

    const labelText = tag.label ? `${tag.label} — ` : '';
    if (tag.dcs.ANY !== undefined) {
        badge.text(`${labelText}DC ${tag.dcs.ANY}`).show();
    } else {
        const parts = Object.entries(tag.dcs).map(([stat, dc]) => `${stat} ${dc}`);
        badge.text(`${labelText}${parts.join(', ')}`).show();
        // Highlight the stat buttons the DC applies to
        statKeys.forEach(statKey => {
            if (tag.dcs[getStatName(statKey).toUpperCase()] !== undefined) {
                $(`.skill-check-btn[data-stat="${statKey}"]`).addClass('has-dc');
            }
        });
    }
}

// ===== COSMETIC TAG HIDING =====
// Removes protocol tags from rendered chat messages (display only - the
// underlying message text is untouched, so parsing still works).
const TAG_HIDE_REGEX = /\s*\[\s*(?:(?:SKILL\s+)?DC\s*:|ITEM\s+(?:GAINED|ADDED|LOST|REMOVED|USED)\s*:|SPELL\s+(?:LEARNED|GAINED|FORGOTTEN|LOST|REMOVED)\s*:|LEVEL\s*UP(?:\s*:)?|HP(?:\s+MAX)?\s*:)[^\]]*\]/gi;

let tagHidingInProgress = false;

function applyTagHiding() {
    const settings = extension_settings[extensionName];
    if (!settings.hideTagsInChat || tagHidingInProgress) return;

    tagHidingInProgress = true;
    try {
        $('#chat .mes_text').each(function() {
            TAG_HIDE_REGEX.lastIndex = 0;
            if (!TAG_HIDE_REGEX.test(this.innerHTML)) return;
            TAG_HIDE_REGEX.lastIndex = 0;
            const newHtml = this.innerHTML.replace(TAG_HIDE_REGEX, '');
            if (newHtml !== this.innerHTML) {
                this.innerHTML = newHtml;
            }
        });
    } finally {
        tagHidingInProgress = false;
    }
}

// Re-apply tag hiding whenever chat content changes (streaming, swipes, edits)
function setupTagHidingObserver() {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer) return;

    let debounceTimer = null;
    const observer = new MutationObserver(() => {
        if (tagHidingInProgress) return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(applyTagHiding, 250);
    });

    observer.observe(chatContainer, { childList: true, subtree: true, characterData: true });
    console.log('[Skill Check] ✓ Tag hiding observer active on #chat');
}

// Detect explicit level-up tags: [LEVEL UP] or [LEVEL UP: 3]
// Returns { detected: bool, count: number }
function detectLevelUp(text) {
    let count = 0;
    const regex = /\[\s*LEVEL\s*UP(?:\s*:\s*(\d+))?\s*\]/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
        count += match[1] ? parseInt(match[1]) : 1;
        console.log('[Skill Check] Level-up tag matched:', match[0]);
    }
    return { detected: count > 0, count };
}

// Show level-up notification with confirmation
function showLevelUpToast(count) {
    // Remove existing level-up toast if any
    $('.skill-check-levelup-toast').remove();

    const pointsText = count === 1 ? '1 point' : `${count} points`;
    const levelText = count === 1 ? 'Level Up!' : `Level Up! (+${count})`;

    const toast = $(`
        <div class="skill-check-levelup-toast">
            <div class="levelup-title">${levelText}</div>
            <div class="levelup-subtitle">${pointsText} to spend</div>
            <div class="levelup-buttons">
                <button class="levelup-apply menu_button">Apply</button>
                <button class="levelup-ignore menu_button">Ignore</button>
            </div>
        </div>
    `);

    // Apply button - grant levels and open character sheet
    toast.find('.levelup-apply').on('click', function() {
        applyLevelUp(count);
        toast.remove();
        openCharacterSheet();
    });

    // Ignore button - dismiss the offer entirely
    toast.find('.levelup-ignore').on('click', function() {
        retractLevelUpOffer(count);
        toast.remove();
    });

    $('body').append(toast);

    // Auto-dismiss after 15 seconds. The offer is NOT discarded - it stays
    // as a badge on the character sheet button so it can't be missed.
    setTimeout(() => {
        if (toast.is(':visible')) {
            toast.fadeOut(300, () => toast.remove());
        }
    }, 15000);
}

// Register a detected level-up as an unconfirmed offer and notify the user
function offerLevelUp(count) {
    const settings = extension_settings[extensionName];
    settings.unconfirmedLevelUps += count;
    saveSettingsDebounced();
    updateSheetButtonBadge();
    showLevelUpToast(count);
}

// Withdraw a level-up offer (user ignored it, or the message was swiped away)
function retractLevelUpOffer(count) {
    const settings = extension_settings[extensionName];
    settings.unconfirmedLevelUps = Math.max(0, settings.unconfirmedLevelUps - count);
    saveSettingsDebounced();
    updateSheetButtonBadge();
}

// Apply level-up: grant levels and pending stat points
function applyLevelUp(count) {
    const settings = extension_settings[extensionName];
    settings.level += count;
    settings.pendingLevelUps += count;
    settings.unconfirmedLevelUps = Math.max(0, settings.unconfirmedLevelUps - count);
    saveSettingsDebounced();
    updateSheetButtonBadge();
    updateCharacterSheetPrompt();

    console.log(`[Skill Check] Level up applied! +${count} level(s), now level ${settings.level}, ${settings.pendingLevelUps} pending point(s)`);
}

// Show/hide the unconfirmed level-up badge on the character sheet button
function updateSheetButtonBadge() {
    const settings = extension_settings[extensionName];
    const btn = $('#skill-check-sheet-btn');
    if (!btn.length) return;

    btn.find('.skill-check-sheet-badge').remove();
    if (settings.unconfirmedLevelUps > 0) {
        btn.append(`<span class="skill-check-sheet-badge">${settings.unconfirmedLevelUps}</span>`);
    }
}

// Cheap content hash used to detect swipes/edits of an already-processed message
function hashText(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) {
        h = ((h << 5) - h + text.charCodeAt(i)) | 0;
    }
    return h;
}

// Process the most recent AI message for state tags (items, spells, HP, level-ups).
// Each message version is processed exactly once: the index guard prevents
// double-processing, and the content hash detects swipes/edits so changes
// from a discarded version are reverted before the new version is applied.
function processIncomingMessage() {
    try {
        console.log('[Skill Check] ===== processIncomingMessage called =====');
        const settings = extension_settings[extensionName];
        const context = getContext();

        if (!context || !context.chat || context.chat.length === 0) {
            console.warn('[Skill Check] No chat context available for tag processing');
            return;
        }

        const chat = context.chat;
        const currentIndex = chat.length - 1;

        // Detect chat reset: if current index is less than the last processed index,
        // we're in a new/different chat, so reset the tracking
        if (settings.lastProcessedMessageIndex >= 0 && currentIndex < settings.lastProcessedMessageIndex) {
            console.log('[Skill Check] Chat reset detected (current index < last processed index), resetting tracking');
            settings.lastProcessedMessageIndex = -1;
            settings.lastAppliedChanges = null;
            saveSettingsDebounced();
        }

        // Find the most recent AI message and process its tags once per version
        for (let i = chat.length - 1; i >= 0; i--) {
            const msg = chat[i];
            if (msg.is_user) continue;

            const mes = msg.mes || '';
            const mesHash = hashText(mes);
            const last = settings.lastAppliedChanges;

            if (i < settings.lastProcessedMessageIndex) break;

            if (i === settings.lastProcessedMessageIndex) {
                if (!last || last.messageIndex !== i) {
                    // Processed before we started tracking changes - don't reprocess
                    break;
                }
                if (last.mesHash === mesHash) {
                    console.log(`[Skill Check] Message ${i} unchanged, skipping`);
                    break;
                }
                // Same message, different content: it was swiped or edited.
                // Revert what the old version did before applying the new version.
                console.log(`[Skill Check] Message ${i} was swiped/edited - reverting previous changes`);
                revertTagChanges(last.changes);
                settings.lastAppliedChanges = null;
            }

            console.log(`[Skill Check] Processing message ${i} for tags:`, mes.substring(0, 200));
            const changes = processMessageTags(mes);

            settings.lastAppliedChanges = { messageIndex: i, mesHash: mesHash, changes: changes };
            settings.lastProcessedMessageIndex = i;
            saveSettingsDebounced();

            if (changes.length > 0) {
                showTagChangeToast(changes);
            }
            break;
        }

        // Refresh UI that depends on chat content
        updateDcBadge();
        applyTagHiding();

        console.log('[Skill Check] ===== processIncomingMessage complete =====');
    } catch (e) {
        console.error('[Skill Check] Error processing message tags:', e);
        console.error('[Skill Check]', e.stack);
    }
}

// ===== LLM-MANAGED INVENTORY, SPELLS & LEVELS (TAG PROTOCOL) =====
// The AI manages game state explicitly with tags in its messages:
//   [ITEM GAINED: health potion x2]   - add items (quantity optional)
//   [ITEM LOST: rope]                 - remove items
//   [SPELL LEARNED: fireball]         - learn a spell
//   [SPELL FORGOTTEN: fireball]       - forget a spell
//   [LEVEL UP] / [LEVEL UP: 2]        - gain level(s)

// Parse an item tag body into { name, quantity }.
// Accepts "health potion x2", "2 health potions", or just "rope".
function parseItemBody(body) {
    let name = body.trim();
    let quantity = 1;

    const suffix = name.match(/^(.*?)\s*[x×]\s*(\d+)$/i);
    if (suffix) {
        name = suffix[1].trim();
        quantity = parseInt(suffix[2]);
    } else {
        const prefix = name.match(/^(\d+)\s+(.+)$/);
        if (prefix) {
            quantity = parseInt(prefix[1]);
            name = prefix[2].trim();
        }
    }

    // Remove articles "the", "a", "an" from the beginning
    name = name.replace(/^(?:the|an?)\s+/i, '');

    if (name.length < 1 || name.length > 50) return null;
    return { name, quantity: Math.max(1, quantity) };
}

// Generic tag collector: runs a tag regex over text, parses each body with parseItemBody
function collectItemTags(text, regex) {
    const items = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        const item = parseItemBody(match[1]);
        if (item) {
            items.push(item);
            console.log(`[Skill Check] ✓ Tag matched: "${match[0]}" → ${item.quantity}x "${item.name}"`);
        }
    }
    return items;
}

// Detect inventory additions from [ITEM GAINED: ...] tags (ITEM ADDED also accepted)
function detectInventoryAdditions(text) {
    return collectItemTags(text, /\[\s*ITEM\s+(?:GAINED|ADDED)\s*:\s*([^\]]+?)\s*\]/gi);
}

// Detect inventory removals from [ITEM LOST: ...] tags (ITEM REMOVED / ITEM USED also accepted)
function detectInventoryRemovals(text) {
    return collectItemTags(text, /\[\s*ITEM\s+(?:LOST|REMOVED|USED)\s*:\s*([^\]]+?)\s*\]/gi);
}

// Detect spells from [SPELL LEARNED: ...] tags. Returns array of spell names.
function detectSpellLearning(text) {
    return collectItemTags(text, /\[\s*SPELL\s+(?:LEARNED|GAINED)\s*:\s*([^\]]+?)\s*\]/gi)
        .map(item => item.name);
}

// Detect forgotten spells from [SPELL FORGOTTEN: ...] tags. Returns array of spell names.
function detectSpellRemovals(text) {
    return collectItemTags(text, /\[\s*SPELL\s+(?:FORGOTTEN|LOST|REMOVED)\s*:\s*([^\]]+?)\s*\]/gi)
        .map(item => item.name);
}

// Detect HP tags: [HP: -5] (damage), [HP: +3] (healing), [HP: 17] (set), [HP MAX: 40]
// Returns array of { isMax, isDelta, value }
function detectHpChanges(text) {
    const changes = [];
    const regex = /\[\s*HP(\s+MAX)?\s*:\s*([+-]?\d+)\s*\]/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const isMax = !!match[1];
        const raw = match[2];
        changes.push({
            isMax: isMax,
            isDelta: !isMax && /^[+-]/.test(raw),
            value: parseInt(raw)
        });
        console.log(`[Skill Check] ✓ HP tag matched: "${match[0]}"`);
    }
    return changes;
}

// Apply an HP change. Returns { before, after } snapshots for undo.
function applyHpChange(change) {
    const settings = extension_settings[extensionName];
    if (!settings.hp) settings.hp = { current: 20, max: 20 };

    const before = { ...settings.hp };

    if (change.isMax) {
        settings.hp.max = Math.max(1, change.value);
    } else if (change.isDelta) {
        settings.hp.current += change.value;
    } else {
        settings.hp.current = change.value;
    }
    settings.hp.current = Math.max(0, Math.min(settings.hp.max, settings.hp.current));

    saveSettingsDebounced();
    console.log(`[Skill Check] HP: ${before.current}/${before.max} → ${settings.hp.current}/${settings.hp.max}`);
    return { before: before, after: { ...settings.hp } };
}

// Add item to inventory
function addToInventory(itemName, quantity = 1) {
    const settings = extension_settings[extensionName];
    if (!settings.inventory) settings.inventory = [];

    // Check if item already exists
    const existing = settings.inventory.find(item =>
        item.name.toLowerCase() === itemName.toLowerCase()
    );

    if (existing) {
        existing.quantity += quantity;
    } else {
        settings.inventory.push({ name: itemName, quantity });
    }

    saveSettingsDebounced();
    console.log(`[Skill Check] Added ${quantity}x ${itemName} to inventory`);
}

// Remove item from inventory. Returns the quantity actually removed (0 if
// the item wasn't held), so undo can restore exactly what was taken.
function removeFromInventory(itemName, quantity = 1) {
    const settings = extension_settings[extensionName];
    if (!settings.inventory) settings.inventory = [];

    const existing = settings.inventory.find(item =>
        item.name.toLowerCase() === itemName.toLowerCase()
    );

    if (!existing) return 0;

    const removed = Math.min(existing.quantity, quantity);
    existing.quantity -= quantity;
    if (existing.quantity <= 0) {
        // Remove item completely if quantity is 0 or less
        settings.inventory = settings.inventory.filter(item => item !== existing);
    }
    saveSettingsDebounced();
    console.log(`[Skill Check] Removed ${removed}x ${itemName} from inventory`);
    return removed;
}

// Add spell to spell list. Returns true if it was actually new.
function addSpell(spellName) {
    const settings = extension_settings[extensionName];
    if (!settings.spells) settings.spells = [];

    // Check if spell already exists (case insensitive)
    const exists = settings.spells.some(spell =>
        spell.name.toLowerCase() === spellName.toLowerCase()
    );

    if (exists) return false;

    settings.spells.push({ name: spellName });
    saveSettingsDebounced();
    console.log(`[Skill Check] Learned spell: ${spellName}`);
    return true;
}

// Remove spell from spell list. Returns true if a spell was actually removed.
function removeSpell(spellName) {
    const settings = extension_settings[extensionName];
    if (!settings.spells) settings.spells = [];

    const before = settings.spells.length;
    settings.spells = settings.spells.filter(spell =>
        spell.name.toLowerCase() !== spellName.toLowerCase()
    );

    if (settings.spells.length === before) return false;

    saveSettingsDebounced();
    console.log(`[Skill Check] Forgot spell: ${spellName}`);
    return true;
}

// Process all state tags in an AI message (items, spells, HP, level-ups).
// Returns the list of applied changes so they can be shown and undone.
function processMessageTags(text) {
    const changes = [];

    // Inventory additions
    for (const item of detectInventoryAdditions(text)) {
        addToInventory(item.name, item.quantity);
        changes.push({ type: 'item_add', name: item.name, quantity: item.quantity });
    }

    // Inventory removals (only record what was actually held)
    for (const item of detectInventoryRemovals(text)) {
        const removed = removeFromInventory(item.name, item.quantity);
        if (removed > 0) {
            changes.push({ type: 'item_remove', name: item.name, quantity: removed });
        }
    }

    // Spells learned
    for (const spellName of detectSpellLearning(text)) {
        if (addSpell(spellName)) {
            changes.push({ type: 'spell_add', name: spellName });
        }
    }

    // Spells forgotten
    for (const spellName of detectSpellRemovals(text)) {
        if (removeSpell(spellName)) {
            changes.push({ type: 'spell_remove', name: spellName });
        }
    }

    // HP changes
    for (const hpChange of detectHpChanges(text)) {
        const result = applyHpChange(hpChange);
        changes.push({ type: 'hp', before: result.before, after: result.after });
    }

    // Level-ups (offered via a confirmation toast, tracked until resolved)
    const levelUp = detectLevelUp(text);
    if (levelUp.detected) {
        console.log(`[Skill Check] ✓ Level-up tag detected: +${levelUp.count} level(s)`);
        offerLevelUp(levelUp.count);
        changes.push({ type: 'level_offer', count: levelUp.count });
    }

    // Update character sheet prompt after changes
    updateCharacterSheetPrompt();

    return changes;
}

// Revert a list of applied tag changes (undo button, or a swiped-away message)
function revertTagChanges(changes) {
    const settings = extension_settings[extensionName];

    for (const change of [...changes].reverse()) {
        switch (change.type) {
            case 'item_add':
                removeFromInventory(change.name, change.quantity);
                break;
            case 'item_remove':
                addToInventory(change.name, change.quantity);
                break;
            case 'spell_add':
                removeSpell(change.name);
                break;
            case 'spell_remove':
                addSpell(change.name);
                break;
            case 'hp':
                settings.hp = { ...change.before };
                break;
            case 'level_offer':
                // Withdraw the offer; an already-applied level-up stays applied
                retractLevelUpOffer(change.count);
                $('.skill-check-levelup-toast').remove();
                break;
        }
    }

    saveSettingsDebounced();
    updateCharacterSheetPrompt();
    console.log(`[Skill Check] Reverted ${changes.length} tag change(s)`);
}

// Human-readable one-liner for a tag change (used in the change toast)
function describeChange(change) {
    switch (change.type) {
        case 'item_add':
            return `+ ${change.quantity > 1 ? change.quantity + '× ' : ''}${change.name}`;
        case 'item_remove':
            return `− ${change.quantity > 1 ? change.quantity + '× ' : ''}${change.name}`;
        case 'spell_add':
            return `Learned: ${change.name}`;
        case 'spell_remove':
            return `Forgot: ${change.name}`;
        case 'hp': {
            if (change.after.max !== change.before.max) {
                return `Max HP: ${change.before.max} → ${change.after.max}`;
            }
            const diff = change.after.current - change.before.current;
            return `HP ${diff >= 0 ? '+' : ''}${diff} (now ${change.after.current}/${change.after.max})`;
        }
        default:
            return null; // level_offer has its own toast
    }
}

// Show a toast summarizing what the AI just changed, with an Undo button
function showTagChangeToast(changes) {
    const lines = changes.map(describeChange).filter(Boolean);
    if (lines.length === 0) return;

    $('.skill-check-changes-toast').remove();

    const toast = $(`
        <div class="skill-check-changes-toast">
            <div class="changes-title">Character updated</div>
            <div class="changes-list">${lines.map(l => `<div>${l}</div>`).join('')}</div>
            <button class="changes-undo menu_button">Undo</button>
        </div>
    `);

    toast.find('.changes-undo').on('click', function() {
        const settings = extension_settings[extensionName];
        // Level-up offers keep their own toast/badge flow; undo everything else
        const undoable = changes.filter(c => c.type !== 'level_offer');
        revertTagChanges(undoable);

        // Don't re-revert these on a later swipe
        if (settings.lastAppliedChanges) {
            settings.lastAppliedChanges.changes =
                settings.lastAppliedChanges.changes.filter(c => c.type === 'level_offer');
            saveSettingsDebounced();
        }
        toast.remove();
    });

    $('body').append(toast);
    setTimeout(() => toast.addClass('show'), 10);

    // Auto-dismiss after 8 seconds
    setTimeout(() => {
        toast.removeClass('show');
        setTimeout(() => toast.remove(), 300);
    }, 8000);
}

// Build the Game Master instructions that teach the AI the tag protocol
function buildGmInstructions() {
    return [
        '---GAME MASTER INSTRUCTIONS---',
        'You are responsible for setting challenge difficulty and managing the player\'s inventory, spells, and level. Declare all game-state changes explicitly using these exact tags, each on its own line at the end of your message:',
        '- [SKILL DC: 15] — declare the difficulty of a challenge the player is facing before they attempt it. Use per-stat DCs when different approaches vary in difficulty: [SKILL DC: STR 18, DEX 12]. Optionally name the challenge: [SKILL DC: 15 | Rusty Lock].',
        '  Difficulty guide: 5 = trivial, 10 = easy, 12 = medium, 15 = hard, 20 = very hard, 25 = nearly impossible.',
        '- [ITEM GAINED: item name x2] — whenever the player acquires items (quantity optional).',
        '- [ITEM LOST: item name] — whenever the player loses, uses up, gives away, or breaks an item.',
        '- [SPELL LEARNED: spell name] — when the player learns a new spell.',
        '- [SPELL FORGOTTEN: spell name] — when the player loses access to a spell.',
        '- [HP: -5] — when the player takes damage. Use [HP: +3] for healing, [HP: 25] to set an exact value, and [HP MAX: 40] to change their maximum HP.',
        '- [LEVEL UP] — when the player gains a level (use [LEVEL UP: 2] for multiple levels).',
        'Always declare a [SKILL DC] tag when you present a meaningful challenge or obstacle, and keep difficulties consistent with the fiction. Only emit tags for changes that actually happen in the story — never for hypothetical ones.',
        '---END GAME MASTER INSTRUCTIONS---'
    ].join('\n');
}

// Build character sheet prompt text
function buildCharacterSheetPrompt() {
    const settings = extension_settings[extensionName];

    let prompt = '---CHARACTER SHEET---\n';

    // Level
    prompt += `Level: ${settings.level}\n`;

    // HP
    if (settings.hp) {
        prompt += `HP: ${settings.hp.current}/${settings.hp.max}\n`;
    }

    // Stats
    prompt += 'Stats: ';
    const statStrings = statKeys.map(statKey => {
        const name = settings.statNames[statKey];
        const value = settings.stats[statKey];
        const modifier = getModifier(value);
        const modStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;
        return settings.useDndStyle ? `${name} ${value} (${modStr})` : `${name} ${modStr}`;
    });
    prompt += statStrings.join(', ') + '\n';

    // Inventory
    if (settings.inventory && settings.inventory.length > 0) {
        prompt += 'Inventory: ';
        const itemStrings = settings.inventory.map(item =>
            item.quantity > 1 ? `${item.name} (×${item.quantity})` : item.name
        );
        prompt += itemStrings.join(', ') + '\n';
    }

    // Spells
    if (settings.spells && settings.spells.length > 0) {
        prompt += 'Spells: ';
        const spellStrings = settings.spells.map(spell => spell.name);
        prompt += spellStrings.join(', ') + '\n';
    }

    prompt += '---END CHARACTER SHEET---\n';
    prompt += 'Note: This is the player character\'s current status. Do not narrate or mention this sheet directly unless the player asks about their stats. Use this information to inform your responses about the character\'s capabilities.';

    return prompt;
}

// Build the full extension prompt (character sheet + GM instructions)
function buildExtensionPrompt() {
    const settings = extension_settings[extensionName];
    const parts = [];

    if (settings.injectCharacterSheet) {
        parts.push(buildCharacterSheetPrompt());
    }
    if (settings.injectGmInstructions) {
        parts.push(buildGmInstructions());
    }

    return parts.join('\n');
}

// Update the character sheet prompt in context
function updateCharacterSheetPrompt() {
    // Get setExtensionPrompt from the context API
    const context = getContext();
    if (context && typeof context.setExtensionPrompt === 'function') {
        const promptText = buildExtensionPrompt();

        // Register the prompt with identifier and position
        context.setExtensionPrompt(
            extensionName,           // identifier
            promptText,              // prompt text
            2,                       // position: 2 = AFTER_CHAR (after character definitions)
            0                        // depth (0 = default)
        );

        console.log('[Skill Check] Character sheet prompt updated');
    } else {
        console.warn('[Skill Check] setExtensionPrompt not available - character sheet injection disabled');
    }
}

// Set up tag processing on incoming AI messages (and swipes/edits of them)
function setupMessageTagProcessing() {
    console.log('[Skill Check] ===== Setting up message tag processing =====');

    const context = getContext();
    const source = (context && context.eventSource)
        || (typeof eventSource !== 'undefined' ? eventSource : null);
    const types = (context && (context.eventTypes || context.event_types))
        || (typeof event_types !== 'undefined' ? event_types : null);

    console.log('[Skill Check] eventSource available:', !!source);

    // Try to hook into SillyTavern events if available
    if (source) {
        try {
            const handler = () => {
                console.log('[Skill Check] chat event fired');
                setTimeout(processIncomingMessage, 500); // Small delay to ensure message is in context
            };

            source.on(types?.MESSAGE_RECEIVED || 'message_received', handler);

            // Swipes and edits change an already-processed message; the content
            // hash in processIncomingMessage reverts + reprocesses it
            try {
                source.on(types?.MESSAGE_SWIPED || 'message_swiped', handler);
                source.on(types?.MESSAGE_EDITED || 'message_edited', handler);
            } catch (e) {
                console.warn('[Skill Check] Could not hook swipe/edit events:', e);
            }

            console.log('[Skill Check] ✓ Tag processing hooked into message events');
            return;
        } catch (e) {
            console.warn('[Skill Check] Could not hook into message events:', e);
        }
    }

    // Fallback: Use MutationObserver to watch for new messages
    const chatContainer = document.getElementById('chat');
    console.log('[Skill Check] chat container found:', !!chatContainer);

    if (chatContainer) {
        const observer = new MutationObserver((mutations) => {
            console.log('[Skill Check] MutationObserver triggered, mutations:', mutations.length);
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    console.log('[Skill Check] New nodes added to chat, processing tags');
                    // New content added, process tags after a delay
                    setTimeout(processIncomingMessage, 500);
                    break;
                }
            }
        });

        observer.observe(chatContainer, { childList: true, subtree: true });
        console.log('[Skill Check] ✓ Tag processing using MutationObserver on #chat');
    } else {
        // Last resort: periodic check
        setInterval(processIncomingMessage, 3000);
        console.log('[Skill Check] ⚠ Tag processing using periodic check (3s interval)');
    }
}

// Calculate modifier based on stat style setting
function getModifier(stat) {
    const settings = extension_settings[extensionName];
    if (settings.useDndStyle) {
        // DND style: modifier = (stat - 10) / 2
        return Math.floor((stat - 10) / 2);
    } else {
        // Flat bonus: stat IS the modifier
        return stat;
    }
}

// Roll 1d20
function rollD20() {
    return Math.floor(Math.random() * 20) + 1;
}

// Determine outcome tier. The per-tier instruction text is user-editable.
function determineOutcome(naturalRoll, total, difficulty) {
    const settings = extension_settings[extensionName];
    const texts = Object.assign({}, defaultOutcomeTexts, settings.outcomeTexts || {});

    // Critical Failure: natural 1 OR fails by 4+
    if (naturalRoll === 1 || total <= difficulty - 4) {
        return { tier: 'critical_failure', text: texts.critical_failure };
    }

    // Strong Success: exceeds difficulty by 4+ OR natural 20
    if ((total >= difficulty + 4) || naturalRoll === 20) {
        return { tier: 'strong_success', text: texts.strong_success };
    }

    // Success: total >= difficulty
    if (total >= difficulty) {
        return { tier: 'success', text: texts.success };
    }

    // Failure: total < difficulty (but not critical)
    return { tier: 'failure', text: texts.failure };
}

// Record a roll in the history (newest first, capped at 10)
function recordRoll(entry) {
    const settings = extension_settings[extensionName];
    if (!settings.rollHistory) settings.rollHistory = [];
    settings.rollHistory.unshift(entry);
    settings.rollHistory = settings.rollHistory.slice(0, 10);
    saveSettingsDebounced();
}

// Format the dice portion of a roll for display, e.g. "14" or "(14, 7) ▲14"
function formatRollDice(rolls, naturalRoll, rollMode) {
    if (!rolls || rolls.length <= 1) return `${naturalRoll}`;
    const arrow = rollMode === 'advantage' ? '▲' : '▼';
    return `(${rolls.join(', ')}) ${arrow}${naturalRoll}`;
}

// Show toast notification
function showRollResult(stat, rolls, naturalRoll, modifier, total, outcome, challengeInfo, rollMode) {
    const { difficulty, source } = challengeInfo;
    const modStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;
    const vsText = source ? `vs ${source} (DC ${difficulty})` : `(DC ${difficulty})`;
    const modeText = rollMode === 'advantage' ? ' · Advantage'
        : rollMode === 'disadvantage' ? ' · Disadvantage' : '';

    const toast = $(`
        <div class="skill-check-toast">
            <strong>${stat} Check ${vsText}${modeText}</strong><br>
            <span class="roll-math">${formatRollDice(rolls, naturalRoll, rollMode)} ${modStr} = ${total}</span><br>
            <span class="outcome-${outcome.tier}">${outcome.tier.replace('_', ' ').toUpperCase()}</span>
        </div>
    `);

    $('body').append(toast);

    // Trigger animation
    setTimeout(() => toast.addClass('show'), 10);

    // Auto-dismiss after 3.5 seconds
    setTimeout(() => {
        toast.removeClass('show');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// Perform skill check and send message.
// rollMode: 'normal' | 'advantage' (2d20 take highest) | 'disadvantage' (2d20 take lowest)
async function performSkillCheck(statKey, rollMode = 'normal') {
    const settings = extension_settings[extensionName];
    const statDisplayName = getStatName(statKey);

    // Get the message textarea
    const textarea = document.getElementById('send_textarea');
    if (!textarea) {
        console.error('[Skill Check] Could not find message textarea');
        return;
    }

    const userMessage = textarea.value.trim();

    // Get stat value and calculate modifier
    const statValue = settings.stats[statKey];
    const modifier = getModifier(statValue);

    // Get active difficulty (manual override, AI-declared, or default)
    const challengeInfo = getActiveDifficulty(statDisplayName);

    // Roll the dice (advantage/disadvantage rolls twice)
    const rolls = [rollD20()];
    if (rollMode === 'advantage' || rollMode === 'disadvantage') {
        rolls.push(rollD20());
    }
    const naturalRoll = rollMode === 'advantage' ? Math.max(...rolls)
        : rollMode === 'disadvantage' ? Math.min(...rolls)
        : rolls[0];
    const total = naturalRoll + modifier;

    // Determine outcome using the challenge difficulty
    const outcome = determineOutcome(naturalRoll, total, challengeInfo.difficulty);

    // Show result to user
    showRollResult(statDisplayName, rolls, naturalRoll, modifier, total, outcome, challengeInfo, rollMode);

    // Record in roll history
    recordRoll({
        stat: statDisplayName,
        rolls: rolls,
        natural: naturalRoll,
        modifier: modifier,
        total: total,
        difficulty: challengeInfo.difficulty,
        source: challengeInfo.source,
        tier: outcome.tier,
        mode: rollMode,
        time: Date.now()
    });

    // Build the injection. Only name the challenge when it has a real label -
    // generic sources like "Manual DC" would read as gibberish in-fiction.
    const vsText = challengeInfo.label ? ` against ${challengeInfo.label}` : '';
    const modeText = rollMode === 'advantage' ? ' with advantage'
        : rollMode === 'disadvantage' ? ' at a disadvantage' : '';
    const injection = `[System: The user attempted an action${vsText} using ${statDisplayName}${modeText}. They ${outcome.text}]`;
    textarea.value = userMessage ? `${userMessage}\n\n${injection}` : injection;

    // A consumed one-shot override changes the displayed DC
    updateDcBadge();

    // Check if we should auto-send or just append
    if (settings.appendRollWithoutSending) {
        console.log('[Skill Check] Roll appended to message (auto-send disabled by setting)');
        // Focus the textarea so user can see the appended text
        textarea.focus();
    } else {
        // Trigger send button click
        const sendButton = document.getElementById('send_but');
        if (sendButton) {
            sendButton.click();
        } else {
            console.error('[Skill Check] Could not find send button');
        }
    }
}

// Create stat buttons UI
function createStatButtons() {
    console.log('[Skill Check] Creating stat buttons...');

    const container = $(`
        <div id="skill-check-buttons" class="skill-check-container">
            <div class="skill-check-label">Skill Check:</div>
            <div class="skill-check-stats">
                ${statKeys.map(statKey => `
                    <button class="skill-check-btn" data-stat="${statKey}" title="Roll ${getStatName(statKey)} check (Shift: advantage, Ctrl: disadvantage)">
                        ${getStatName(statKey)}
                    </button>
                `).join('')}
            </div>
            <div id="skill-check-dc-badge" class="skill-check-dc-badge" title="Currently declared difficulty" style="display: none;"></div>
            <button id="skill-check-sheet-btn" class="skill-check-sheet-btn" title="Edit Character Sheet">
                <i class="fa-solid fa-scroll"></i>
            </button>
        </div>
    `);

    // Add click handlers for stat buttons (Shift = advantage, Ctrl/Alt = disadvantage)
    container.find('.skill-check-btn').on('click', function(event) {
        const statKey = $(this).data('stat');
        const rollMode = event.shiftKey ? 'advantage'
            : (event.ctrlKey || event.metaKey || event.altKey) ? 'disadvantage'
            : 'normal';
        performSkillCheck(statKey, rollMode);
    });

    // Add click handler for character sheet button
    container.find('#skill-check-sheet-btn').on('click', function() {
        openCharacterSheet();
    });

    // Try multiple injection points with fallbacks
    let injected = false;

    // Try 1: Before #send_form
    const sendForm = $('#send_form');
    if (sendForm.length) {
        console.log('[Skill Check] Injecting before #send_form');
        sendForm.before(container);
        injected = true;
    }
    // Try 2: After #send_textarea
    else if ($('#send_textarea').length) {
        console.log('[Skill Check] Injecting after #send_textarea');
        $('#send_textarea').after(container);
        injected = true;
    }
    // Try 3: Before #send_but
    else if ($('#send_but').length) {
        console.log('[Skill Check] Injecting before #send_but');
        $('#send_but').before(container);
        injected = true;
    }
    // Try 4: Look for form with send_textarea
    else if ($('#send_textarea').parent().length) {
        console.log('[Skill Check] Injecting into #send_textarea parent');
        $('#send_textarea').parent().append(container);
        injected = true;
    }
    // Try 5: Append to chat form area
    else if ($('.mes_buttons').length) {
        console.log('[Skill Check] Injecting before .mes_buttons');
        $('.mes_buttons').first().before(container);
        injected = true;
    }

    if (injected) {
        console.log('[Skill Check] Stat buttons created successfully');
    } else {
        console.error('[Skill Check] FAILED to inject stat buttons - no suitable injection point found');
        console.error('[Skill Check] Available elements:', {
            send_form: $('#send_form').length,
            send_textarea: $('#send_textarea').length,
            send_but: $('#send_but').length,
            mes_buttons: $('.mes_buttons').length
        });
    }
}

// Update stat button labels (called when names change)
function updateStatButtonLabels() {
    statKeys.forEach(statKey => {
        const btn = $(`.skill-check-btn[data-stat="${statKey}"]`);
        const displayName = getStatName(statKey);
        btn.text(displayName);
        btn.attr('title', `Roll ${displayName} check (Shift: advantage, Ctrl: disadvantage)`);
    });
    updateDcBadge();
}

// Escape text for safe embedding in HTML attributes/content
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Render a single inventory row (rows are identified by DOM position, kept in
// sync with the settings.inventory array order)
function renderInventoryRow(item) {
    return `
        <div class="skill-check-inventory-item">
            <input
                type="text"
                class="skill-check-item-name text_pole"
                value="${escapeHtml(item.name)}"
                placeholder="Item name"
            />
            <input
                type="number"
                class="skill-check-item-quantity text_pole"
                min="1"
                value="${item.quantity}"
                title="Quantity"
            />
            <button class="skill-check-item-delete menu_button" title="Remove item">×</button>
        </div>
    `;
}

// Render a single spell row
function renderSpellRow(spell) {
    return `
        <div class="skill-check-spell-item">
            <input
                type="text"
                class="skill-check-spell-name text_pole"
                value="${escapeHtml(spell.name)}"
                placeholder="Spell name"
            />
            <button class="skill-check-spell-delete menu_button" title="Remove spell">×</button>
        </div>
    `;
}

// Render a single roll history entry
function renderRollHistoryEntry(r) {
    const modStr = r.modifier >= 0 ? `+${r.modifier}` : `${r.modifier}`;
    return `
        <div class="skill-check-roll-entry">
            <span class="roll-entry-main">${escapeHtml(r.stat)} ${formatRollDice(r.rolls, r.natural, r.mode)} ${modStr} = ${r.total} vs DC ${r.difficulty}</span>
            <span class="roll-entry-outcome outcome-${r.tier}">${outcomeTierLabels[r.tier] || r.tier}</span>
            ${r.source ? `<span class="roll-entry-source">${escapeHtml(r.source)}</span>` : ''}
        </div>
    `;
}

// Open character sheet popup
function openCharacterSheet(scrollPosition = 0) {
    // Remove existing popup if any
    $('#skill-check-sheet-popup').remove();

    const settings = extension_settings[extensionName];
    if (!settings.hp) settings.hp = { current: 20, max: 20 };
    if (!settings.outcomeTexts) settings.outcomeTexts = { ...defaultOutcomeTexts };

    const popup = $(`
        <div id="skill-check-sheet-popup" class="skill-check-popup-overlay">
            <div class="skill-check-popup">
                <div class="skill-check-popup-header">
                    <h3>Character Sheet</h3>
                    <button class="skill-check-popup-close" title="Close">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div class="skill-check-popup-content">
                    <div class="skill-check-popup-section">
                        <h4>Difficulty</h4>
                        <label class="checkbox_label skill-check-toggle">
                            <input id="skill-check-use-llm-dc" type="checkbox" ${settings.useLlmDifficulty ? 'checked' : ''} />
                            <span>Use AI-declared difficulty ([SKILL DC] tags)</span>
                        </label>
                        <small>The AI sets the DC for challenges it presents via [SKILL DC: 15] tags</small>
                        <label class="checkbox_label skill-check-toggle">
                            <input id="skill-check-inject-gm" type="checkbox" ${settings.injectGmInstructions ? 'checked' : ''} />
                            <span>Inject GM instructions into context</span>
                        </label>
                        <small>Teaches the AI to declare DCs and manage your inventory with tags</small>
                        <label class="checkbox_label skill-check-toggle">
                            <input id="skill-check-inject-sheet" type="checkbox" ${settings.injectCharacterSheet ? 'checked' : ''} />
                            <span>Inject character sheet into context</span>
                        </label>
                        <small>Provides the AI with your current stats, inventory, and spells</small>
                        <label class="checkbox_label skill-check-toggle">
                            <input id="skill-check-hide-tags" type="checkbox" ${settings.hideTagsInChat ? 'checked' : ''} />
                            <span>Hide tags in chat display</span>
                        </label>
                        <small>Cosmetically removes tags from rendered messages (the message text itself is unchanged; reload the chat to restore already-hidden tags)</small>
                        <label class="checkbox_label skill-check-toggle">
                            <input id="skill-check-append-without-sending" type="checkbox" ${settings.appendRollWithoutSending ? 'checked' : ''} />
                            <span>Append roll without auto-sending</span>
                        </label>
                        <small>Add roll result to message but don't send automatically (lets you review first)</small>
                        <div class="skill-check-challenge-info">
                            <small>Current challenge:</small>
                            <div id="skill-check-detected-challenge" class="skill-check-detected">
                                ${getCurrentChallengeDisplay()}
                            </div>
                        </div>
                        <div class="skill-check-manual-override">
                            <small>Next roll DC override (0 = off, applies to next roll only):</small>
                            <input
                                id="skill-check-next-dc"
                                type="number"
                                min="0"
                                max="30"
                                value="${settings.nextRollDc}"
                                class="text_pole"
                            />
                        </div>
                    </div>

                    <div class="skill-check-popup-section">
                        <h4>Default Difficulty (DC)</h4>
                        <small>Used when the AI hasn't declared a DC</small>
                        <div class="skill-check-difficulty-row">
                            <input
                                id="skill-check-popup-difficulty"
                                type="number"
                                min="1"
                                max="30"
                                value="${settings.difficulty}"
                                class="text_pole"
                            />
                            <select id="skill-check-difficulty-preset" class="text_pole">
                                <option value="">Presets...</option>
                                <option value="5">Very Easy (5)</option>
                                <option value="10">Easy (10)</option>
                                <option value="12">Medium (12)</option>
                                <option value="15">Hard (15)</option>
                                <option value="20">Very Hard (20)</option>
                                <option value="25">Nearly Impossible (25)</option>
                            </select>
                        </div>
                    </div>

                    <div class="skill-check-popup-section">
                        <h4>Stats</h4>
                        ${settings.unconfirmedLevelUps > 0 ? `
                            <div class="skill-check-levelup-available">
                                <span>Level up available! (+${settings.unconfirmedLevelUps})</span>
                                <button id="skill-check-apply-levelup" class="menu_button">Apply</button>
                            </div>
                        ` : ''}
                        <div class="skill-check-level-row">
                            <span class="skill-check-level-label">Level</span>
                            <div class="skill-check-level-controls">
                                <button class="skill-check-level-decrement menu_button" title="Decrease level">-</button>
                                <input
                                    id="skill-check-level-input"
                                    type="number"
                                    class="skill-check-level-input text_pole"
                                    min="1"
                                    max="20"
                                    value="${settings.level}"
                                />
                                <button class="skill-check-level-increment menu_button" title="Increase level">+</button>
                            </div>
                            ${settings.pendingLevelUps > 0 ? `<span class="skill-check-pending-levels">(${settings.pendingLevelUps} point${settings.pendingLevelUps > 1 ? 's' : ''} to spend!)</span>` : ''}
                        </div>
                        <div class="skill-check-hp-row">
                            <span class="skill-check-level-label">HP</span>
                            <input
                                id="skill-check-hp-current"
                                type="number"
                                min="0"
                                class="text_pole skill-check-hp-input"
                                value="${settings.hp.current}"
                                title="Current HP"
                            />
                            <span class="skill-check-hp-sep">/</span>
                            <input
                                id="skill-check-hp-max"
                                type="number"
                                min="1"
                                class="text_pole skill-check-hp-input"
                                value="${settings.hp.max}"
                                title="Maximum HP"
                            />
                        </div>
                        <label class="checkbox_label skill-check-toggle">
                            <input id="skill-check-dnd-style" type="checkbox" ${settings.useDndStyle ? 'checked' : ''} />
                            <span>Use D&D style stats (10 = +0)</span>
                        </label>
                        <small>${settings.useDndStyle ? 'Modifier = (stat - 10) / 2' : 'Stat value IS your bonus'}</small>
                        <div class="skill-check-popup-stats">
                            ${statKeys.map(statKey => {
                                const statName = settings.statNames[statKey];
                                const statValue = settings.stats[statKey];
                                const modifier = getModifier(statValue);
                                const modStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;
                                return `
                                    <div class="skill-check-popup-stat-row" data-stat="${statKey}">
                                        <input
                                            type="text"
                                            class="skill-check-stat-name-input text_pole"
                                            value="${statName}"
                                            maxlength="6"
                                            title="Click to edit stat name"
                                        />
                                        <div class="skill-check-stat-controls">
                                            <button class="skill-check-stat-decrement menu_button" title="Decrease ${statName}">-</button>
                                            <input
                                                type="number"
                                                class="skill-check-stat-value-input text_pole"
                                                min="${settings.useDndStyle ? '1' : '-10'}"
                                                max="30"
                                                value="${statValue}"
                                            />
                                            <button class="skill-check-stat-increment-btn menu_button" title="Increase ${statName}">+</button>
                                        </div>
                                        <span class="skill-check-stat-modifier ${settings.useDndStyle ? '' : 'hidden'}">(${modStr})</span>
                                        <button class="skill-check-stat-levelup menu_button ${settings.pendingLevelUps > 0 ? '' : 'hidden'}" title="Spend 1 point">+1</button>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>

                    <div class="skill-check-popup-section">
                        <h4>Inventory</h4>
                        <small>Managed by the AI via [ITEM GAINED: ...] / [ITEM LOST: ...] tags</small>
                        <div class="skill-check-inventory-list">
                            ${settings.inventory && settings.inventory.length > 0
                                ? settings.inventory.map(renderInventoryRow).join('')
                                : '<div class="skill-check-empty-list">No items in inventory</div>'}
                        </div>
                        <button id="skill-check-add-item" class="menu_button">
                            <i class="fa-solid fa-plus"></i> Add Item
                        </button>
                    </div>

                    <div class="skill-check-popup-section">
                        <h4>Spells</h4>
                        <small>Managed by the AI via [SPELL LEARNED: ...] / [SPELL FORGOTTEN: ...] tags</small>
                        <div class="skill-check-spells-list">
                            ${settings.spells && settings.spells.length > 0
                                ? settings.spells.map(renderSpellRow).join('')
                                : '<div class="skill-check-empty-list">No spells learned</div>'}
                        </div>
                        <button id="skill-check-add-spell" class="menu_button">
                            <i class="fa-solid fa-plus"></i> Add Spell
                        </button>
                    </div>

                    <div class="skill-check-popup-section">
                        <h4>Recent Rolls</h4>
                        <div class="skill-check-roll-history">
                            ${settings.rollHistory && settings.rollHistory.length > 0
                                ? settings.rollHistory.map(renderRollHistoryEntry).join('')
                                : '<div class="skill-check-empty-list">No rolls yet</div>'}
                        </div>
                    </div>

                    <div class="skill-check-popup-section">
                        <h4>Outcome Instructions</h4>
                        <small>What the AI is told after each roll. Edit to change how outcomes are narrated.</small>
                        ${Object.keys(defaultOutcomeTexts).map(tier => `
                            <label class="skill-check-outcome-label outcome-${tier}">${outcomeTierLabels[tier]}</label>
                            <textarea
                                class="skill-check-outcome-text text_pole"
                                data-tier="${tier}"
                                rows="2"
                            >${escapeHtml(settings.outcomeTexts[tier] || defaultOutcomeTexts[tier])}</textarea>
                        `).join('')}
                        <button id="skill-check-reset-outcomes" class="menu_button">Reset outcome texts</button>
                    </div>

                    <div class="skill-check-popup-section">
                        <button id="skill-check-reset-defaults" class="menu_button">
                            <i class="fa-solid fa-rotate-left"></i> Reset
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `);

    // Add to body
    $('body').append(popup);

    // Restore scroll position
    if (scrollPosition > 0) {
        popup.find('.skill-check-popup').scrollTop(scrollPosition);
    }

    // --- In-place refresh helpers ---

    function refreshStatRow(statRow, statKey) {
        const value = settings.stats[statKey];
        statRow.find('.skill-check-stat-value-input').val(value);
        const modifier = getModifier(value);
        const modStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;
        statRow.find('.skill-check-stat-modifier').text(`(${modStr})`);
    }

    function refreshPendingPoints() {
        const span = popup.find('.skill-check-pending-levels');
        if (settings.pendingLevelUps > 0) {
            const text = `(${settings.pendingLevelUps} point${settings.pendingLevelUps > 1 ? 's' : ''} to spend!)`;
            if (span.length) {
                span.text(text);
            } else {
                popup.find('.skill-check-level-row').append(`<span class="skill-check-pending-levels">${text}</span>`);
            }
            popup.find('.skill-check-stat-levelup').removeClass('hidden');
        } else {
            span.remove();
            popup.find('.skill-check-stat-levelup').addClass('hidden');
        }
    }

    // --- Close handlers ---

    // Close button handler
    popup.find('.skill-check-popup-close').on('click', function() {
        popup.remove();
    });

    // Click outside to close
    popup.on('click', function(e) {
        if (e.target === popup[0]) {
            popup.remove();
        }
    });

    // Escape key to close
    $(document).on('keydown.skillCheckPopup', function(e) {
        if (e.key === 'Escape') {
            popup.remove();
            $(document).off('keydown.skillCheckPopup');
        }
    });

    // --- Difficulty section handlers ---

    // Difficulty input handler
    popup.find('#skill-check-popup-difficulty').on('change', function() {
        const value = parseInt($(this).val()) || 12;
        settings.difficulty = Math.max(1, Math.min(30, value));
        $(this).val(settings.difficulty);
        saveSettingsDebounced();
    });

    // Difficulty preset handler
    popup.find('#skill-check-difficulty-preset').on('change', function() {
        const value = parseInt($(this).val());
        if (value) {
            settings.difficulty = value;
            popup.find('#skill-check-popup-difficulty').val(value);
            saveSettingsDebounced();
        }
        $(this).val(''); // Reset dropdown
    });

    // AI-declared difficulty toggle handler
    popup.find('#skill-check-use-llm-dc').on('change', function() {
        settings.useLlmDifficulty = $(this).prop('checked');
        saveSettingsDebounced();
        popup.find('#skill-check-detected-challenge').html(getCurrentChallengeDisplay());
        updateDcBadge();
    });

    // Inject GM instructions toggle handler
    popup.find('#skill-check-inject-gm').on('change', function() {
        settings.injectGmInstructions = $(this).prop('checked');
        saveSettingsDebounced();
        updateCharacterSheetPrompt();
    });

    // Inject character sheet toggle handler
    popup.find('#skill-check-inject-sheet').on('change', function() {
        settings.injectCharacterSheet = $(this).prop('checked');
        saveSettingsDebounced();
        updateCharacterSheetPrompt();
    });

    // Hide tags toggle handler
    popup.find('#skill-check-hide-tags').on('change', function() {
        settings.hideTagsInChat = $(this).prop('checked');
        saveSettingsDebounced();
        if (settings.hideTagsInChat) {
            applyTagHiding();
        }
    });

    // Append without sending toggle handler
    popup.find('#skill-check-append-without-sending').on('change', function() {
        settings.appendRollWithoutSending = $(this).prop('checked');
        saveSettingsDebounced();
    });

    // One-shot manual DC override handler
    popup.find('#skill-check-next-dc').on('change', function() {
        const value = parseInt($(this).val()) || 0;
        settings.nextRollDc = Math.max(0, Math.min(30, value));
        $(this).val(settings.nextRollDc);
        saveSettingsDebounced();
        popup.find('#skill-check-detected-challenge').html(getCurrentChallengeDisplay());
        updateDcBadge();
    });

    // --- Stats section handlers ---

    // Apply pending level-up offer
    popup.find('#skill-check-apply-levelup').on('click', function() {
        const count = settings.unconfirmedLevelUps;
        if (count <= 0) return;
        applyLevelUp(count);
        popup.find('#skill-check-level-input').val(settings.level);
        popup.find('.skill-check-levelup-available').remove();
        refreshPendingPoints();
    });

    // Stat name input handler
    popup.find('.skill-check-stat-name-input').on('change', function() {
        const statKey = $(this).closest('.skill-check-popup-stat-row').data('stat');
        let value = $(this).val().trim().toUpperCase();
        if (!value) value = statKey.toUpperCase();
        if (value.length > 6) value = value.substring(0, 6);
        settings.statNames[statKey] = value;
        $(this).val(value);
        saveSettingsDebounced();
        updateStatButtonLabels();
        updateCharacterSheetPrompt();
    });

    // DND style toggle handler (rare toggle - full refresh is acceptable here
    // because it changes input ranges and modifier visibility everywhere)
    popup.find('#skill-check-dnd-style').on('change', function() {
        settings.useDndStyle = $(this).prop('checked');
        saveSettingsDebounced();
        updateCharacterSheetPrompt();
        const scrollPos = popup.find('.skill-check-popup').scrollTop();
        popup.remove();
        openCharacterSheet(scrollPos);
    });

    // Stat value input handler
    popup.find('.skill-check-stat-value-input').on('change', function() {
        const statRow = $(this).closest('.skill-check-popup-stat-row');
        const statKey = statRow.data('stat');
        const value = parseInt($(this).val()) || 0;
        const minVal = settings.useDndStyle ? 1 : -10;
        settings.stats[statKey] = Math.max(minVal, Math.min(30, value));
        refreshStatRow(statRow, statKey);
        saveSettingsDebounced();
        updateCharacterSheetPrompt();
    });

    // Stat decrement button handler
    popup.find('.skill-check-stat-decrement').on('click', function() {
        const statRow = $(this).closest('.skill-check-popup-stat-row');
        const statKey = statRow.data('stat');
        const minVal = settings.useDndStyle ? 1 : -10;
        if (settings.stats[statKey] > minVal) {
            settings.stats[statKey] -= 1;
            refreshStatRow(statRow, statKey);
            saveSettingsDebounced();
            updateCharacterSheetPrompt();
        }
    });

    // Stat increment button handler
    popup.find('.skill-check-stat-increment-btn').on('click', function() {
        const statRow = $(this).closest('.skill-check-popup-stat-row');
        const statKey = statRow.data('stat');
        if (settings.stats[statKey] < 30) {
            settings.stats[statKey] += 1;
            refreshStatRow(statRow, statKey);
            saveSettingsDebounced();
            updateCharacterSheetPrompt();
        }
    });

    // Stat level-up button handler (for spending level-up points)
    popup.find('.skill-check-stat-levelup').on('click', function() {
        if (settings.pendingLevelUps <= 0) return;
        const statRow = $(this).closest('.skill-check-popup-stat-row');
        const statKey = statRow.data('stat');
        settings.stats[statKey] += 1;
        settings.pendingLevelUps -= 1;
        refreshStatRow(statRow, statKey);
        refreshPendingPoints();
        saveSettingsDebounced();
        updateCharacterSheetPrompt();
    });

    // Level input handler
    popup.find('#skill-check-level-input').on('change', function() {
        const value = parseInt($(this).val()) || 1;
        settings.level = Math.max(1, Math.min(20, value));
        $(this).val(settings.level);
        saveSettingsDebounced();
        updateCharacterSheetPrompt();
    });

    // Level decrement button handler
    popup.find('.skill-check-level-decrement').on('click', function() {
        if (settings.level > 1) {
            settings.level -= 1;
            popup.find('#skill-check-level-input').val(settings.level);
            saveSettingsDebounced();
            updateCharacterSheetPrompt();
        }
    });

    // Level increment button handler
    popup.find('.skill-check-level-increment').on('click', function() {
        if (settings.level < 20) {
            settings.level += 1;
            popup.find('#skill-check-level-input').val(settings.level);
            saveSettingsDebounced();
            updateCharacterSheetPrompt();
        }
    });

    // HP handlers
    popup.find('#skill-check-hp-current').on('change', function() {
        const value = parseInt($(this).val()) || 0;
        settings.hp.current = Math.max(0, Math.min(settings.hp.max, value));
        $(this).val(settings.hp.current);
        saveSettingsDebounced();
        updateCharacterSheetPrompt();
    });

    popup.find('#skill-check-hp-max').on('change', function() {
        const value = parseInt($(this).val()) || 1;
        settings.hp.max = Math.max(1, value);
        settings.hp.current = Math.min(settings.hp.current, settings.hp.max);
        $(this).val(settings.hp.max);
        popup.find('#skill-check-hp-current').val(settings.hp.current);
        saveSettingsDebounced();
        updateCharacterSheetPrompt();
    });

    // --- Inventory handlers (delegated; rows are matched to the array by DOM position) ---

    const invList = popup.find('.skill-check-inventory-list');

    invList.on('change', '.skill-check-item-name', function() {
        const row = $(this).closest('.skill-check-inventory-item');
        const index = invList.children('.skill-check-inventory-item').index(row);
        const newName = $(this).val().trim();
        if (newName && settings.inventory[index]) {
            settings.inventory[index].name = newName;
            saveSettingsDebounced();
            updateCharacterSheetPrompt();
        }
    });

    invList.on('change', '.skill-check-item-quantity', function() {
        const row = $(this).closest('.skill-check-inventory-item');
        const index = invList.children('.skill-check-inventory-item').index(row);
        const newQuantity = parseInt($(this).val()) || 1;
        if (settings.inventory[index]) {
            settings.inventory[index].quantity = Math.max(1, newQuantity);
            $(this).val(settings.inventory[index].quantity);
            saveSettingsDebounced();
            updateCharacterSheetPrompt();
        }
    });

    invList.on('click', '.skill-check-item-delete', function() {
        const row = $(this).closest('.skill-check-inventory-item');
        const index = invList.children('.skill-check-inventory-item').index(row);
        if (settings.inventory[index]) {
            settings.inventory.splice(index, 1);
            saveSettingsDebounced();
            updateCharacterSheetPrompt();
            row.remove();
            if (settings.inventory.length === 0) {
                invList.html('<div class="skill-check-empty-list">No items in inventory</div>');
            }
        }
    });

    // Add item: append an editable row inline (no blocking prompt dialogs)
    popup.find('#skill-check-add-item').on('click', function() {
        settings.inventory.push({ name: 'new item', quantity: 1 });
        saveSettingsDebounced();
        invList.find('.skill-check-empty-list').remove();
        const row = $(renderInventoryRow(settings.inventory[settings.inventory.length - 1]));
        invList.append(row);
        const nameInput = row.find('.skill-check-item-name');
        nameInput.trigger('focus');
        nameInput[0].select();
    });

    // --- Spell handlers (delegated) ---

    const spellList = popup.find('.skill-check-spells-list');

    spellList.on('change', '.skill-check-spell-name', function() {
        const row = $(this).closest('.skill-check-spell-item');
        const index = spellList.children('.skill-check-spell-item').index(row);
        const newName = $(this).val().trim();
        if (newName && settings.spells[index]) {
            settings.spells[index].name = newName;
            saveSettingsDebounced();
            updateCharacterSheetPrompt();
        }
    });

    spellList.on('click', '.skill-check-spell-delete', function() {
        const row = $(this).closest('.skill-check-spell-item');
        const index = spellList.children('.skill-check-spell-item').index(row);
        if (settings.spells[index]) {
            settings.spells.splice(index, 1);
            saveSettingsDebounced();
            updateCharacterSheetPrompt();
            row.remove();
            if (settings.spells.length === 0) {
                spellList.html('<div class="skill-check-empty-list">No spells learned</div>');
            }
        }
    });

    // Add spell: append an editable row inline
    popup.find('#skill-check-add-spell').on('click', function() {
        settings.spells.push({ name: 'new spell' });
        saveSettingsDebounced();
        spellList.find('.skill-check-empty-list').remove();
        const row = $(renderSpellRow(settings.spells[settings.spells.length - 1]));
        spellList.append(row);
        const nameInput = row.find('.skill-check-spell-name');
        nameInput.trigger('focus');
        nameInput[0].select();
    });

    // --- Outcome instruction handlers ---

    popup.find('.skill-check-outcome-text').on('change', function() {
        const tier = $(this).data('tier');
        const value = $(this).val().trim();
        settings.outcomeTexts[tier] = value || defaultOutcomeTexts[tier];
        $(this).val(settings.outcomeTexts[tier]);
        saveSettingsDebounced();
    });

    popup.find('#skill-check-reset-outcomes').on('click', function() {
        settings.outcomeTexts = { ...defaultOutcomeTexts };
        saveSettingsDebounced();
        popup.find('.skill-check-outcome-text').each(function() {
            $(this).val(defaultOutcomeTexts[$(this).data('tier')]);
        });
    });

    // --- Reset ---

    // Reset to defaults handler
    popup.find('#skill-check-reset-defaults').on('click', function() {
        if (confirm('Reset character sheet? This will clear stats, level, HP, inventory, and spells.')) {
            settings.stats = { ...defaultSettings.stats };
            settings.statNames = { ...defaultSettings.statNames };
            settings.difficulty = defaultSettings.difficulty;
            settings.level = 1;
            settings.pendingLevelUps = 0;
            settings.unconfirmedLevelUps = 0;
            settings.hp = { current: 20, max: 20 };
            settings.inventory = [];
            settings.spells = [];
            saveSettingsDebounced();
            updateStatButtonLabels();
            updateSheetButtonBadge();
            updateCharacterSheetPrompt();
            const scrollPos = popup.find('.skill-check-popup').scrollTop();
            popup.remove();
            openCharacterSheet(scrollPos); // Reopen with fresh values
        }
    });
}

// Create settings panel (kept minimal - the character sheet popup is the
// single source of truth for stats, difficulty, and everything else)
function createSettingsPanel() {
    console.log('[Skill Check] Creating settings panel...');

    const settingsHtml = `
        <div id="skill-check-settings" class="skill-check-settings-panel">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Skill Check Settings</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="skill-check-settings-content">
                        <label class="checkbox_label">
                            <input id="skill-check-enabled" type="checkbox" />
                            <span>Enable Skill Check Extension</span>
                        </label>

                        <hr>

                        <button id="skill-check-open-sheet" class="menu_button">
                            <i class="fa-solid fa-scroll"></i> Open Character Sheet
                        </button>
                        <small>All stats, difficulty, HP, inventory, spells, and roll settings live in the character sheet popup (also available via the scroll icon next to the stat buttons).</small>

                        <hr>

                        <div class="skill-check-help">
                            <h4>How It Works</h4>
                            <ul>
                                <li>The AI declares challenge difficulty with [SKILL DC: 15] tags</li>
                                <li>Type your action, then click a stat button to roll 1d20 + modifier</li>
                                <li>Shift-click for advantage, Ctrl-click for disadvantage</li>
                                <li>The outcome (not the numbers) is injected into your message</li>
                                <li>The AI manages your inventory, spells, HP, and level via tags</li>
                            </ul>

                            <h4>Outcome Tiers</h4>
                            <ul>
                                <li><strong>Critical Failure:</strong> Natural 1 OR fails by 4+ (total ≤ difficulty - 4)</li>
                                <li><strong>Failure:</strong> Total < difficulty</li>
                                <li><strong>Success:</strong> Total ≥ difficulty</li>
                                <li><strong>Strong Success:</strong> Exceeds by 4+ (total ≥ difficulty + 4) OR natural 20</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    const settingsContainer = $('#extensions_settings2');
    if (settingsContainer.length) {
        settingsContainer.append(settingsHtml);
        console.log('[Skill Check] Settings panel created successfully');
    } else {
        console.error('[Skill Check] Could not find #extensions_settings2 to inject settings panel');
    }

    // Load current settings into UI
    loadSettingsUI();

    // Add event listeners
    $('#skill-check-enabled').on('change', function() {
        extension_settings[extensionName].enabled = $(this).prop('checked');
        saveSettingsDebounced();
        toggleExtension();
    });

    $('#skill-check-open-sheet').on('click', function() {
        openCharacterSheet();
    });
}

// Load settings into UI
function loadSettingsUI() {
    const settings = extension_settings[extensionName];
    $('#skill-check-enabled').prop('checked', settings.enabled);
}

// Toggle extension visibility
function toggleExtension() {
    const settings = extension_settings[extensionName];
    if (settings.enabled) {
        $('#skill-check-buttons').show();
    } else {
        $('#skill-check-buttons').hide();
    }
}

// Initialize extension
jQuery(async () => {
    try {
        console.log('[Skill Check] ========================================');
        console.log('[Skill Check] Extension loading...');
        console.log('[Skill Check] jQuery version:', $.fn.jquery);
        console.log('[Skill Check] Extension settings available:', typeof extension_settings !== 'undefined');

        // Initialize settings
        if (!extension_settings[extensionName]) {
            console.log('[Skill Check] Creating new settings with defaults');
            extension_settings[extensionName] = JSON.parse(JSON.stringify(defaultSettings));
        } else {
            console.log('[Skill Check] Merging existing settings with defaults');
            // Merge with defaults to ensure all properties exist
            extension_settings[extensionName] = Object.assign(
                {},
                defaultSettings,
                extension_settings[extensionName]
            );

            // Ensure all stats exist
            extension_settings[extensionName].stats = Object.assign(
                {},
                defaultSettings.stats,
                extension_settings[extensionName].stats
            );

            // Ensure all stat names exist
            extension_settings[extensionName].statNames = Object.assign(
                {},
                defaultSettings.statNames,
                extension_settings[extensionName].statNames
            );

            // Ensure inventory and spells arrays exist
            if (!extension_settings[extensionName].inventory) {
                extension_settings[extensionName].inventory = [];
            }
            if (!extension_settings[extensionName].spells) {
                extension_settings[extensionName].spells = [];
            }

            // Ensure newer structured settings exist
            if (!extension_settings[extensionName].hp) {
                extension_settings[extensionName].hp = { ...defaultSettings.hp };
            }
            extension_settings[extensionName].outcomeTexts = Object.assign(
                {},
                defaultOutcomeTexts,
                extension_settings[extensionName].outcomeTexts
            );
            if (!extension_settings[extensionName].rollHistory) {
                extension_settings[extensionName].rollHistory = [];
            }
        }

        console.log('[Skill Check] Settings initialized:', extension_settings[extensionName]);

        // Create UI elements
        createStatButtons();
        createSettingsPanel();

        // Set initial visibility
        toggleExtension();

        // Set up tag processing on incoming messages
        setupMessageTagProcessing();

        // Initialize character sheet prompt
        updateCharacterSheetPrompt();

        // Initialize chat-dependent UI
        updateSheetButtonBadge();
        updateDcBadge();
        setupTagHidingObserver();
        applyTagHiding();

        console.log('[Skill Check] ✓ Extension loaded successfully');
        console.log('[Skill Check] ========================================');
    } catch (error) {
        console.error('[Skill Check] ========================================');
        console.error('[Skill Check] FATAL ERROR during initialization:');
        console.error('[Skill Check]', error);
        console.error('[Skill Check]', error.stack);
        console.error('[Skill Check] ========================================');
    }
});
