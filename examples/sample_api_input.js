Fretboard.init({
    containerId: 'fretboard_1',

    // Settings Group A - Fretboard Variables
    settingsGroupA: {
        dotTextMode: 'note',
        showFretIndicators: 'first-fret-cond',
        numStrings: 6,
        stringType: '1',
        tuning: {
            1: 'E',
            2: 'A',
            3: 'D',
            4: 'G',
            5: 'B',
            6: 'E'
        },
        cssVariables: {
            '--string-thinnest-width': '1px'
        }
    },


    // Instruments
    instruments: {
        guitar: {
            instrumentLabel: 'Guitar',
            tuning: {
                1: 'E',
                2: 'A',
                3: 'D',
                4: 'G',
                5: 'B',
                6: 'E'
            },
            numStrings: 6,
            stringType: '1'
        },
        mandolin: {
            instrumentLabel: 'Mandolin',
            tuning: {
                1: 'G',
                2: 'D',
                3: 'A',
                4: 'E'
            },
            numStrings: 4,
            stringType: '2'
        }
    },

    // Settings Group B - Fretboard Skin
    settingsGroupB: {
        fretMarkers: {
            3: 'single',
            5: 'single',
            7: 'single',
            9: 'single',
            12: 'double',
            15: 'single',
            17: 'single',
            19: 'single',
            21: 'single',
            24: 'double'
        },
        fretboardBindingDisplay: true
    },




    // Themes - Multiple theme presets for Settings Group B
    themes: {
        mandolinRosewood: {
            themeLabel: 'Rosewood',
            fretMarkers: {
                3: 'single',
                5: 'single',
                7: 'single',
                9: 'single',
                12: 'double',
                15: 'single',
                17: 'single',
                19: 'single',
                21: 'single',
                24: 'double'
            },
            fretboardBindingDisplay: true,
            cssVariables: {
                '--string-3-default-color': 'linear-gradient(90deg,rgba(163, 163, 163, 1) 0%, rgba(232, 232, 232, 1) 26%, rgba(130, 130, 130, 1) 100%)',
                '--string-4-default-color': 'linear-gradient(90deg,rgba(163, 163, 163, 1) 0%, rgba(232, 232, 232, 1) 26%, rgba(130, 130, 130, 1) 100%)',
                '--string-5-default-color': 'linear-gradient(90deg,rgba(163, 163, 163, 1) 0%, rgba(232, 232, 232, 1) 26%, rgba(130, 130, 130, 1) 100%)'
            }
        },
        guitarEbony: {
            themeLabel: 'Ebony',
            fretMarkers: {
                3: 'single',
                5: 'single',
                7: 'single',
                9: 'single',
                12: 'double',
                15: 'single',
                17: 'single',
                19: 'single',
                21: 'single',
                24: 'double'
            },
            fretboardBindingDisplay: false,
            cssVariables: {
                '--string-1-default-color': 'linear-gradient(90deg,rgba(20, 20, 20, 1) 0%, rgba(60, 60, 60, 1) 50%, rgba(20, 20, 20, 1) 100%)',
                '--string-2-default-color': 'linear-gradient(90deg,rgba(25, 25, 25, 1) 0%, rgba(65, 65, 65, 1) 50%, rgba(25, 25, 25, 1) 100%)',
                '--string-3-default-color': 'linear-gradient(90deg,rgba(30, 30, 30, 1) 0%, rgba(70, 70, 70, 1) 50%, rgba(30, 30, 30, 1) 100%)',
                '--string-4-default-color': 'linear-gradient(90deg,rgba(35, 35, 35, 1) 0%, rgba(75, 75, 75, 1) 50%, rgba(35, 35, 35, 1) 100%)',
                '--string-5-default-color': 'linear-gradient(90deg,rgba(40, 40, 40, 1) 0%, rgba(80, 80, 80, 1) 50%, rgba(40, 40, 40, 1) 100%)',
                '--string-6-default-color': 'linear-gradient(90deg,rgba(45, 45, 45, 1) 0%, rgba(85, 85, 85, 1) 50%, rgba(45, 45, 45, 1) 100%)'
            }
        }
    }
});
