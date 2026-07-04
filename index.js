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
    lastProcessedMessageIndex: -1, // Track last message index processed for tags
    inventory: [], // Array of { name: string, quantity: number }
    spells: [], // Array of { name: string }
    injectCharacterSheet: true, // Inject character sheet into context
    appendRollWithoutSending: true // If true, append roll to message but don't auto-send
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
        return { difficulty: dc, source: 'Manual DC' };
    }

    // AI-declared difficulty via [SKILL DC] tags
    if (settings.useLlmDifficulty) {
        const recentMessages = getRecentContext(settings.contextMessages || 5);
        const tag = findLatestDcTag(recentMessages);
        if (tag) {
            const statDc = tag.dcs[statDisplayName.toUpperCase()];
            const dc = statDc !== undefined ? statDc : tag.dcs.ANY;
            if (dc !== undefined) {
                const source = tag.label || 'AI-declared DC';
                console.log('[Skill Check] Using AI-declared difficulty:', dc, 'source:', source);
                return { difficulty: dc, source: source };
            }
            console.log('[Skill Check] DC tag found but has no DC for', statDisplayName, '- falling back to default');
        }
    }

    // Fall back to default difficulty
    console.log('[Skill Check] Falling back to default difficulty:', settings.difficulty);
    return { difficulty: settings.difficulty, source: null };
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

    // Ignore button - just dismiss
    toast.find('.levelup-ignore').on('click', function() {
        toast.remove();
    });

    $('body').append(toast);

    // Auto-dismiss after 15 seconds
    setTimeout(() => {
        // If still visible, treat as ignored
        if (toast.is(':visible')) {
            toast.fadeOut(300, () => toast.remove());
        }
    }, 15000);
}

// Apply level-up: grant levels and pending stat points
function applyLevelUp(count) {
    const settings = extension_settings[extensionName];
    settings.level += count;
    settings.pendingLevelUps += count;
    saveSettingsDebounced();

    console.log(`[Skill Check] Level up applied! +${count} level(s), now level ${settings.level}, ${settings.pendingLevelUps} pending point(s)`);
}

// Process the most recent AI message for state tags (items, spells, level-ups).
// Each message is processed exactly once, tracked via lastProcessedMessageIndex.
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
            saveSettingsDebounced();
        }

        // Find the most recent AI message and process its tags once
        for (let i = chat.length - 1; i >= 0; i--) {
            const msg = chat[i];
            if (msg.is_user) continue;

            if (i <= settings.lastProcessedMessageIndex) {
                console.log(`[Skill Check] Message ${i} already processed, skipping`);
                break;
            }

            if (msg.mes) {
                console.log(`[Skill Check] Processing message ${i} for tags:`, msg.mes.substring(0, 200));
                processMessageTags(msg.mes);
            }

            settings.lastProcessedMessageIndex = i;
            saveSettingsDebounced();
            break;
        }
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

// Remove item from inventory
function removeFromInventory(itemName, quantity = 1) {
    const settings = extension_settings[extensionName];
    if (!settings.inventory) settings.inventory = [];

    const existing = settings.inventory.find(item =>
        item.name.toLowerCase() === itemName.toLowerCase()
    );

    if (existing) {
        existing.quantity -= quantity;
        if (existing.quantity <= 0) {
            // Remove item completely if quantity is 0 or less
            settings.inventory = settings.inventory.filter(item => item !== existing);
        }
        saveSettingsDebounced();
        console.log(`[Skill Check] Removed ${quantity}x ${itemName} from inventory`);
    }
}

// Add spell to spell list
function addSpell(spellName) {
    const settings = extension_settings[extensionName];
    if (!settings.spells) settings.spells = [];

    // Check if spell already exists (case insensitive)
    const exists = settings.spells.some(spell =>
        spell.name.toLowerCase() === spellName.toLowerCase()
    );

    if (!exists) {
        settings.spells.push({ name: spellName });
        saveSettingsDebounced();
        console.log(`[Skill Check] Learned spell: ${spellName}`);
    }
}

// Remove spell from spell list
function removeSpell(spellName) {
    const settings = extension_settings[extensionName];
    if (!settings.spells) settings.spells = [];

    const before = settings.spells.length;
    settings.spells = settings.spells.filter(spell =>
        spell.name.toLowerCase() !== spellName.toLowerCase()
    );

    if (settings.spells.length < before) {
        saveSettingsDebounced();
        console.log(`[Skill Check] Forgot spell: ${spellName}`);
    }
}

// Process all state tags in an AI message (items, spells, level-ups)
function processMessageTags(text) {
    // Inventory additions
    const additions = detectInventoryAdditions(text);
    for (const item of additions) {
        addToInventory(item.name, item.quantity);
    }

    // Inventory removals
    const removals = detectInventoryRemovals(text);
    for (const item of removals) {
        removeFromInventory(item.name, item.quantity);
    }

    // Spells learned
    const spells = detectSpellLearning(text);
    for (const spellName of spells) {
        addSpell(spellName);
    }

    // Spells forgotten
    const forgotten = detectSpellRemovals(text);
    for (const spellName of forgotten) {
        removeSpell(spellName);
    }

    // Level-ups (shown as a confirmation toast)
    const levelUp = detectLevelUp(text);
    if (levelUp.detected) {
        console.log(`[Skill Check] ✓ Level-up tag detected: +${levelUp.count} level(s)`);
        showLevelUpToast(levelUp.count);
    }

    // Update character sheet prompt after changes
    updateCharacterSheetPrompt();
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

// Set up tag processing on incoming AI messages
function setupMessageTagProcessing() {
    console.log('[Skill Check] ===== Setting up message tag processing =====');
    console.log('[Skill Check] eventSource available:', typeof eventSource !== 'undefined');

    // Try to hook into SillyTavern events if available
    if (typeof eventSource !== 'undefined') {
        try {
            eventSource.on('message_received', () => {
                console.log('[Skill Check] message_received event fired');
                setTimeout(processIncomingMessage, 500); // Small delay to ensure message is in context
            });
            console.log('[Skill Check] ✓ Tag processing hooked into message_received event');
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

// Determine outcome tier
function determineOutcome(naturalRoll, total, difficulty) {
    // Critical Failure: natural 1 OR fails by 4+
    if (naturalRoll === 1 || total <= difficulty - 4) {
        return {
            tier: 'critical_failure',
            text: 'FAILED BADLY. Narrate a serious setback, complication, or injury. Do not soften the failure. Do not speak for the user.'
        };
    }

    // Strong Success: exceeds difficulty by 4+ OR natural 20
    if ((total >= difficulty + 4) || naturalRoll === 20) {
        return {
            tier: 'strong_success',
            text: 'SUCCEEDED EXCEPTIONALLY. Narrate an impressive, skillful, or lucky outcome. Do not speak for the user.'
        };
    }

    // Success: total >= difficulty
    if (total >= difficulty) {
        return {
            tier: 'success',
            text: 'SUCCEEDED. Narrate the user achieving their goal. Do not speak for the user.'
        };
    }

    // Failure: total < difficulty (but not critical)
    return {
        tier: 'failure',
        text: 'FAILED. Narrate the user not achieving their goal. There may be minor consequences. Do not speak for the user.'
    };
}

// Show toast notification
function showRollResult(stat, naturalRoll, modifier, total, outcome, challengeInfo) {
    const { difficulty, source } = challengeInfo;
    const modStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;
    const vsText = source ? `vs ${source} (DC ${difficulty})` : `(DC ${difficulty})`;

    const toast = $(`
        <div class="skill-check-toast">
            <strong>${stat} Check ${vsText}</strong><br>
            <span class="roll-math">${naturalRoll} ${modStr} = ${total}</span><br>
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

// Perform skill check and send message
async function performSkillCheck(statKey) {
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

    // Roll the dice
    const naturalRoll = rollD20();
    const total = naturalRoll + modifier;

    // Determine outcome using the challenge difficulty
    const outcome = determineOutcome(naturalRoll, total, challengeInfo.difficulty);

    // Show result to user
    showRollResult(statDisplayName, naturalRoll, modifier, total, outcome, challengeInfo);

    // Build the injection with challenge context
    const vsText = challengeInfo.source ? ` against ${challengeInfo.source}` : '';
    const injection = `[System: The user attempted an action${vsText} using ${statDisplayName}. They ${outcome.text}]`;
    textarea.value = userMessage ? `${userMessage}\n\n${injection}` : injection;

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
                    <button class="skill-check-btn" data-stat="${statKey}" title="Roll ${getStatName(statKey)} check">
                        ${getStatName(statKey)}
                    </button>
                `).join('')}
            </div>
            <button id="skill-check-sheet-btn" class="skill-check-sheet-btn" title="Edit Character Sheet">
                <i class="fa-solid fa-scroll"></i>
            </button>
        </div>
    `);

    // Add click handlers for stat buttons
    container.find('.skill-check-btn').on('click', function() {
        const statKey = $(this).data('stat');
        performSkillCheck(statKey);
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
        btn.attr('title', `Roll ${displayName} check`);
    });
}

// Open character sheet popup
function openCharacterSheet(scrollPosition = 0) {
    // Remove existing popup if any
    $('#skill-check-sheet-popup').remove();

    const settings = extension_settings[extensionName];

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
                            ${settings.inventory && settings.inventory.length > 0 ? settings.inventory.map((item, index) => `
                                <div class="skill-check-inventory-item" data-index="${index}">
                                    <input
                                        type="text"
                                        class="skill-check-item-name text_pole"
                                        value="${item.name}"
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
                            `).join('') : '<div class="skill-check-empty-list">No items in inventory</div>'}
                        </div>
                        <button id="skill-check-add-item" class="menu_button">
                            <i class="fa-solid fa-plus"></i> Add Item
                        </button>
                    </div>

                    <div class="skill-check-popup-section">
                        <h4>Spells</h4>
                        <small>Managed by the AI via [SPELL LEARNED: ...] / [SPELL FORGOTTEN: ...] tags</small>
                        <div class="skill-check-spells-list">
                            ${settings.spells && settings.spells.length > 0 ? settings.spells.map((spell, index) => `
                                <div class="skill-check-spell-item" data-index="${index}">
                                    <input
                                        type="text"
                                        class="skill-check-spell-name text_pole"
                                        value="${spell.name}"
                                        placeholder="Spell name"
                                    />
                                    <button class="skill-check-spell-delete menu_button" title="Remove spell">×</button>
                                </div>
                            `).join('') : '<div class="skill-check-empty-list">No spells learned</div>'}
                        </div>
                        <button id="skill-check-add-spell" class="menu_button">
                            <i class="fa-solid fa-plus"></i> Add Spell
                        </button>
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

    // Difficulty input handler
    popup.find('#skill-check-popup-difficulty').on('change', function() {
        const value = parseInt($(this).val()) || 12;
        settings.difficulty = Math.max(1, Math.min(30, value));
        $(this).val(settings.difficulty);
        saveSettingsDebounced();
        loadSettingsUI();
    });

    // Difficulty preset handler
    popup.find('#skill-check-difficulty-preset').on('change', function() {
        const value = parseInt($(this).val());
        if (value) {
            settings.difficulty = value;
            popup.find('#skill-check-popup-difficulty').val(value);
            saveSettingsDebounced();
            loadSettingsUI();
        }
        $(this).val(''); // Reset dropdown
    });

    // AI-declared difficulty toggle handler
    popup.find('#skill-check-use-llm-dc').on('change', function() {
        settings.useLlmDifficulty = $(this).prop('checked');
        saveSettingsDebounced();
        // Refresh the detected challenge display
        popup.find('#skill-check-detected-challenge').html(getCurrentChallengeDisplay());
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
        // Refresh the detected challenge display
        popup.find('#skill-check-detected-challenge').html(getCurrentChallengeDisplay());
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
        loadSettingsUI();
    });

    // DND style toggle handler
    popup.find('#skill-check-dnd-style').on('change', function() {
        settings.useDndStyle = $(this).prop('checked');
        saveSettingsDebounced();
        // Reopen popup to refresh the UI
        const scrollPos = popup.find('.skill-check-popup').scrollTop();
        popup.remove();
        openCharacterSheet(scrollPos);
    });

    // Stat value input handler
    popup.find('.skill-check-stat-value-input').on('change', function() {
        const statKey = $(this).closest('.skill-check-popup-stat-row').data('stat');
        const value = parseInt($(this).val()) || 0;
        const minVal = settings.useDndStyle ? 1 : -10;
        const clampedValue = Math.max(minVal, Math.min(30, value));
        settings.stats[statKey] = clampedValue;
        $(this).val(clampedValue);

        // Update modifier display
        const modifier = getModifier(clampedValue);
        const modStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;
        $(this).closest('.skill-check-popup-stat-row').find('.skill-check-stat-modifier').text(`(${modStr})`);

        saveSettingsDebounced();
        loadSettingsUI();
        updateCharacterSheetPrompt();
    });

    // Stat decrement button handler
    popup.find('.skill-check-stat-decrement').on('click', function() {
        const statRow = $(this).closest('.skill-check-popup-stat-row');
        const statKey = statRow.data('stat');
        const minVal = settings.useDndStyle ? 1 : -10;
        if (settings.stats[statKey] > minVal) {
            settings.stats[statKey] -= 1;
            saveSettingsDebounced();
            updateCharacterSheetPrompt();
            // Reopen popup to refresh the UI
            const scrollPos = popup.find('.skill-check-popup').scrollTop();
            popup.remove();
            openCharacterSheet(scrollPos);
        }
    });

    // Stat increment button handler
    popup.find('.skill-check-stat-increment-btn').on('click', function() {
        const statRow = $(this).closest('.skill-check-popup-stat-row');
        const statKey = statRow.data('stat');
        if (settings.stats[statKey] < 30) {
            settings.stats[statKey] += 1;
            saveSettingsDebounced();
            updateCharacterSheetPrompt();
            // Reopen popup to refresh the UI
            const scrollPos = popup.find('.skill-check-popup').scrollTop();
            popup.remove();
            openCharacterSheet(scrollPos);
        }
    });

    // Stat level-up button handler (for spending level-up points)
    popup.find('.skill-check-stat-levelup').on('click', function() {
        if (settings.pendingLevelUps <= 0) return;

        const statKey = $(this).closest('.skill-check-popup-stat-row').data('stat');
        settings.stats[statKey] += 1;
        settings.pendingLevelUps -= 1;
        saveSettingsDebounced();
        updateCharacterSheetPrompt();

        // Reopen popup to refresh the UI
        const scrollPos = popup.find('.skill-check-popup').scrollTop();
        popup.remove();
        openCharacterSheet(scrollPos);
    });

    // Level input handler
    popup.find('#skill-check-level-input').on('change', function() {
        const value = parseInt($(this).val()) || 1;
        const clampedValue = Math.max(1, Math.min(20, value));
        settings.level = clampedValue;
        $(this).val(clampedValue);
        saveSettingsDebounced();
        updateCharacterSheetPrompt();
        // Reopen popup to refresh the UI
        const scrollPos = popup.find('.skill-check-popup').scrollTop();
        popup.remove();
        openCharacterSheet(scrollPos);
    });

    // Level decrement button handler
    popup.find('.skill-check-level-decrement').on('click', function() {
        if (settings.level > 1) {
            settings.level -= 1;
            saveSettingsDebounced();
            updateCharacterSheetPrompt();
            // Reopen popup to refresh the UI
            const scrollPos = popup.find('.skill-check-popup').scrollTop();
            popup.remove();
            openCharacterSheet(scrollPos);
        }
    });

    // Level increment button handler
    popup.find('.skill-check-level-increment').on('click', function() {
        if (settings.level < 20) {
            settings.level += 1;
            saveSettingsDebounced();
            updateCharacterSheetPrompt();
            // Reopen popup to refresh the UI
            const scrollPos = popup.find('.skill-check-popup').scrollTop();
            popup.remove();
            openCharacterSheet(scrollPos);
        }
    });

    // Inventory item name change handler
    popup.find('.skill-check-item-name').on('change', function() {
        const index = $(this).closest('.skill-check-inventory-item').data('index');
        const newName = $(this).val().trim();
        if (newName && settings.inventory[index]) {
            settings.inventory[index].name = newName;
            saveSettingsDebounced();
        }
    });

    // Inventory item quantity change handler
    popup.find('.skill-check-item-quantity').on('change', function() {
        const index = $(this).closest('.skill-check-inventory-item').data('index');
        const newQuantity = parseInt($(this).val()) || 1;
        if (settings.inventory[index]) {
            settings.inventory[index].quantity = Math.max(1, newQuantity);
            $(this).val(settings.inventory[index].quantity);
            saveSettingsDebounced();
        }
    });

    // Inventory item delete handler
    popup.find('.skill-check-item-delete').on('click', function() {
        const index = $(this).closest('.skill-check-inventory-item').data('index');
        if (settings.inventory[index]) {
            settings.inventory.splice(index, 1);
            saveSettingsDebounced();
            // Reopen popup to refresh the UI
            const scrollPos = popup.find('.skill-check-popup').scrollTop();
            popup.remove();
            openCharacterSheet(scrollPos);
        }
    });

    // Add item button handler
    popup.find('#skill-check-add-item').on('click', function() {
        const itemName = prompt('Enter item name:');
        if (itemName && itemName.trim()) {
            const quantity = parseInt(prompt('Enter quantity:', '1')) || 1;
            addToInventory(itemName.trim(), quantity);
            // Reopen popup to refresh the UI
            const scrollPos = popup.find('.skill-check-popup').scrollTop();
            popup.remove();
            openCharacterSheet(scrollPos);
        }
    });

    // Spell name change handler
    popup.find('.skill-check-spell-name').on('change', function() {
        const index = $(this).closest('.skill-check-spell-item').data('index');
        const newName = $(this).val().trim();
        if (newName && settings.spells[index]) {
            settings.spells[index].name = newName;
            saveSettingsDebounced();
        }
    });

    // Spell delete handler
    popup.find('.skill-check-spell-delete').on('click', function() {
        const index = $(this).closest('.skill-check-spell-item').data('index');
        if (settings.spells[index]) {
            settings.spells.splice(index, 1);
            saveSettingsDebounced();
            // Reopen popup to refresh the UI
            const scrollPos = popup.find('.skill-check-popup').scrollTop();
            popup.remove();
            openCharacterSheet(scrollPos);
        }
    });

    // Add spell button handler
    popup.find('#skill-check-add-spell').on('click', function() {
        const spellName = prompt('Enter spell name:');
        if (spellName && spellName.trim()) {
            addSpell(spellName.trim());
            // Reopen popup to refresh the UI
            const scrollPos = popup.find('.skill-check-popup').scrollTop();
            popup.remove();
            openCharacterSheet(scrollPos);
        }
    });

    // Reset to defaults handler
    popup.find('#skill-check-reset-defaults').on('click', function() {
        if (confirm('Reset character sheet? This will clear stats, level, inventory, and spells.')) {
            settings.stats = { ...defaultSettings.stats };
            settings.statNames = { ...defaultSettings.statNames };
            settings.difficulty = defaultSettings.difficulty;
            settings.level = 1;
            settings.pendingLevelUps = 0;
            settings.inventory = [];
            settings.spells = [];
            saveSettingsDebounced();
            updateStatButtonLabels();
            loadSettingsUI();
            updateCharacterSheetPrompt();
            const scrollPos = popup.find('.skill-check-popup').scrollTop();
            popup.remove();
            openCharacterSheet(scrollPos); // Reopen with fresh values
        }
    });
}

// Create settings panel
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

                        <h4>Character Stats</h4>
                        <small>Set your character's ability scores (1-30). Default: 10</small>

                        <div class="skill-check-stats-grid">
                            ${statKeys.map(statKey => `
                                <div class="skill-check-stat-input">
                                    <label for="skill-check-stat-${statKey}" class="skill-check-stat-label" data-stat="${statKey}"></label>
                                    <input
                                        id="skill-check-stat-${statKey}"
                                        type="number"
                                        min="1"
                                        max="30"
                                        class="text_pole"
                                        data-stat="${statKey}"
                                    />
                                </div>
                            `).join('')}
                        </div>

                        <hr>

                        <h4>Difficulty</h4>
                        <small>Target number for skill checks (1-30). Default: 12</small>
                        <div class="skill-check-difficulty-input">
                            <input
                                id="skill-check-difficulty"
                                type="number"
                                min="1"
                                max="30"
                                class="text_pole"
                            />
                        </div>

                        <hr>

                        <div class="skill-check-help">
                            <h4>How It Works</h4>
                            <ul>
                                <li>Type your action in the message box</li>
                                <li>Click a stat button (STR, DEX, etc.) to make a skill check</li>
                                <li>The extension rolls 1d20 + stat modifier</li>
                                <li>The outcome is injected into your message</li>
                                <li>The AI narrates the result based on success/failure</li>
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

    $('.skill-check-stat-input input[type="number"]').on('change', function() {
        const statKey = $(this).data('stat');
        const value = parseInt($(this).val()) || 10;
        extension_settings[extensionName].stats[statKey] = Math.max(1, Math.min(30, value));
        saveSettingsDebounced();
    });

    $('#skill-check-difficulty').on('change', function() {
        const value = parseInt($(this).val()) || 12;
        extension_settings[extensionName].difficulty = Math.max(1, Math.min(30, value));
        saveSettingsDebounced();
    });
}

// Load settings into UI
function loadSettingsUI() {
    const settings = extension_settings[extensionName];

    $('#skill-check-enabled').prop('checked', settings.enabled);

    statKeys.forEach(statKey => {
        $(`#skill-check-stat-${statKey}`).val(settings.stats[statKey]);
        $(`.skill-check-stat-label[data-stat="${statKey}"]`).text(getStatName(statKey));
    });

    $('#skill-check-difficulty').val(settings.difficulty);
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
