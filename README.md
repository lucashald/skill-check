# Skill Check - SillyTavern Extension

A third-party extension for [SillyTavern](https://github.com/SillyTavern/SillyTavern) that adds RPG-style skill checks, AI-declared difficulty, AI-managed inventory tracking, and character progression to your roleplay sessions. Roll dice against your character's stats and let the AI narrate success or failure based on outcomes, not numbers.

## What It Does

Skill Check adds a comprehensive RPG system to SillyTavern:

### Core Features

1. **Manual Skill Checks**: Click a stat button to roll 1d20 + modifier against a difficulty. Shift-click for **advantage** (2d20 take highest), Ctrl-click for **disadvantage** (take lowest)
2. **AI-Declared Difficulty**: The AI acts as Game Master and explicitly sets the DC for challenges it presents using `[SKILL DC: 15]` tags — the active DC is shown as a **badge** next to the stat buttons *before* you roll, and buttons with a declared DC glow
3. **AI-Managed Inventory, Spells & HP**: The AI declares changes with `[ITEM GAINED: ...]`, `[SPELL LEARNED: ...]`, `[HP: -5]` tags. Every change pops a **toast with an Undo button**, and changes from swiped-away or edited messages are automatically reverted
4. **Explicit Level-Ups**: The AI declares level-ups with a `[LEVEL UP]` tag; you confirm before it's applied. Missed the toast? The offer stays as a badge on the character sheet button
5. **Character Sheet Injection**: Your stats, HP, inventory, and spells are automatically included in AI context
6. **Clean Chat**: Protocol tags are cosmetically hidden from rendered messages (toggleable)
7. **Roll History**: The last 10 rolls (with dice, DC, and outcome) are listed in the character sheet popup
8. **Customizable Outcomes**: Edit the per-tier instructions the AI receives ("FAILED BADLY. Narrate…") to fit your genre

### Basic Workflow

1. Type your action in the message box
2. Click one of the stat buttons (STR, DEX, CON, INT, WIS, CHA)
3. The extension rolls 1d20 + your stat modifier against the AI-declared DC (or your default)
4. The **outcome** (not the numbers) is shown to you and injected into your message
5. The AI narrates the result based on whether you succeeded or failed

## Design Philosophy: Explicit Over Implicit

Earlier versions of this extension tried to *guess* game state from prose — scanning messages for keywords like "ancient dragon" to infer difficulty, or matching phrases like "added to inventory" to track items. Keyword detection is brittle: miss a verb and the check silently uses the wrong DC; phrase the loot drop slightly differently and the item is never tracked.

This version flips the responsibility. The extension **tells the AI how to declare game state explicitly** (via an injected Game Master instruction block), and then parses only those exact, unambiguous tags:

- ❌ Old: AI says "an ancient dragon blocks your path" → extension guesses DC from a keyword compendium
- ✅ New: AI says "an ancient dragon blocks your path `[SKILL DC: STR 22, DEX 18 | Ancient Dragon]`" → extension knows the DC exactly

The same applies to dice results. Instead of showing the AI the numerical roll (which models tend to reinterpret generously), the extension tells the AI the *outcome* directly:

- ❌ "You rolled a 7" → AI might still narrate a partial success
- ✅ "They FAILED" → AI narrates a failure as instructed

## The Tag Protocol

When "Inject GM instructions" is enabled (default), the extension teaches the AI these tags. Each goes on its own line at the end of the AI's message:

| Tag | Meaning |
|-----|---------|
| `[SKILL DC: 15]` | The challenge ahead has difficulty 15 for any stat |
| `[SKILL DC: STR 18, DEX 12]` | Per-stat difficulties (breaking the door vs. picking the lock) |
| `[SKILL DC: 15 \| Rusty Lock]` | Optional challenge name after a pipe (shown in the roll toast) |
| `[ITEM GAINED: health potion x2]` | Add 2 health potions to inventory (quantity optional) |
| `[ITEM LOST: rope]` | Remove rope from inventory (`ITEM USED` / `ITEM REMOVED` also work) |
| `[SPELL LEARNED: fireball]` | Add a spell to your spell list |
| `[SPELL FORGOTTEN: fireball]` | Remove a spell from your spell list |
| `[HP: -5]` | Take 5 damage. `[HP: +3]` heals, `[HP: 25]` sets an exact value |
| `[HP MAX: 40]` | Change maximum HP |
| `[LEVEL UP]` | Gain a level (`[LEVEL UP: 2]` for multiple); shows a confirmation toast |

Tags are case-insensitive. `[DC: 15]` works as shorthand for `[SKILL DC: 15]`, and `[ITEM ADDED: ...]` / `[SPELL GAINED: ...]` are accepted as aliases.

**How difficulty resolution works** when you click a stat button, in priority order:

1. **Next roll DC override** — a one-shot manual DC you set in the character sheet popup (resets after one roll)
2. **AI-declared DC** — the most recent `[SKILL DC]` tag in the last N messages (N = "context messages" setting, default 5). Per-stat DCs are matched to the stat you clicked; a flat DC applies to any stat.
3. **Default difficulty** — your configured fallback DC (default 12)

The currently active DC is always visible as a badge next to the stat buttons, so you know the difficulty *before* you roll. When the AI declares per-stat DCs, the matching stat buttons light up. You can also type a `[SKILL DC: X]` tag yourself in chat if you want to force a specific difficulty narratively.

**Trust but verify**: every inventory/spell/HP change the AI declares is shown in a "Character updated" toast with an **Undo** button. If you swipe to a different AI response or edit a message, the changes from the discarded version are automatically rolled back before the new version is applied.

## Installation

### Method 1: Built-in Extension Installer (Recommended)

1. Open SillyTavern
2. Go to **Extensions** > **Install Extension**
3. Enter the GitHub URL: `https://github.com/lucashald/skill-check`
4. Click **Install**
5. Refresh the page (F5 or Ctrl+R)

### Method 2: Manual Installation

1. Download or clone this repository
2. Copy the entire `skill-check` folder to:
   ```
   [SillyTavern]/public/scripts/extensions/third-party/skill-check/
   ```
   **Important**: The files must be in a folder named `skill-check` inside the `third-party` directory.
3. Restart SillyTavern or refresh the page (Ctrl+R or F5)

### Verifying Installation

After installing, open your browser console (F12) and look for:
```
[Skill Check] ✓ Extension loaded successfully
```

The stat buttons should appear near your message input area.

## How to Use

### Basic Usage

1. **Set up your character**:
   - Click the scroll icon next to the stat buttons to open the character sheet
   - Set your stats, level, inventory, and spells
   - Leave "Inject character sheet" and "Inject GM instructions" enabled

2. **Play**:
   - The AI presents a challenge and declares its difficulty: *"The vault door is sealed with a masterwork lock. `[SKILL DC: DEX 17 | Masterwork Lock]`"*
   - The badge next to the stat buttons shows "Masterwork Lock — DEX 17" and the DEX button glows
   - Type your action: "I carefully work my picks into the mechanism"
   - Click the **DEX** button (or Shift-click if you have advantage)
   - The extension rolls 1d20 + your DEX modifier vs DC 17

3. **See what happened**:
   - A toast shows you the roll: "DEX Check vs Masterwork Lock (DC 17): 14 + 4 = 18 → SUCCESS"
   - The AI receives: `[System: The user attempted an action against Masterwork Lock using DEX. They SUCCEEDED. Narrate the user achieving their goal.]`
   - The AI narrates accordingly — and if there's loot, it declares it: *"The lock clicks open. Inside you find a coiled silver rope. `[ITEM GAINED: silver rope]`"*
   - A "Character updated" toast confirms *+ silver rope* (with Undo, in case the AI got creative)

### Manual Difficulty Control

If the AI didn't declare a DC (or you disagree with it), you have two options:

- **Next roll DC override**: In the character sheet popup, set "Next roll DC override" to any value 1-30. It applies to your next roll only, then resets.
- **Default difficulty**: The fallback DC used when nothing else applies. Adjustable with presets from Very Easy (5) to Nearly Impossible (25).

## Outcome Tiers

The extension determines outcomes based on your roll:

### 🔴 Critical Failure
**Triggers**: Natural 1 **OR** fails the DC by 4+

The AI is instructed: *"FAILED BADLY. Narrate a serious setback, complication, or injury. Do not soften the failure."*

### 🟠 Failure
**Triggers**: Total < difficulty (but not critical)

The AI is instructed: *"FAILED. Narrate the user not achieving their goal. There may be minor consequences."*

### 🟢 Success
**Triggers**: Total ≥ difficulty

The AI is instructed: *"SUCCEEDED. Narrate the user achieving their goal."*

### 🔵 Strong Success
**Triggers**: Exceeds the DC by 4+ **OR** natural 20

The AI is instructed: *"SUCCEEDED EXCEPTIONALLY. Narrate an impressive, skillful, or lucky outcome."*

## Settings

The character sheet popup (scroll icon) is the single source of truth for all settings. The Extensions panel (**Extensions** > **Skill Check Settings**) only has the master enable toggle and a shortcut to open the popup.

### Difficulty

- **Use AI-declared difficulty** (default: ON): Read `[SKILL DC]` tags from recent messages. When off, rolls always use the default DC (or the one-shot override).
- **Inject GM instructions** (default: ON): Injects the tag protocol instructions into context so the AI knows how to declare DCs and manage inventory. Turn this off if you'd rather put the instructions in your own system prompt or character card.
- **Inject character sheet** (default: ON): Includes your stats, HP, inventory, and spells in AI context.
- **Hide tags in chat display** (default: ON): Cosmetically strips protocol tags from rendered messages. The underlying message text is untouched (the extension still parses it); reload the chat to restore already-hidden tags after turning this off.
- **Append roll without auto-sending** (default: ON): Lets you review the roll outcome before sending.
- **Next roll DC override**: One-shot manual DC (0 = off).

### Default Difficulty (DC)

The fallback target number (1-30, default 12) used when the AI hasn't declared a DC.

### Stats

- **Level** with +/- controls; level-up confirmations grant points to spend. Unapplied level-up offers appear here with an Apply button.
- **HP**: current / max, editable manually and updated by `[HP: ...]` tags
- **D&D style toggle**: When on, modifier = (stat − 10) / 2. When off, the stat value IS the modifier.
- Six renamable stats (click a stat name to edit it — useful for non-fantasy settings)

### Inventory & Spells

Both lists are managed by the AI via tags, but you can always add, edit, or delete entries manually here. "Add Item" / "Add Spell" create an inline row you can type into directly.

### Recent Rolls

The last 10 rolls with dice, modifier, DC, challenge, and outcome — handy when you want to cite "I rolled a nat 20 two turns ago."

### Outcome Instructions

The four per-tier instructions sent to the AI (critical failure / failure / success / strong success) are editable textareas. Tune them to your genre — a horror campaign's failures can hit harder than a slice-of-life comedy's. "Reset outcome texts" restores the defaults.

## Technical Details

### Message Injection Format

When you make a skill check, the extension appends this to your message:

```
[System: The user attempted an action against {challenge} using {STAT}. They {OUTCOME}.]
```

Only the outcome is included, NOT the numerical roll. This prevents the AI from reinterpreting the numbers. The "against {challenge}" clause is only added when the AI gave the challenge an actual name (via `[SKILL DC: 15 | Rusty Lock]`), and advantage/disadvantage is mentioned ("with advantage") so the AI can color the narration.

### Context Injection Format

When enabled, the extension injects (after character definitions):

```
---CHARACTER SHEET---
Level: {level}
HP: {current}/{max}
Stats: STR +3, DEX +2, ...
Inventory: rope, health potion (×2)
Spells: fireball
---END CHARACTER SHEET---
---GAME MASTER INSTRUCTIONS---
{tag protocol instructions with a difficulty calibration guide:
 5 = trivial, 10 = easy, 12 = medium, 15 = hard, 20 = very hard, 25 = nearly impossible}
---END GAME MASTER INSTRUCTIONS---
```

### Message Flow

**On AI message received** (including swipes and edits):
1. The newest AI message is processed exactly once *per version* — a content hash detects swipes/edits, reverts the changes the discarded version made, and applies the new version's tags
2. `[ITEM ...]`, `[SPELL ...]`, and `[HP ...]` tags are applied to your sheet immediately, and a "Character updated" toast with Undo summarizes them
3. `[LEVEL UP]` tags show a confirmation toast (Apply grants the level + a stat point to spend); unresolved offers stay as a badge on the scroll button
4. The DC badge next to the stat buttons refreshes

**On stat button click**:
1. Resolve difficulty: one-shot override → most recent `[SKILL DC]` tag → default DC
2. Roll 1d20 + stat modifier (2d20 for Shift/Ctrl-click advantage/disadvantage), determine outcome tier
3. Show toast with the full roll math (you see the numbers; the AI doesn't) and record it in the roll history
4. Append the outcome instruction to your message; auto-send if configured

### Tag Hiding

Tags are hidden from rendered chat messages by default ("Hide tags in chat display" toggle). This is purely cosmetic — the underlying message text keeps the tags so parsing, regeneration, and context all work normally. Undo isn't retroactive: turning the toggle off restores tags on newly rendered messages; reload the chat to re-render older ones.

### Compatibility

- Requires SillyTavern (tested with recent versions)
- Works with all AI backends (OpenAI, Claude, local models, etc.)
- No backend/server component required — runs entirely in browser

## Troubleshooting

### Extension not loading at all

1. **Check file location**: must be `[SillyTavern]/public/scripts/extensions/third-party/skill-check/`
2. **Verify files are present**: `manifest.json`, `index.js`, `style.css`
3. **Hard refresh**: Ctrl+Shift+R, or clear cache and restart SillyTavern
4. **Check the browser console** (F12) for red error messages

### The AI isn't emitting tags

- Verify "Inject GM instructions" is enabled in the character sheet popup
- Some models follow the protocol better than others. If the AI forgets, remind it in an author's note or system prompt: *"Always declare skill DCs and inventory changes using the bracket tags from the GAME MASTER INSTRUCTIONS."*
- Check the console for `[Skill Check] Character sheet prompt updated` to confirm the injection is active

### Rolls always use the default DC

- Check the AI actually emitted a `[SKILL DC: ...]` tag in a recent message (look at the raw message text)
- The tag must be within the last N messages (the `contextMessages` setting, default 5)
- Check the console for `[Skill Check] Found DC tag in message ...`
- A malformed tag body (e.g. `[SKILL DC: very hard]`) is ignored — the DC must be a number

### Inventory not tracking

- The AI must use the exact tag format: `[ITEM GAINED: name]` / `[ITEM LOST: name]`
- Prose like "you put the sword in your pack" is intentionally NOT parsed — ask the AI to emit tags, or add the item manually in the character sheet popup
- Check console for `[Skill Check] ✓ Tag matched:` logs

### AI ignoring outcomes

- Make sure your system prompt doesn't override system instructions
- Try adding: "Follow [System:] instructions exactly"

### Settings not saving

- Settings auto-save when changed; check the console for errors
- Ensure SillyTavern has write permissions for `settings.json`

### Getting detailed debug info

Run this in the browser console (F12):
```javascript
console.log('=== Skill Check Debug Info ===');
console.log('Extension settings:', extension_settings['skill-check']);
console.log('Buttons exist:', $('#skill-check-buttons').length > 0);
console.log('Send textarea:', $('#send_textarea').length);
```

## Tips and Best Practices

1. **Keep both injections on**: The GM instructions make the AI declare state; the character sheet lets it narrate consistently with your stats and gear.
2. **Review rolls before sending**: Keep "Append roll without auto-sending" enabled so you can verify the outcome first.
3. **Watch the badge**: If no DC badge is showing, the AI hasn't declared a difficulty — your roll will use the default DC. Glance before you click.
4. **Use advantage deliberately**: Shift-click when the fiction favors you (high ground, the right tool), Ctrl-click when it doesn't. Mentioning it in your action text helps the AI narrate it.
5. **Nudge lazy models**: If a model stops emitting tags mid-session, a one-line author's note ("Remember to declare [SKILL DC] tags for challenges") usually fixes it.
6. **For dungeon masters**: Add to your system prompt:
   ```
   Follow all [System:] instructions exactly. When skill checks fail, narrate realistic
   consequences. When they critically fail, create dramatic complications. When they
   succeed strongly, reward them with exceptional outcomes.
   ```

## Development

### File Structure
```
skill-check/
├── manifest.json    # Extension metadata
├── index.js         # Main logic (tag parsing, UI, dice rolling)
├── style.css        # Styles for UI elements
├── README.md        # Documentation
└── LICENSE          # MIT License
```

### Architecture Overview

**Key Functions**:

- `findLatestDcTag(messages)` — finds the most recent `[SKILL DC]` tag in recent messages
- `getActiveDifficulty(stat)` — resolves the DC (override → AI-declared → default)
- `updateDcBadge()` — refreshes the DC badge and stat-button highlighting
- `processIncomingMessage()` — processes each AI message version once (content hash detects swipes/edits and triggers revert + reprocess)
- `processMessageTags(text)` — applies item/spell/HP/level tags; returns the change list
- `revertTagChanges(changes)` / `showTagChangeToast(changes)` — undo support and the change toast
- `applyTagHiding()` — cosmetically strips tags from rendered messages
- `performSkillCheck(stat, rollMode)` — main entry point when a stat button is clicked (rollMode: normal/advantage/disadvantage)
- `determineOutcome(naturalRoll, total, difficulty)` — calculates the outcome tier using the user-editable texts
- `buildGmInstructions()` / `buildCharacterSheetPrompt()` — the injected context blocks

**Data Flow**:
1. AI message received (or swiped/edited) → revert stale changes → parse tags → update inventory/spells/HP/level → show change toast → refresh injected sheet, DC badge, and tag hiding
2. User types message + clicks stat button → resolve DC, roll dice, record history, inject outcome
3. Settings changed → auto-save to `extension_settings['skill-check']`

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
