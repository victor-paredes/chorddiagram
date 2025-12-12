// Update Settings Group A
window.Fretboard.updateSettingsGroupA({
    tuning: { 1: 'E', 2: 'A', 3: 'D', 4: 'G', 5: 'B', 6: 'E' },
    numStrings: 6,
    stringType: '1'
}, 'fretboard-1');

// Update Settings Group B
window.Fretboard.updateSettingsGroupB({
    fretMarkers: { 3: 'single', 12: 'double' },
    fretboardBindingDisplay: true,
    cssVariables: {
        '--string-1-default-color': 'linear-gradient(...)'
    }
}, 'fretboard-1');

// Update Settings Group C
window.Fretboard.updateSettingsGroupC({
    name: 'C Major',
    root: 'C',
    fingering: [
        { string: 1, fret: 0, finger: 0 },
        { string: 2, fret: 1, finger: 1 }
    ],
    startFret: 1,
    numFrets: 12
}, false, 'fretboard-1');