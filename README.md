# Skill Check - SillyTavern Extension

A third-party extension for [SillyTavern](https://github.com/SillyTavern/SillyTavern) that adds RPG-style skill checks to your roleplay sessions. Roll dice against your character's stats and let the AI narrate success or failure based on outcomes, not numbers.

## What It Does

Skill Check adds a dice rolling system to SillyTavern that integrates seamlessly with your roleplay. When you want your character to attempt an action that has a chance of failure:

1. Type your action in the message box
2. Click one of the stat buttons (STR, DEX, CON, INT, WIS, CHA)
3. The extension rolls 1d20 + your stat modifier
4. The **outcome** (not the numbers) is injected into your message
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

1. **Set up your character stats** (optional - defaults to 10):
   - Go to Extensions > Skill Check Settings
   - Enter your character's ability scores (1-30)
   - Stat modifiers are calculated automatically using D&D rules: `modifier = floor((stat - 10) / 2)`

2. **Make a skill check**:
   - Type your action: "I try to climb the cliff wall"
   - Click the **STR** button
   - The extension rolls, determines the outcome, and sends your message with the result injected

3. **See what happened**:
   - A toast notification shows you the roll: "STR Check: 14 + 2 = 16 → SUCCESS"
   - The AI receives: "I try to climb the cliff wall. [System: The user attempted an action using STR. They SUCCEEDED. Narrate the user achieving their goal.]"
   - The AI narrates accordingly: "Your muscles strain as you find purchase on the rocky surface. You pull yourself up the cliff face successfully..."

### Stat Buttons

- **STR** (Strength): Physical power, melee attacks, climbing, breaking things
- **DEX** (Dexterity): Agility, stealth, ranged attacks, dodging
- **CON** (Constitution): Endurance, resisting poison/disease, physical stamina
- **INT** (Intelligence): Knowledge, investigation, arcane magic
- **WIS** (Wisdom): Perception, insight, survival, divine magic
- **CHA** (Charisma): Persuasion, deception, performance, intimidation

### Configuring Difficulty

The default difficulty is **12** (the target number your roll must meet or exceed).

You can adjust this in the settings:
- **Easy tasks**: 8-10
- **Moderate tasks**: 12-14
- **Hard tasks**: 16-18
- **Very hard tasks**: 20+

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

### Enable/Disable
Toggle the entire extension on or off.

### Character Stats
Set each stat (STR, DEX, CON, INT, WIS, CHA) from 1 to 30.
- Default: 10 (modifier: +0)
- Example modifiers:
  - Stat 8 → -1
  - Stat 10 → +0
  - Stat 14 → +2
  - Stat 18 → +4
  - Stat 20 → +5

### Difficulty Threshold
Set the target number for skill checks (1-30). Default: 12.

## Technical Details

### Message Injection Format

When you make a skill check, the extension appends this to your message:

```
[System: The user attempted an action using {STAT}. They {OUTCOME}. Narrate accordingly.]
```

**Important**: Only the outcome is included, NOT the numerical roll. This prevents the AI from reinterpreting the numbers.

### Dice Rolling

- Roll: 1d20
- Modifier: `Math.floor((stat - 10) / 2)`
- Total: Roll + Modifier
- Comparison: Total vs Difficulty Threshold

### Compatibility

- Requires SillyTavern (tested with recent versions)
- Works with all AI backends (OpenAI, Claude, local models, etc.)
- Compatible with other extensions

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

### Settings not saving
- Settings auto-save when changed
- Check browser console for errors
- Ensure SillyTavern has write permissions for `settings.json`
- Try changing a setting and refreshing - if it reverts, there's a save issue

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
```

Share this output when reporting issues.

## Development

### File Structure
```
skill-check/
├── manifest.json     # Extension metadata
├── index.js          # Main logic
├── style.css         # Styles
├── README.md         # Documentation
└── LICENSE           # MIT License
```

### Modifying Outcomes

To customize outcome messages, edit the `determineOutcome` function in [index.js](index.js):

```javascript
function determineOutcome(naturalRoll, total, difficulty) {
    // Modify the outcome text here
}
```

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
