import { extension_settings, saveSettingsDebounced } from "../../../extensions.js";
import { eventSource, event_types } from "../../../../script.js";

const extensionName = "skill-check";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// Default settings
const defaultSettings = {
    enabled: true,
    stats: {
        STR: 10,
        DEX: 10,
        CON: 10,
        INT: 10,
        WIS: 10,
        CHA: 10
    },
    difficulty: 12
};

// Stats array for iteration
const statNames = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

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
            text: 'FAILED BADLY. Narrate a serious setback, complication, or injury. Do not soften the failure.'
        };
    }

    // Strong Success: total >= 18 OR natural 20
    if (total >= 18 || naturalRoll === 20) {
        return {
            tier: 'strong_success',
            text: 'SUCCEEDED EXCEPTIONALLY. Narrate an impressive, skillful, or lucky outcome.'
        };
    }

    // Success: total >= difficulty
    if (total >= difficulty) {
        return {
            tier: 'success',
            text: 'SUCCEEDED. Narrate the user achieving their goal.'
        };
    }

    // Failure: total < difficulty (but not critical)
    return {
        tier: 'failure',
        text: 'FAILED. Narrate the user not achieving their goal. There may be minor consequences.'
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
async function performSkillCheck(stat) {
    const settings = extension_settings[extensionName];

    // Get the message textarea
    const textarea = document.getElementById('send_textarea');
    if (!textarea) {
        console.error('[Skill Check] Could not find message textarea');
        return;
    }

    const userMessage = textarea.value.trim();

    // Don't send if message is empty
    if (!userMessage) {
        showWarning('Please type a message before making a skill check.');
        return;
    }

    // Get stat value and calculate modifier
    const statValue = settings.stats[stat];
    const modifier = getModifier(statValue);

    // Roll the dice
    const naturalRoll = rollD20();
    const total = naturalRoll + modifier;

    // Determine outcome
    const outcome = determineOutcome(naturalRoll, total, settings.difficulty);

    // Show result to user
    showRollResult(stat, naturalRoll, modifier, total, outcome);

    // Append injection to message
    const injection = `\n\n[System: The user attempted an action using ${stat}. They ${outcome.text}]`;
    textarea.value = userMessage + injection;

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
    const container = $(`
        <div id="skill-check-buttons" class="skill-check-container">
            <div class="skill-check-label">Skill Check:</div>
            <div class="skill-check-stats">
                ${statNames.map(stat => `
                    <button class="skill-check-btn" data-stat="${stat}" title="Roll ${stat} check">
                        ${stat}
                    </button>
                `).join('')}
            </div>
        </div>
    `);

    // Add click handlers
    container.find('.skill-check-btn').on('click', function() {
        const stat = $(this).data('stat');
        performSkillCheck(stat);
    });

    // Insert before send button
    const sendForm = $('#send_form');
    if (sendForm.length) {
        sendForm.before(container);
    } else {
        console.warn('[Skill Check] Could not find #send_form, appending to #send_textarea parent');
        $('#send_textarea').parent().append(container);
    }
}

// Create settings panel
function createSettingsPanel() {
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
                            ${statNames.map(stat => `
                                <div class="skill-check-stat-input">
                                    <label for="skill-check-stat-${stat}">${stat}</label>
                                    <input
                                        id="skill-check-stat-${stat}"
                                        type="number"
                                        min="1"
                                        max="30"
                                        class="text_pole"
                                        data-stat="${stat}"
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

    $('#extensions_settings2').append(settingsHtml);

    // Load current settings into UI
    loadSettingsUI();

    // Add event listeners
    $('#skill-check-enabled').on('change', function() {
        extension_settings[extensionName].enabled = $(this).prop('checked');
        saveSettingsDebounced();
        toggleExtension();
    });

    $('.skill-check-stat-input input').on('change', function() {
        const stat = $(this).data('stat');
        const value = parseInt($(this).val()) || 10;
        extension_settings[extensionName].stats[stat] = Math.max(1, Math.min(30, value));
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

    statNames.forEach(stat => {
        $(`#skill-check-stat-${stat}`).val(settings.stats[stat]);
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
    console.log('[Skill Check] Extension loading...');

    // Initialize settings
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = defaultSettings;
    } else {
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
    }

    // Create UI elements
    createStatButtons();
    createSettingsPanel();

    // Set initial visibility
    toggleExtension();

    console.log('[Skill Check] Extension loaded successfully');
});
