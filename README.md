# Skill Check - SillyTavern Extension

A third-party extension for [SillyTavern](https://github.com/SillyTavern/SillyTavern) that adds RPG-style skill checks, automatic challenge detection, inventory tracking, and character progression to your roleplay sessions. Roll dice against your character's stats and let the AI narrate success or failure based on outcomes, not numbers.

## What It Does

Skill Check adds a comprehensive RPG system to SillyTavern with multiple features:

### Core Features

1. **Manual Skill Checks**: Click a stat button to roll 1d20 + modifier against a difficulty
2. **Automatic Challenge Detection**: The extension detects when the AI describes challenges and automatically adjusts difficulty
3. **Inventory Tracking**: Automatically tracks items added to or removed from your inventory
4. **Level-Up Detection**: Detects when you level up and updates your character sheet
5. **Character Sheet Injection**: Your character stats are automatically included in AI context
6. **Smart Roll Control**: Choose whether rolls auto-send or let you review them first

### Basic Workflow

1. Type your action in the message box
2. Click one of the stat buttons (STR, DEX, CON, INT, WIS, CHA)
3. The extension rolls 1d20 + your stat modifier
4. The **outcome** (not the numbers) is shown to you and injected into your message
5. The AI narrates the result based on whether you succeeded or failed

## Why This Approach Works

Traditional dice rolling extensions show the AI the numerical result (e.g., "You rolled a 15"). The problem is that AI models tend to be overly generous and will often narrate partial successes or ignore failures entirely.

**Skill Check solves this** by telling the AI the *outcome* directly:
- ❌ "You rolled a 7" → AI might still narrate a partial success
- ✅ "They FAILED" → AI narrates a failure as instructed

The user still sees the dice roll (via a toast notification), but the AI only receives clear outcome instructions.

## Installation

### Method 1: Built-in Extension Installer (Recommended)

1. Open SillyTavern
2. Go to **Extensions** > **Install Extension**
3. Enter the GitHub URL: `https://github.com/lucashald/skill-check`
4. Click **Install**
5. Refresh the page (F5 or Ctrl+R)

### Method 2: Manual Installation

1. Download or clone this repository
2. Navigate to your SillyTavern installation folder
3. Copy the entire `skill-check` folder to:
   ```
   [SillyTavern]/public/scripts/extensions/third-party/skill-check/
   ```
   **Important**: The files must be in a folder named `skill-check` inside the `third-party` directory.

4. Your folder structure should look like this:
   ```
   SillyTavern/
   └── public/
       └── scripts/
           └── extensions/
               └── third-party/
                   └── skill-check/          ← Extension folder
                       ├── manifest.json
                       ├── index.js
                       ├── style.css
                       └── README.md
   ```
5. Restart SillyTavern or refresh the page (Ctrl+R or F5)

### Verifying Installation

After installing, open your browser console (F12) and look for:
```
[Skill Check] ✓ Extension loaded successfully
```

If you see this, the extension is working! The stat buttons should appear near your message input area.

## How to Use

### Basic Usage

1. **Set up your character** (recommended):
   - Go to Extensions > Skill Check Settings
   - Enter your character's name, class, level, and ability scores (1-30)
   - Stat modifiers are calculated automatically using D&D rules: `modifier = floor((stat - 10) / 2)`
   - Enable "Inject Character Sheet" to include your stats in AI context

2. **Make a skill check**:
   - Type your action: "I try to climb the cliff wall"
   - Click the **STR** button
   - The extension rolls, determines the outcome, and either auto-sends or waits for you to send manually (based on settings)

3. **See what happened**:
   - A toast notification shows you the roll: "STR Check: 14 + 2 = 16 → SUCCESS"
   - The AI receives: "I try to climb the cliff wall. [System: The user attempted an action using STR. They SUCCEEDED. Narrate the user achieving their goal.]"
   - The AI narrates accordingly: "Your muscles strain as you find purchase on the rocky surface. You pull yourself up the cliff face successfully..."

### Advanced Features

#### Automatic Challenge Detection

The extension uses a **two-phase detection system** to automatically adjust difficulty when the AI describes challenges in the scene:

**Phase 1 - Context Scanning (Passive)**:
- Scans recent AI messages for challenge nouns (e.g., "dragon", "lock", "guard")
- Looks for modifiers like "ancient", "rusty", "elite"
- Builds a list of active challenges with adjusted difficulties
- Challenges persist across messages using "stickiness" (configurable per challenge)

**Phase 2 - Action Detection (Active)**:
- When you click a stat button, checks if your typed message contains action verbs
- Matches actions against active challenges (e.g., "I pick the lock" + active "rusty lock")
- Applies modifier-adjusted difficulty automatically
- Uses exclusion patterns to prevent false positives (e.g., "lock eyes" won't trigger lock challenge)

**Example Flow**:
1. AI: "You see an ancient dragon guarding the treasure"
   - Extension detects: "dragon" (base STR difficulty 22) + "ancient" modifier (+8) = **Difficulty 30**
   - Challenge stored with stickiness of 15 messages
2. You type: "I attack the dragon" and click **STR**
   - Extension matches: action verb "attack" + noun "dragon" → applies difficulty 30
   - You roll 1d20+4 = 18 vs DC 30 → FAILED
   - AI narrates your heroic but unsuccessful attack

**Manual Override**: You can manually set a specific challenge and difficulty using the settings panel before clicking a stat button.

#### Inventory Tracking

The extension automatically detects inventory changes in AI messages:

**Addition Detection** (strict patterns to avoid false positives):
- "You add [item] to your inventory" → item tracked
- "[Item] added to your inventory" → item tracked
- Supports quantities: "2 health potions added to your inventory"
- Strips articles: "a sword" becomes "sword", "the potion" becomes "potion"

**Removal Detection** (equally strict):
- "You remove [item] from your inventory"
- "[Item] removed from your inventory"

**View Inventory**: Click the "Show Inventory" button in settings to see your current items.

#### Level-Up System

When the AI narrates that you level up, the extension:
1. Detects level-up phrases (e.g., "you reach level", "you've leveled up")
2. Automatically updates your character level
3. Shows a notification
4. Updates the character sheet injected into context

#### Character Sheet Injection

When enabled (recommended), your full character sheet is automatically included in the AI's context:

```
[Character Sheet]
Name: Aragorn
Class: Ranger
Level: 5
STR: 16 (+3) | DEX: 14 (+2) | CON: 15 (+2)
INT: 12 (+1) | WIS: 13 (+1) | CHA: 14 (+2)
HP: 45/45
Inventory: longsword, bow, 20 arrows, rope, health potion (x2)
Active Spells: Hunter's Mark
```

This allows the AI to:
- Narrate appropriately for your class and level
- Reference your inventory without you repeating it
- Track your resources (HP, spells, items)
- Make combat more realistic based on your stats

## Outcome Tiers

The extension determines outcomes based on your roll:

### 🔴 Critical Failure
**Triggers**: Natural 1 **OR** total ≤ 5

The AI is instructed: *"FAILED BADLY. Narrate a serious setback, complication, or injury. Do not soften the failure."*

**Example**: You rolled a natural 1 trying to pick a lock. The AI narrates: "Your lockpick snaps off inside the mechanism with an audible *click*. The lock is now jammed, and you hear footsteps approaching from down the hall..."

### 🟠 Failure
**Triggers**: Total < difficulty (but not critical)

The AI is instructed: *"FAILED. Narrate the user not achieving their goal. There may be minor consequences."*

**Example**: You rolled 9 trying to persuade the guard (difficulty 12). The AI narrates: "The guard crosses his arms and shakes his head. 'I've got my orders. No one gets through here without proper clearance.'"

### 🟢 Success
**Triggers**: Total ≥ difficulty (but < 18 and not natural 20)

The AI is instructed: *"SUCCEEDED. Narrate the user achieving their goal."*

**Example**: You rolled 14 trying to climb a wall (difficulty 12). The AI narrates: "You find handholds and pull yourself up the wall, reaching the top without incident."

### 🔵 Strong Success
**Triggers**: Total ≥ 18 **OR** natural 20

The AI is instructed: *"SUCCEEDED EXCEPTIONALLY. Narrate an impressive, skillful, or lucky outcome."*

**Example**: You rolled a natural 20 on a DEX check to dodge. The AI narrates: "You twist at the last possible moment, the arrow passing so close it clips a few strands of your hair. You land in a crouch, perfectly balanced, and flash a confident smirk at your attacker."

## Settings

Access settings via **Extensions** > **Skill Check Settings**:

### Basic Settings

**Enable/Disable**: Toggle the entire extension on or off.

**Append Roll Without Auto-Sending** (default: ON):
- When enabled: Clicking a stat button appends the roll to your message but doesn't send it. You can review the outcome and edit your message before sending manually.
- When disabled: Clicking a stat button immediately sends your message with the roll appended.

**Difficulty Threshold** (1-30, default: 12): The target number for basic skill checks when no challenge is detected.

### Character Information

**Character Name**: Your character's name (shown in character sheet).

**Character Class**: Your character's class/profession (e.g., "Fighter", "Wizard").

**Character Level** (1-30, default: 1): Current level. Auto-updates when you level up.

**Character Stats** (STR, DEX, CON, INT, WIS, CHA): Set each stat from 1 to 30.
- Default: 10 (modifier: +0)
- Example modifiers:
  - Stat 8 → -1
  - Stat 10 → +0
  - Stat 14 → +2
  - Stat 18 → +4
  - Stat 20 → +5

**Current/Max HP**: Track your character's health. You can edit both values manually.

**Inventory**: View your current inventory. Items are auto-detected from AI messages. You can also manually add/remove items using the buttons.

**Active Spells**: Track currently active spell effects. Auto-detected or manually managed.

### Advanced Settings

**Auto-Detect Challenges** (default: ON):
- When enabled: Uses the two-phase detection system to automatically detect challenges from AI messages
- When disabled: Always uses the manual difficulty threshold

**Inject Character Sheet** (default: ON):
- When enabled: Your full character sheet is included in the AI's context for every message
- When disabled: AI only sees skill check outcomes, not your full stats

**Context Messages to Scan** (1-50, default: 10): How many recent messages to scan for challenge detection. Higher = more context but slower processing.

**Manual Challenge Override**:
- **Challenge Name**: Manually specify a challenge (e.g., "Ancient Dragon")
- **Manual Difficulty**: Set a specific difficulty (1-30). Leave at 0 to use auto-detection.
- When set, this overrides auto-detection for the next roll only, then resets.

### Compendium Management

**Load Default Compendium**: Resets the compendium to the default set of challenges (dragons, goblins, locks, guards, merchants, cliffs, traps, doors).

**Export/Import Compendium**: Save your custom compendium to a JSON file or load one from disk.

**Edit Compendium**: Advanced users can directly edit the compendium JSON in the text area. See "Compendium Format" section below.

## Compendium Format

The compendium is a JSON file that defines challenges the extension can detect. The format is version 2.0:

### Structure

```json
{
  "name": "My Custom Compendium",
  "version": "2.0",
  "entries": [
    {
      "id": "unique-id",
      "name": "Display Name",
      "type": "monster|npc|obstacle|trap",
      "require_modifier": false,
      "stickiness": 15,
      "detection": {
        "nouns": ["word1", "word2"],
        "action_verbs": ["attack", "fight", "dodge"],
        "modifiers": {
          "easy": {
            "keywords": ["weak", "small"],
            "difficulty_adjust": -3
          },
          "hard": {
            "keywords": ["ancient", "legendary"],
            "difficulty_adjust": 5
          }
        }
      },
      "base_difficulties": {
        "STR": 15,
        "DEX": 12
      },
      "exclude_patterns": ["lock eyes", "lock gaze"],
      "notes": "Optional description"
    }
  ]
}
```

### Field Descriptions

**id**: Unique identifier for this challenge (required).

**name**: Human-readable name shown in logs and UI (required).

**type**: Category of challenge - "monster", "npc", "obstacle", or "trap" (required).

**require_modifier**: If `true`, this challenge only applies when a modifier keyword is detected. If `false`, applies even without modifiers (required).
- Example: A "lock" with `require_modifier: true` only applies to "rusty lock" or "reinforced lock", not just "lock"
- Example: A "dragon" with `require_modifier: false` applies to both "dragon" and "ancient dragon"

**stickiness**: Number of messages this challenge remains active after detection (required). Default: 15.
- Stickiness 20 = challenge persists for 20 messages after the AI mentions it
- Allows multi-turn interactions (AI describes dragon, you ask questions, you attack dragon later)

**detection**: Object containing detection patterns (required):
- **nouns**: Array of words that identify this challenge (e.g., `["dragon", "wyrm"]`)
- **action_verbs**: Array of verbs that indicate interaction with this challenge (e.g., `["attack", "fight", "strike"]`)
- **modifiers**: Object with "easy" and "hard" sub-objects:
  - **keywords**: Array of modifier words to detect
  - **difficulty_adjust**: Number to add/subtract from base difficulty (use negative for easy, positive for hard)

**base_difficulties**: Object mapping stat names (STR, DEX, CON, INT, WIS, CHA) to base difficulty numbers (required). Only include stats that are relevant to this challenge.

**exclude_patterns**: Array of phrases that, if found, prevent this challenge from triggering (optional). Useful to avoid false positives like "lock eyes" triggering a lock challenge.

**notes**: Human-readable notes about the challenge (optional).

### Example: Dragon with Modifiers

```json
{
  "id": "dragon",
  "name": "Dragon",
  "type": "monster",
  "require_modifier": false,
  "stickiness": 15,
  "detection": {
    "nouns": ["dragon", "dragons", "wyrm"],
    "action_verbs": ["attack", "fight", "strike", "charge", "evade"],
    "modifiers": {
      "easy": {
        "keywords": ["young", "wounded", "weak"],
        "difficulty_adjust": -6
      },
      "hard": {
        "keywords": ["ancient", "elder", "legendary"],
        "difficulty_adjust": 8
      }
    }
  },
  "base_difficulties": {
    "STR": 22,
    "DEX": 18,
    "CON": 24
  },
  "notes": "Near impossible without legendary equipment or allies."
}
```

**How this works**:
- AI says: "An ancient dragon blocks your path"
- Extension detects: "dragon" noun + "ancient" modifier → STR difficulty = 22 + 8 = **30**
- Persists for 15 messages
- You type: "I attack the dragon" and click STR
- Extension matches: "attack" verb + "dragon" noun → applies difficulty 30

### Example: Lock Requiring Modifiers

```json
{
  "id": "lock",
  "name": "Lock",
  "type": "obstacle",
  "require_modifier": true,
  "stickiness": 20,
  "detection": {
    "nouns": ["lock", "locks"],
    "action_verbs": ["pick", "unlock", "open"],
    "modifiers": {
      "easy": {
        "keywords": ["rusty", "old", "simple"],
        "difficulty_adjust": -4
      },
      "hard": {
        "keywords": ["complex", "reinforced", "masterwork"],
        "difficulty_adjust": 6
      }
    }
  },
  "base_difficulties": {
    "DEX": 14,
    "INT": 12
  },
  "exclude_patterns": ["lock eyes", "lock gaze", "locked in"],
  "notes": "Only applies when a modifier is present (rusty, complex, etc.)"
}
```

**How this works**:
- AI says: "You see a rusty lock on the door"
- Extension detects: "lock" noun + "rusty" modifier → DEX difficulty = 14 + (-4) = **10**
- Because `require_modifier: true`, a plain "lock" with no modifiers would use the default difficulty threshold instead
- "lock eyes" is excluded by the exclude_patterns array

## Technical Details

### Message Injection Format

When you make a skill check, the extension appends this to your message:

```
[System: The user attempted an action using {STAT}. They {OUTCOME}. Narrate accordingly.]
```

**Important**: Only the outcome is included, NOT the numerical roll. This prevents the AI from reinterpreting the numbers.

### Character Sheet Injection Format

When enabled, this is prepended to your message:

```
[Character Sheet]
Name: {name}
Class: {class}
Level: {level}
STR: {str} ({mod}) | DEX: {dex} ({mod}) | CON: {con} ({mod})
INT: {int} ({mod}) | WIS: {wis} ({mod}) | CHA: {cha} ({mod})
HP: {current}/{max}
Inventory: {comma-separated items}
Active Spells: {comma-separated spells}
```

### Detection Flow

**On Message Receive** (from AI):
1. Check for inventory additions/removals → update inventory
2. Check for spell casts/dispels → update active spells
3. Check for level-up → update character level
4. If auto-detect enabled: Scan for challenge nouns + modifiers → update activeChallenges array

**On Stat Button Click**:
1. Read user's typed message
2. If auto-detect enabled: Match user message against activeChallenges for action verbs + nouns
3. Determine difficulty (auto-detected challenge, manual override, or default threshold)
4. Roll 1d20 + stat modifier
5. Determine outcome tier (critical failure, failure, success, strong success)
6. If "Inject Character Sheet" enabled: Prepend character sheet to message
7. Append system message with outcome
8. If "Append Roll Without Auto-Sending" disabled: Auto-click send button
9. Show toast notification with roll result

### Compatibility

- Requires SillyTavern (tested with recent versions)
- Works with all AI backends (OpenAI, Claude, local models, etc.)
- Compatible with other extensions
- No backend/server component required - runs entirely in browser

## Troubleshooting

### Extension not loading at all (no console messages)

**Problem**: You don't see any `[Skill Check]` messages in the browser console (F12).

**Solutions**:
1. **Check file location**: The extension must be in:
   ```
   [SillyTavern]/public/scripts/extensions/third-party/skill-check/
   ```
   NOT in:
   - `[SillyTavern]/public/scripts/extensions/skill-check/` (missing third-party folder)
   - `[SillyTavern]/extensions/skill-check/` (wrong extensions folder)

2. **Verify file structure**: Make sure all files are present:
   - `manifest.json`
   - `index.js`
   - `style.css`

3. **Check manifest.json**: Open it and verify it's valid JSON (no syntax errors)

4. **Refresh completely**:
   - Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
   - Or clear browser cache and restart SillyTavern

5. **Check browser console for errors**: Press F12 and look for any red error messages

### Extension loads but no UI appears

**Problem**: You see `[Skill Check] Extension loaded successfully` but no stat buttons.

**Debug steps**:
1. Open browser console (F12)
2. Look for messages like:
   ```
   [Skill Check] Injecting before #send_form
   [Skill Check] Stat buttons created successfully
   ```

3. If you see `FAILED to inject stat buttons`, check the error details

4. **Check if extension is enabled**:
   - Look for "Skill Check Settings" in Extensions panel
   - Make sure the "Enable Skill Check Extension" checkbox is checked

5. **Try manual injection** in console:
   ```javascript
   $('#send_form').before('<div style="background:red;padding:10px;">TEST</div>')
   ```
   If this doesn't appear, your SillyTavern theme uses different selectors.

### Settings panel not appearing

**Problem**: You don't see "Skill Check Settings" in the Extensions panel.

**Solutions**:
1. Check console for: `[Skill Check] Settings panel created successfully`
2. If you see an error about `#extensions_settings2`, your SillyTavern version may use a different structure
3. Try scrolling down in the Extensions settings panel - it may be at the bottom

### Stat buttons not appearing
- Make sure the extension is enabled in settings
- Check the browser console for errors (F12)
- Verify the extension loaded: look for `[Skill Check] Extension loaded successfully` in the console
- Check that the buttons aren't hidden - look for the "Skill Check:" label near your message box

### Messages not sending
- Ensure you've typed a message before clicking a stat button
- Check that the send button (`#send_but`) exists in your SillyTavern theme
- Look in console for errors when clicking a stat button

### AI ignoring outcomes
- Make sure your system prompt doesn't override system instructions
- Some models may be more compliant than others with outcome instructions
- Try adding a note in your system prompt: "Follow [System:] instructions exactly"

### Challenge detection not working
- Check browser console (F12) for `[Skill Check] Active challenges:` logs
- Verify "Auto-Detect Challenges" is enabled in settings
- Increase "Context Messages to Scan" if challenges are in older messages
- Check that your action message contains both an action verb AND the challenge noun
- Look for exclusion patterns that might be blocking detection

### Inventory not tracking
- Inventory tracking requires strict patterns: "X added to inventory" or "add X to inventory"
- AI must use this exact phrasing for detection to work
- You can manually add items using the settings panel
- Check console for `[Skill Check] Inventory added:` logs

### Level not updating
- AI must use phrases like "you reach level X" or "you've leveled up to level X"
- You can manually edit your level in the settings panel
- Check console for `[Skill Check] Level-up detected:` logs

### Settings not saving
- Settings auto-save when changed
- Check browser console for errors
- Ensure SillyTavern has write permissions for `settings.json`
- Try changing a setting and refreshing - if it reverts, there's a save issue

### False positives with challenge detection
- Use exclusion patterns in your compendium entries
- Set `require_modifier: true` for challenges that need context (like locks)
- Check the console logs to see what's being detected
- Adjust the action_verbs list to be more specific
- Remember: Phase 2 requires BOTH an action verb AND noun match to trigger

### Getting detailed debug info

If none of the above helps, run this in the browser console (F12):
```javascript
console.log('=== Skill Check Debug Info ===');
console.log('Extension settings:', extension_settings['skill-check']);
console.log('Buttons exist:', $('#skill-check-buttons').length > 0);
console.log('Settings panel exists:', $('#skill-check-settings').length > 0);
console.log('Send form:', $('#send_form').length);
console.log('Send textarea:', $('#send_textarea').length);
console.log('Send button:', $('#send_but').length);
console.log('Active challenges:', window.skillCheckActiveChallenges || 'Not available');
console.log('Compendium entries:', extension_settings['skill-check']?.compendium?.entries?.length || 0);
```

Share this output when reporting issues.

## Tips and Best Practices

### Getting the Most Out of Auto-Detection

1. **Tell the AI to use specific phrasing**: Add this to your system prompt or author's note:
   ```
   When the character adds or removes items from their inventory, phrase it as:
   "X added to inventory" or "X removed from inventory"
   ```

2. **Use descriptive modifiers**: Instead of "a dragon appears", use "an ancient dragon appears" for automatic difficulty adjustment.

3. **Enable character sheet injection**: This helps the AI remember your stats, inventory, and abilities without you repeating them.

4. **Review rolls before sending**: Keep "Append Roll Without Auto-Sending" enabled so you can verify the outcome before sending.

5. **Customize your compendium**: Add challenges specific to your campaign (custom monsters, NPCs, obstacles).

### Creating Custom Compendium Entries

When creating your own entries:

1. **Start with action verbs**: Think about what verbs players would use to interact with this challenge.
   - Fighting: "attack", "fight", "strike", "defend"
   - Stealth: "sneak", "hide", "evade", "avoid"
   - Social: "persuade", "intimidate", "deceive", "charm"

2. **Add exclusion patterns**: Consider common false positives:
   - "guard" might match "on guard" or "guard stance"
   - "lock" might match "lock eyes" or "interlock"
   - Add these to `exclude_patterns` to prevent false triggers

3. **Balance stickiness**:
   - Short encounters (traps): 5-10 messages
   - Medium encounters (NPCs, obstacles): 15-20 messages
   - Long encounters (bosses, dungeons): 25-30 messages

4. **Use require_modifier wisely**:
   - Set `true` for generic objects that need context (locks, doors, walls)
   - Set `false` for specific entities that are always challenges (dragons, specific NPCs)

5. **Test your modifiers**: Roll against your custom entries with different modifiers to ensure the difficulty feels appropriate.

### Roleplay Integration

**For dungeon masters**: Tell your players to enable the extension and add this to your system prompt:
```
Follow all [System:] instructions exactly. When skill checks fail, narrate realistic consequences. When they critically fail, create dramatic complications. When they succeed strongly, reward them with exceptional outcomes.
```

**For players**: Add this to your character card or author's note:
```
My character's stats and inventory are tracked via [Character Sheet] blocks. Reference them when narrating actions and consequences.
```

## Development

### File Structure
```
skill-check/
├── manifest.json              # Extension metadata
├── index.js                   # Main logic (detection, UI, dice rolling)
├── default-compendium.json    # Default challenge definitions
├── style.css                  # Styles for UI elements
├── README.md                  # Documentation
└── LICENSE                    # MIT License
```

### Architecture Overview

**Key Functions**:

- `scanForActiveChallenges(messages, currentIndex)` - Phase 1: Scans messages for challenge nouns and modifiers
- `detectActionAgainstChallenges(userMessage, challenges)` - Phase 2: Matches user actions against active challenges
- `performSkillCheck(stat)` - Main entry point when user clicks a stat button
- `determineOutcome(naturalRoll, total, difficulty)` - Calculates outcome tier from roll result
- `detectInventoryAdditions(text)` / `detectInventoryRemovals(text)` - Parses inventory changes
- `buildCharacterSheet()` - Generates character sheet text for context injection

**Data Flow**:
1. AI message received → Scan for challenges, inventory, spells, level-ups
2. User types message + clicks stat button → Detect action, roll dice, inject outcome
3. Settings changed → Auto-save to `extension_settings['skill-check']`

### Modifying Outcomes

To customize outcome messages, edit the `determineOutcome` function in [index.js](index.js):

```javascript
function determineOutcome(naturalRoll, total, difficulty) {
    // Critical failure: natural 1 OR total <= 5
    if (naturalRoll === 1 || total <= 5) {
        return "FAILED BADLY. Narrate a serious setback, complication, or injury. Do not soften the failure.";
    }
    // Modify these messages as needed...
}
```

### Adding New Detection Patterns

To add new auto-detection capabilities:

1. **Add to compendium**: Create a new entry in `default-compendium.json` or via UI
2. **Modify detection logic**: If you need new detection types beyond challenges/inventory/spells/levels, add new functions in `index.js`
3. **Add UI controls**: Update the settings panel HTML if you need new controls
4. **Update settings schema**: Add new settings to the default settings object

### Testing

1. Enable browser console (F12)
2. Look for `[Skill Check]` prefix logs - these show all detection events
3. Check `Active challenges:` logs to see what's being detected
4. Use the debug info snippet from Troubleshooting section to inspect state
5. Test with the example scenarios in this README

### Console Logging

The extension includes extensive console logging for debugging:
- `[Skill Check] ✓ Extension loaded successfully` - Initialization
- `[Skill Check] Active challenges:` - Shows detected challenges
- `[Skill Check] Matched action against challenge:` - Shows action matches
- `[Skill Check] Inventory added/removed:` - Shows inventory changes
- `[Skill Check] Level-up detected:` - Shows level changes
- `[Skill Check] Rolling {stat} check vs DC {difficulty}` - Shows each roll

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Credits

Created for the SillyTavern community.

## Support

- Report bugs: [GitHub Issues](https://github.com/lucashald/skill-check/issues)
- Discuss: [SillyTavern Discord](https://discord.gg/sillytavern)

---

**Enjoy rolling for your actions!** May your natural 20s be frequent and your critical failures be narratively interesting.
