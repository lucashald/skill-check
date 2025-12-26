# Detection System Guide

## How It Works (Two-Phase System)

Your recent commit changed from simple keyword matching to a two-phase detection system:

### Phase 1: Passive Context Scanning
- Scans recent AI messages for challenge **nouns** (e.g., "dragon", "goblin", "trap")
- Detects **modifiers** that adjust difficulty (e.g., "ancient dragon" → harder)
- Builds an "active challenges" array with **stickiness** (persists for N messages)

### Phase 2: Active Action Detection
- When user types an action, checks if it contains:
  1. An **action verb** from the challenge's verb list
  2. The challenge **noun** (or reference to it)
- If BOTH match → applies the challenge difficulty
- If only noun matches → no difficulty applied (just context)

## Your Test Case Issue

**User message:** "i run away from the dragon"

**Why it failed:**
- Dragon's action_verbs was: `["attack", "fight", "strike", "charge", "evade", "dodge", "confront", "engage", "battle"]`
- "run" and "run away" were NOT in the list
- Phase 1 detected the dragon (noun found)
- Phase 2 failed to match because no action verb matched

**Fix applied:**
Added movement/escape verbs to dragon entry:
```json
"action_verbs": [
  "attack", "fight", "strike", "charge",
  "evade", "dodge", "confront", "engage", "battle",
  "run", "flee", "escape", "run away", "run from"
]
```

## Compendium Entry Structure

```json
{
  "id": "dragon",
  "name": "Dragon",
  "type": "monster",
  "require_modifier": false,
  "stickiness": 15,
  "detection": {
    "nouns": ["dragon", "dragons", "wyrm"],
    "action_verbs": ["attack", "fight", "flee", "..."],
    "modifiers": {
      "easy": {
        "keywords": ["young", "wounded"],
        "difficulty_adjust": -6
      },
      "hard": {
        "keywords": ["ancient", "legendary"],
        "difficulty_adjust": 8
      }
    }
  },
  "base_difficulties": {
    "STR": 22,
    "DEX": 18,
    "CON": 24,
    "INT": 20,
    "WIS": 18,
    "CHA": 20
  },
  "notes": "Near impossible without legendary equipment."
}
```

## Tips for Creating New Entries

1. **Nouns** should be the main thing being interacted with
   - Include singular, plural, and synonyms
   - Example: `["dragon", "dragons", "wyrm"]`

2. **Action verbs** should cover ALL likely player actions
   - Combat: attack, fight, strike
   - Movement: run, flee, dodge, evade
   - Interaction: talk to, persuade, bribe
   - Be comprehensive! Missing verbs = detection fails

3. **Modifiers** are optional but add depth
   - Easy modifiers: reduce difficulty
   - Hard modifiers: increase difficulty
   - System uses strongest modifier found

4. **Stickiness** controls how long challenge persists
   - Higher = stays active longer after mention
   - Recommended: 10-20 for most challenges

5. **require_modifier** forces modifier to trigger
   - Good for things like locks (need "rusty lock" or "complex lock")
   - Set to `false` for most challenges

## Debugging

Paste `test-detection.js` into browser console to check:
- Are compendiums loaded?
- What action verbs does an entry have?
- What challenges are currently active?

Check console logs for:
- `PHASE 1: PASSIVE CONTEXT SCANNING` - Did it find the noun?
- `PHASE 2: ACTIVE ACTION DETECTION` - Did it find both verb and noun?
- `Active challenges after update: N` - How many challenges are active?
