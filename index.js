import { extension_settings } from "../../../extensions.js";
import { getContext } from "../../../extensions.js";

// Try to get saveSettingsDebounced from window or create a fallback
const saveSettingsDebounced = window.saveSettingsDebounced || function() {
    console.log('[Skill Check] Saving settings (using fallback)');
    // Settings are already saved to extension_settings object
    // SillyTavern will persist them automatically
};

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
    difficulty: 12,
    useCompendium: true,
    contextMessages: 5,
    manualChallenge: null, // null = auto-detect, or entry id for manual override
    level: 1,
    pendingLevelUps: 0,
    lastLevelUpMessageIndex: -1, // Track last message index where level-up was detected
    levelUpMessageGap: 3 // Require this many AI messages before checking again
};

// Stats array for iteration (internal keys)
const statKeys = ['stat1', 'stat2', 'stat3', 'stat4', 'stat5', 'stat6'];

// Loaded compendiums storage
let loadedCompendiums = [];

// Get display name for a stat
function getStatName(statKey) {
    const settings = extension_settings[extensionName];
    return settings?.statNames?.[statKey] || statKey.toUpperCase();
}

// List of available compendium files
const compendiumFiles = [
    'default-compendium.json',
    'star-wars-compendium.json'
];

// Load compendiums from extension folder
async function loadCompendiums() {
    loadedCompendiums = [];
    const settings = extension_settings[extensionName];

    // Initialize compendium enabled states if not present
    if (!settings.enabledCompendiums) {
        settings.enabledCompendiums = {};
    }

    for (const filename of compendiumFiles) {
        try {
            const path = `/scripts/extensions/third-party/${extensionName}/${filename}`;
            const response = await fetch(path);
            if (response.ok) {
                const compendium = await response.json();
                compendium._filename = filename;
                // Default to enabled for default compendium, disabled for others
                if (settings.enabledCompendiums[filename] === undefined) {
                    settings.enabledCompendiums[filename] = (filename === 'default-compendium.json');
                }
                compendium._enabled = settings.enabledCompendiums[filename];
                loadedCompendiums.push(compendium);
                console.log(`[Skill Check] Loaded compendium: ${compendium.name} (${compendium._enabled ? 'enabled' : 'disabled'})`);
            }
        } catch (error) {
            console.warn(`[Skill Check] Could not load compendium ${filename}:`, error);
        }
    }

    console.log('[Skill Check] Total compendiums loaded:', loadedCompendiums.length);
    return loadedCompendiums;
}

// Toggle a compendium's enabled state
function toggleCompendium(filename, enabled) {
    const settings = extension_settings[extensionName];
    settings.enabledCompendiums[filename] = enabled;

    // Update the loaded compendium's state
    const compendium = loadedCompendiums.find(c => c._filename === filename);
    if (compendium) {
        compendium._enabled = enabled;
    }

    saveSettingsDebounced();
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

// Scan messages for challenge keywords with recency weighting
// messages: array of message objects (oldest first, newest last)
function scanForChallenges(messages) {
    if (!Array.isArray(messages)) {
        console.warn('[Skill Check] scanForChallenges received non-array:', typeof messages);
        return [];
    }

    console.log('[Skill Check] scanForChallenges called with', messages.length, 'messages');
    console.log('[Skill Check] Loaded compendiums count:', loadedCompendiums.length);

    const matches = [];

    // Scan each message (reverse order so newest is checked first)
    for (let msgIndex = messages.length - 1; msgIndex >= 0; msgIndex--) {
        const message = messages[msgIndex];
        const lowerText = (message.mes || '').toLowerCase();
        const recencyBonus = (messages.length - msgIndex) * 100; // Newer = higher bonus

        console.log(`[Skill Check] Scanning message ${msgIndex}:`, lowerText.substring(0, 100));

        for (const compendium of loadedCompendiums) {
            if (!compendium._enabled) continue;

            for (const entry of compendium.entries) {
                // Skip if we already matched this entry in a newer message
                if (matches.find(m => m.entry.id === entry.id)) continue;

                for (const keyword of entry.keywords) {
                    if (lowerText.includes(keyword.toLowerCase())) {
                        console.log(`[Skill Check] ✓ Matched keyword "${keyword}" in entry "${entry.name}" (message ${msgIndex}, recency bonus: ${recencyBonus})`);
                        matches.push({
                            entry: entry,
                            keyword: keyword,
                            compendium: compendium.name,
                            messageIndex: msgIndex,
                            priority: keyword.length + recencyBonus // Longer keyword + recency
                        });
                        break; // One match per entry is enough
                    }
                }
            }
        }
    }

    // Sort by priority — prefer newer and more specific matches
    matches.sort((a, b) => b.priority - a.priority);
    console.log(`[Skill Check] scanForChallenges found ${matches.length} matches`);
    if (matches.length > 0) {
        console.log('[Skill Check] Top match:', matches[0].keyword, 'from message', matches[0].messageIndex, 'priority:', matches[0].priority);
    }
    return matches;
}

// Capitalize a keyword for display (e.g., "pit trap" → "Pit Trap")
function capitalizeKeyword(keyword) {
    return keyword.split(' ').map(word =>
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
}

// Get active difficulty for a stat based on context
function getActiveDifficulty(statDisplayName) {
    console.log('[Skill Check] ===== getActiveDifficulty called for stat:', statDisplayName, '=====');
    const settings = extension_settings[extensionName];

    // If compendium matching is disabled, use default
    if (!settings.useCompendium) {
        console.log('[Skill Check] Compendium matching disabled, using default difficulty:', settings.difficulty);
        return {
            difficulty: settings.difficulty,
            source: null,
            notes: null,
            entry: null
        };
    }

    // Check for manual override
    if (settings.manualChallenge) {
        console.log('[Skill Check] Manual challenge override set:', settings.manualChallenge);
        for (const compendium of loadedCompendiums) {
            const entry = compendium.entries.find(e => e.id === settings.manualChallenge);
            if (entry) {
                const entryDifficulty = entry.difficulties[statDisplayName.toUpperCase()];
                if (entryDifficulty !== undefined) {
                    console.log('[Skill Check] Using manual override:', entry.name, 'DC', entryDifficulty);
                    return {
                        difficulty: entryDifficulty,
                        source: entry.name, // Manual override uses entry name
                        notes: entry.notes,
                        entry: entry
                    };
                }
            }
        }
    }

    // Auto-detect from context
    console.log('[Skill Check] Auto-detecting challenge from context...');
    const recentMessages = getRecentContext(settings.contextMessages || 5);
    const matches = scanForChallenges(recentMessages);

    if (matches.length > 0) {
        console.log('[Skill Check] Found', matches.length, 'matches');
        // Find best match that has a difficulty for this stat
        for (const match of matches) {
            const entryDifficulty = match.entry.difficulties[statDisplayName.toUpperCase()];
            console.log(`[Skill Check] Checking match "${match.keyword}" for ${statDisplayName} difficulty:`, entryDifficulty);
            if (entryDifficulty !== undefined) {
                console.log('[Skill Check] ✓ Using detected challenge:', capitalizeKeyword(match.keyword), 'DC', entryDifficulty);
                return {
                    difficulty: entryDifficulty,
                    source: capitalizeKeyword(match.keyword), // Use matched keyword, not entry name
                    notes: match.entry.notes,
                    entry: match.entry
                };
            }
        }
    } else {
        console.log('[Skill Check] No matches found');
    }

    // Fall back to default difficulty
    console.log('[Skill Check] Falling back to default difficulty:', settings.difficulty);
    return {
        difficulty: settings.difficulty,
        source: null,
        notes: null,
        entry: null
    };
}

// Get all current challenge matches for display
function getCurrentChallengeMatches() {
    const settings = extension_settings[extensionName];
    const recentMessages = getRecentContext(settings.contextMessages || 5);
    return scanForChallenges(recentMessages);
}

// Get display text for current detected challenge
function getCurrentChallengeDisplay() {
    const settings = extension_settings[extensionName];

    if (!settings.useCompendium) {
        return '<span class="challenge-none">Compendium disabled</span>';
    }

    if (settings.manualChallenge) {
        for (const compendium of loadedCompendiums) {
            const entry = compendium.entries.find(e => e.id === settings.manualChallenge);
            if (entry) {
                return `<span class="challenge-manual">${entry.name}</span> <small>(manual)</small>`;
            }
        }
    }

    const matches = getCurrentChallengeMatches();
    if (matches.length === 0) {
        return '<span class="challenge-none">None detected</span>';
    }

    const best = matches[0];
    const displayName = capitalizeKeyword(best.keyword); // Use matched keyword
    const otherCount = matches.length - 1;
    let html = `<span class="challenge-detected">${displayName}</span>`;
    if (best.entry.notes) {
        html += `<br><small class="challenge-notes">${best.entry.notes}</small>`;
    }
    if (otherCount > 0) {
        html += `<br><small class="challenge-others">+${otherCount} other match${otherCount > 1 ? 'es' : ''}</small>`;
    }
    return html;
}

// Get all challenge options for manual override dropdown
function getAllChallengeOptions(selectedId) {
    let options = '';
    for (const compendium of loadedCompendiums) {
        if (!compendium._enabled) continue;

        // Group by type
        const byType = {};
        for (const entry of compendium.entries) {
            const type = entry.type || 'other';
            if (!byType[type]) byType[type] = [];
            byType[type].push(entry);
        }

        for (const [type, entries] of Object.entries(byType)) {
            options += `<optgroup label="${type.charAt(0).toUpperCase() + type.slice(1)}s">`;
            for (const entry of entries) {
                const selected = entry.id === selectedId ? 'selected' : '';
                options += `<option value="${entry.id}" ${selected}>${entry.name}</option>`;
            }
            options += '</optgroup>';
        }
    }
    return options;
}

// Level-up trigger keywords (announce new level)
const levelUpTriggerKeywords = [
    'level up',
    'leveled up',
    'levelled up',
    'gained a level',
    'gain a level',
    'gained \\d+ levels',
    'gain \\d+ levels',
    'reached level',
    'advanced to level',
    'you are now level',
    'congratulations.*level',
    'new level'
];

// Reference phrases (talking about past level-up, don't trigger)
const levelUpReferencePatterns = [
    'now that you.*level',
    'since you.*level',
    'after leveling',
    'having leveled',
    'your new level',
    'the level you gained',
    'with your level'
];

// Check if text is just referencing a past level-up
function isLevelUpReference(text) {
    const lowerText = text.toLowerCase();
    for (const pattern of levelUpReferencePatterns) {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(lowerText)) {
            return true;
        }
    }
    return false;
}

// Detect level-up and extract count (returns { detected: bool, count: number })
function detectLevelUp(text) {
    console.log('[Skill Check] detectLevelUp called');
    const lowerText = text.toLowerCase();

    // Skip if this is just a reference to past level-up
    if (isLevelUpReference(text)) {
        console.log('[Skill Check] Text is a reference to past level-up, skipping');
        return { detected: false, count: 0 };
    }

    let levelsGained = 0;

    // Check for "gain X levels" or "gained X levels"
    const multiLevelMatch = text.match(/gain(?:ed)?\s+(\d+)\s+levels?/i);
    if (multiLevelMatch) {
        console.log('[Skill Check] Matched "gain X levels":', multiLevelMatch[0]);
        levelsGained = Math.max(levelsGained, parseInt(multiLevelMatch[1]));
    }

    // Check for "you are now level X" and calculate difference
    const nowLevelMatch = text.match(/(?:you are now|reached|advanced to)\s+level\s+(\d+)/i);
    if (nowLevelMatch) {
        console.log('[Skill Check] Matched "you are now level X":', nowLevelMatch[0]);
        const settings = extension_settings[extensionName];
        const newLevel = parseInt(nowLevelMatch[1]);
        const gained = newLevel - settings.level;
        console.log(`[Skill Check] Current level: ${settings.level}, new level: ${newLevel}, gained: ${gained}`);
        if (gained > 0) {
            levelsGained = Math.max(levelsGained, gained);
        }
    }

    // Count occurrences of "level up!" (repeated)
    const levelUpCount = (text.match(/level\s+up[!\s]/gi) || []).length;
    if (levelUpCount > 0) {
        console.log('[Skill Check] Found "level up!" count:', levelUpCount);
        levelsGained = Math.max(levelsGained, levelUpCount);
    }

    // Check standard trigger keywords (count as 1 level if not already detected)
    if (levelsGained === 0) {
        for (const keyword of levelUpTriggerKeywords) {
            const regex = new RegExp(keyword, 'i');
            if (regex.test(lowerText)) {
                console.log('[Skill Check] Matched trigger keyword:', keyword);
                levelsGained = 1;
                break;
            }
        }
    }

    console.log('[Skill Check] detectLevelUp result: detected =', levelsGained > 0, ', count =', levelsGained);
    return {
        detected: levelsGained > 0,
        count: levelsGained
    };
}

// Show level-up notification with confirmation
function showLevelUpToast(count, messageIndex) {
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
        applyLevelUp(count, messageIndex);
        toast.remove();
        openCharacterSheet();
    });

    // Ignore button - just update tracking index
    toast.find('.levelup-ignore').on('click', function() {
        ignoreLevelUp(messageIndex);
        toast.remove();
    });

    $('body').append(toast);

    // Auto-dismiss after 15 seconds
    setTimeout(() => {
        // If still visible, treat as ignored
        if (toast.is(':visible')) {
            ignoreLevelUp(messageIndex);
            toast.fadeOut(300, () => toast.remove());
        }
    }, 15000);
}

// Apply level-up: grant levels and update tracking
function applyLevelUp(count, messageIndex) {
    const settings = extension_settings[extensionName];
    settings.level += count;
    settings.pendingLevelUps += count;
    settings.lastLevelUpMessageIndex = messageIndex;
    saveSettingsDebounced();

    console.log(`[Skill Check] Level up applied! +${count} level(s), now level ${settings.level}, ${settings.pendingLevelUps} pending point(s)`);
}

// Ignore level-up: just update tracking to prevent re-trigger
function ignoreLevelUp(messageIndex) {
    const settings = extension_settings[extensionName];
    settings.lastLevelUpMessageIndex = messageIndex;
    saveSettingsDebounced();

    console.log(`[Skill Check] Level up ignored at message ${messageIndex}`);
}

// Check the most recent AI message for level-up
function checkForLevelUp() {
    try {
        console.log('[Skill Check] ===== checkForLevelUp called =====');
        const settings = extension_settings[extensionName];
        const context = getContext();

        console.log('[Skill Check] getContext imported:', typeof getContext);
        console.log('[Skill Check] context exists:', !!context);

        if (!context || !context.chat || context.chat.length === 0) {
            console.warn('[Skill Check] No chat context available for level-up check');
            return;
        }

        const chat = context.chat;
        const currentIndex = chat.length - 1;

        console.log('[Skill Check] Chat length:', chat.length);
        console.log('[Skill Check] Current index:', currentIndex);
        console.log('[Skill Check] Last level-up index:', settings.lastLevelUpMessageIndex);
        console.log('[Skill Check] Required gap:', settings.levelUpMessageGap);

        // Check if we're within the cooldown period
        if (settings.lastLevelUpMessageIndex >= 0) {
            const gap = currentIndex - settings.lastLevelUpMessageIndex;
            console.log('[Skill Check] Gap since last level-up:', gap);
            if (gap < settings.levelUpMessageGap) {
                console.log('[Skill Check] Still in cooldown period, skipping check');
                return;
            }
        }

        // Count AI messages from the end
        let aiMessagesChecked = 0;
        for (let i = chat.length - 1; i >= 0 && aiMessagesChecked < 1; i--) {
            const msg = chat[i];

            console.log(`[Skill Check] Checking message ${i}, is_user: ${msg.is_user}`);

            // Skip user messages
            if (msg.is_user) continue;

            aiMessagesChecked++;

            // Check for level-up in this AI message
            if (msg.mes) {
                console.log(`[Skill Check] AI message content (first 200 chars):`, msg.mes.substring(0, 200));
                const result = detectLevelUp(msg.mes);
                console.log(`[Skill Check] detectLevelUp result:`, result);
                if (result.detected && result.count > 0) {
                    console.log(`[Skill Check] ✓ Level-up detected: +${result.count} level(s) at message index ${i}`);
                    showLevelUpToast(result.count, i);
                    return;
                } else {
                    console.log('[Skill Check] No level-up detected in this message');
                }
            }
        }
        console.log('[Skill Check] ===== checkForLevelUp complete, no level-up found =====');
    } catch (e) {
        console.error('[Skill Check] Error checking for level-up:', e);
        console.error('[Skill Check]', e.stack);
    }
}

// Set up level-up detection using MutationObserver
function setupLevelUpDetection() {
    console.log('[Skill Check] ===== Setting up level-up detection =====');
    console.log('[Skill Check] eventSource available:', typeof eventSource !== 'undefined');

    // Try to hook into SillyTavern events if available
    if (typeof eventSource !== 'undefined') {
        try {
            eventSource.on('message_received', () => {
                console.log('[Skill Check] message_received event fired');
                setTimeout(checkForLevelUp, 500); // Small delay to ensure message is in context
            });
            console.log('[Skill Check] ✓ Level-up detection hooked into message_received event');
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
                    console.log('[Skill Check] New nodes added to chat, checking for level-up');
                    // New content added, check for level-up after a delay
                    setTimeout(checkForLevelUp, 500);
                    break;
                }
            }
        });

        observer.observe(chatContainer, { childList: true, subtree: true });
        console.log('[Skill Check] ✓ Level-up detection using MutationObserver on #chat');
    } else {
        // Last resort: periodic check
        setInterval(checkForLevelUp, 3000);
        console.log('[Skill Check] ⚠ Level-up detection using periodic check (3s interval)');
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
    // Critical Failure: natural 1 OR total <= 5
    if (naturalRoll === 1 || total <= 5) {
        return {
            tier: 'critical_failure',
            text: 'FAILED BADLY. Narrate a serious setback, complication, or injury. Do not soften the failure. Do not speak for the user.'
        };
    }

    // Strong Success: total >= 18 OR natural 20
    if (total >= 18 || naturalRoll === 20) {
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

    // Get active difficulty from compendium or default
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

    // Trigger send button click
    const sendButton = document.getElementById('send_but');
    if (sendButton) {
        sendButton.click();
    } else {
        console.error('[Skill Check] Could not find send button');
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
function openCharacterSheet() {
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
                        <h4>Compendiums</h4>
                        <div class="skill-check-compendium-list">
                            ${loadedCompendiums.map(comp => `
                                <label class="checkbox_label skill-check-compendium-toggle">
                                    <input type="checkbox" data-filename="${comp._filename}" ${comp._enabled ? 'checked' : ''} />
                                    <span>${comp.name}</span>
                                    <small class="compendium-entry-count">(${comp.entries.length} entries)</small>
                                </label>
                            `).join('')}
                        </div>
                    </div>

                    <div class="skill-check-popup-section">
                        <h4>Detection</h4>
                        <label class="checkbox_label skill-check-toggle">
                            <input id="skill-check-use-compendium" type="checkbox" ${settings.useCompendium ? 'checked' : ''} />
                            <span>Auto-detect challenges from context</span>
                        </label>
                        <div class="skill-check-challenge-info">
                            <small>Current challenge:</small>
                            <div id="skill-check-detected-challenge" class="skill-check-detected">
                                ${getCurrentChallengeDisplay()}
                            </div>
                        </div>
                        <div class="skill-check-manual-override">
                            <small>Manual override:</small>
                            <select id="skill-check-manual-challenge" class="text_pole">
                                <option value="">Auto-detect</option>
                                ${getAllChallengeOptions(settings.manualChallenge)}
                            </select>
                        </div>
                    </div>

                    <div class="skill-check-popup-section">
                        <h4>Default Difficulty (DC)</h4>
                        <small>Used when no challenge is detected</small>
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
                            <span>Level ${settings.level}</span>
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
                                        <input
                                            type="number"
                                            class="skill-check-stat-value-input text_pole"
                                            min="${settings.useDndStyle ? '1' : '-10'}"
                                            max="30"
                                            value="${statValue}"
                                        />
                                        <span class="skill-check-stat-modifier ${settings.useDndStyle ? '' : 'hidden'}">(${modStr})</span>
                                        <button class="skill-check-stat-increment menu_button ${settings.pendingLevelUps > 0 ? '' : 'hidden'}" title="Spend 1 point">+1</button>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>

                    <div class="skill-check-popup-section">
                        <button id="skill-check-reset-defaults" class="menu_button">
                            <i class="fa-solid fa-rotate-left"></i> Reset to Defaults
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `);

    // Add to body
    $('body').append(popup);

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

    // Individual compendium toggle handlers
    popup.find('.skill-check-compendium-toggle input').on('change', function() {
        const filename = $(this).data('filename');
        const enabled = $(this).prop('checked');
        toggleCompendium(filename, enabled);
        // Refresh the detected challenge display and manual override options
        popup.find('#skill-check-detected-challenge').html(getCurrentChallengeDisplay());
        popup.find('#skill-check-manual-challenge').html(
            '<option value="">Auto-detect</option>' + getAllChallengeOptions(settings.manualChallenge)
        );
    });

    // Auto-detect toggle handler
    popup.find('#skill-check-use-compendium').on('change', function() {
        settings.useCompendium = $(this).prop('checked');
        saveSettingsDebounced();
        // Refresh the detected challenge display
        popup.find('#skill-check-detected-challenge').html(getCurrentChallengeDisplay());
    });

    // Manual challenge override handler
    popup.find('#skill-check-manual-challenge').on('change', function() {
        const value = $(this).val();
        settings.manualChallenge = value || null;
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
        popup.remove();
        openCharacterSheet();
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
        $(this).siblings('.skill-check-stat-modifier').text(`(${modStr})`);

        saveSettingsDebounced();
        loadSettingsUI();
    });

    // Stat increment button handler (for spending level-up points)
    popup.find('.skill-check-stat-increment').on('click', function() {
        if (settings.pendingLevelUps <= 0) return;

        const statKey = $(this).closest('.skill-check-popup-stat-row').data('stat');
        settings.stats[statKey] += 1;
        settings.pendingLevelUps -= 1;
        saveSettingsDebounced();

        // Reopen popup to refresh the UI
        popup.remove();
        openCharacterSheet();
    });

    // Reset to defaults handler
    popup.find('#skill-check-reset-defaults').on('click', function() {
        if (confirm('Reset all stats and difficulty to default values?')) {
            settings.stats = { ...defaultSettings.stats };
            settings.statNames = { ...defaultSettings.statNames };
            settings.difficulty = defaultSettings.difficulty;
            saveSettingsDebounced();
            updateStatButtonLabels();
            loadSettingsUI();
            popup.remove();
            openCharacterSheet(); // Reopen with fresh values
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
                                <li><strong>Critical Failure:</strong> Natural 1 OR total ≤ 5</li>
                                <li><strong>Failure:</strong> Total < difficulty</li>
                                <li><strong>Success:</strong> Total ≥ difficulty</li>
                                <li><strong>Strong Success:</strong> Total ≥ 18 OR natural 20</li>
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
        }

        console.log('[Skill Check] Settings initialized:', extension_settings[extensionName]);

        // Load compendiums
        await loadCompendiums();

        // Create UI elements
        createStatButtons();
        createSettingsPanel();

        // Set initial visibility
        toggleExtension();

        // Set up level-up detection
        setupLevelUpDetection();

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
