// Quick test for detection system
// Paste this into browser console after loading the extension

console.log('=== Detection System Test ===');
console.log('Loaded compendiums:', loadedCompendiums.length);

if (loadedCompendiums.length > 0) {
    console.log('\nCompendiums:');
    loadedCompendiums.forEach(c => {
        console.log(`  - ${c.name}: ${c.entries.length} entries (${c._enabled ? 'enabled' : 'disabled'})`);
    });

    console.log('\nDragon entry action verbs:');
    const dragon = loadedCompendiums[0].entries.find(e => e.id === 'dragon');
    if (dragon) {
        console.log('  Nouns:', dragon.detection.nouns);
        console.log('  Action verbs:', dragon.detection.action_verbs);
    }
} else {
    console.error('No compendiums loaded!');
}

console.log('\nActive challenges:', activeChallenges.length);
if (activeChallenges.length > 0) {
    activeChallenges.forEach(c => {
        console.log(`  - ${c.entry.name} (stickiness: ${c.stickinessRemaining}/${c.maxStickiness})`);
    });
}
