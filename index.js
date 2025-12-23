import { extension_settings } from "../../../extensions.js";

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
    stats: {
        stat1: 10,
        stat2: 10,
        stat3: 10,
        stat4: 10,
        stat5: 10,
        stat6: 10
    },
    statNames: {
        stat1: 'STR',
        stat2: 'DEX',
        stat3: 'CON',
        stat4: 'INT',
        stat5: 'WIS',
        stat6: 'CHA'
    },
    difficulty: 12
};

// Stats array for iteration (internal keys)
const statKeys = ['stat1', 'stat2', 'stat3', 'stat4', 'stat5', 'stat6'];

// Get display name for a stat
function getStatName(statKey) {
    const settings = extension_settings[extensionName];
    return settings?.statNames?.[statKey] || statKey.toUpperCase();
}

// Calculate D&D-style modifier
function getModifier(stat) {
    return Math.floor((stat - 10) / 2);
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
function showRollResult(stat, naturalRoll, modifier, total, outcome) {
    const toast = $(`
        <div class="skill-check-toast">
            <strong>${stat} Check</strong><br>
            ${naturalRoll} + ${modifier} = ${total}<br>
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

    // Roll the dice
    const naturalRoll = rollD20();
    const total = naturalRoll + modifier;

    // Determine outcome
    const outcome = determineOutcome(naturalRoll, total, settings.difficulty);

    // Show result to user
    showRollResult(statDisplayName, naturalRoll, modifier, total, outcome);

    // Build the message - injection only if no user message
    const injection = `[System: The user attempted an action using ${statDisplayName}. They ${outcome.text}]`;
    textarea.value = userMessage ? `${userMessage}\n\n${injection}` : injection;

    // Trigger send button click
    const sendButton = document.getElementById('send_but');
    if (sendButton) {
        sendButton.click();
    } else {
        console.error('[Skill Check] Could not find send button');
    }
}

// Show warning message
function showWarning(message) {
    const toast = $(`
        <div class="skill-check-toast warning">
            <strong>⚠ Skill Check</strong><br>
            ${message}
        </div>
    `);

    $('body').append(toast);
    setTimeout(() => toast.addClass('show'), 10);
    setTimeout(() => {
        toast.removeClass('show');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
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
                        <h4>Difficulty Class (DC)</h4>
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
                        <small>Click stat names to rename them</small>
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
                                            min="1"
                                            max="30"
                                            value="${statValue}"
                                        />
                                        <span class="skill-check-stat-modifier">(${modStr})</span>
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

    // Stat value input handler
    popup.find('.skill-check-stat-value-input').on('change', function() {
        const statKey = $(this).closest('.skill-check-popup-stat-row').data('stat');
        const value = parseInt($(this).val()) || 10;
        const clampedValue = Math.max(1, Math.min(30, value));
        settings.stats[statKey] = clampedValue;
        $(this).val(clampedValue);

        // Update modifier display
        const modifier = getModifier(clampedValue);
        const modStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;
        $(this).siblings('.skill-check-stat-modifier').text(`(${modStr})`);

        saveSettingsDebounced();
        loadSettingsUI();
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

        // Create UI elements
        createStatButtons();
        createSettingsPanel();

        // Set initial visibility
        toggleExtension();

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
