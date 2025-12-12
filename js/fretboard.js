/**
 * Fretboard Module - Modular JavaScript Library for Guitar Fretboard Visualization
 * 
 * This module provides a complete fretboard visualization system that can be
 * configured via three settings groups (A, B, C) and initialized dynamically.
 */

(function() {
    'use strict';

    // ============================================================================
    // INTERNAL STATE AND CONSTANTS
    // ============================================================================

    // Chromatic scale
    const CHROMATIC_SCALE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    // Internal state variables
    let TUNING = {
        1: 'E',   // String 1 (Low E in standard tuning)
        2: 'A',   // String 2 (A in standard tuning)
        3: 'D',   // String 3 (D in standard tuning)
        4: 'G',   // String 4 (G in standard tuning)
        5: 'B',   // String 5 (B in standard tuning)
        6: 'E',   // String 6 (High E in standard tuning)
        7: 'B',   // String 7 (7-string guitar - low B)
        8: 'F#',  // String 8 (8-string guitar)
        9: 'C#',  // String 9 (9-string guitar)
        10: 'G#'  // String 10 (10-string guitar)
    };

    let START_FRET = 1;
    let CURRENT_CHORD_ROOT = null;
    let DOT_TEXT_MODE = 'note';
    let STRING_TYPE = '1';
    let CURRENT_CHORD_CONFIG = null;
    let PERSISTENT_DOT_STATE = [];
    let containerId = 'chord_builder_wrapper';
    let isInitialized = false;
    let autoInitAttempted = false;
    const manuallyInitialized = new Set(); // Track manually initialized fretboardIds
    
    // Registry for multiple fretboard instances
    const fretboardInstances = new Map(); // Map<fretboardId, instanceData>
    
    // Store configs from script-init calls with apply_to_fretboard attribute
    const scriptInitConfigs = new Map(); // Map<fretboardId, config>

    // ============================================================================

    // Settings Group A - Fretboard Variables (defaults)
    // Settings Group A - Non-CSS defaults only (CSS variables come from fretboard.css)
    // CSS is the single source of truth for CSS variables - JS only applies overrides when explicitly provided
    const defaultSettingsGroupA = {
        dotTextMode: 'note',
        showFretIndicators: 'first-fret-cond', // Options: 'all', 'none', 'first-fret', 'first-fret-cond'
        tuning: null,
        numStrings: 6,
        stringType: '1'
        // No cssVariables here - CSS file is the source of truth
    };

    // Settings Group B - Fretboard Skin (defaults)
    // JS only applies overrides when explicitly provided via API
    const defaultSettingsGroupB = {
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
        fretboardBindingDisplay: true // true = show bindings, false = hide bindings
        // No cssVariables here - CSS file is the source of truth
    };

    // Settings Group C - Chord Variables (defaults)
    const defaultSettingsGroupC = {
        name: null,
        root: null,
        startFret: 1,
        numFrets: 4,
        fingering: []
    };

    // Current settings state
    let settingsGroupA = JSON.parse(JSON.stringify(defaultSettingsGroupA));
    settingsGroupA.cssVariables = {}; // CSS is source of truth, track only overrides
    let settingsGroupB = JSON.parse(JSON.stringify(defaultSettingsGroupB));
    settingsGroupB.cssVariables = {}; // CSS is source of truth, track only overrides
    let settingsGroupC = JSON.parse(JSON.stringify(defaultSettingsGroupC));

    // FRET_MARKERS will be set from settingsGroupB - ensure it's initialized with defaults
    let FRET_MARKERS = JSON.parse(JSON.stringify(defaultSettingsGroupB.fretMarkers));

    // JavaScript-only settings (not CSS variables)
    let SHOW_FRET_INDICATORS = defaultSettingsGroupA.showFretIndicators;
    let FRETBOARD_BINDING_DISPLAY = defaultSettingsGroupB.fretboardBindingDisplay;

    // ============================================================================
    // CSS INJECTION FUNCTION
    // ============================================================================

    /**
     * Injects CSS file into the document head
     * @param {string} cssPath - Path to CSS file (optional, defaults to 'fretboard.css')
     * @returns {Promise} Promise that resolves when CSS is loaded
     */
    function injectCSS(cssPath) {
        cssPath = cssPath || 'fretboard.css';
        
        // Check if CSS is already injected
        const existingLink = document.querySelector(`link[href="${cssPath}"]`);
        if (existingLink) {
            // CSS already loaded, process marker variables immediately
            processMarkerImageVariables();
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = cssPath;
            link.onload = () => {
                // Process CSS variables to convert marker values to empty strings
                processMarkerImageVariables();
                resolve();
            };
            link.onerror = () => {
                // Even on error, process variables in case CSS was already loaded
                processMarkerImageVariables();
                resolve();
            };
            document.head.appendChild(link);
            
            // Fallback: process variables after a short delay in case onload doesn't fire (cached CSS)
            setTimeout(() => {
                processMarkerImageVariables();
            }, 10);
        });
    }

    /**
     * Processes CSS variables to convert marker values ("no-image", "no-dot-image") to "none"
     * This ensures proper CSS fallback behavior
     */
    function processMarkerImageVariables() {
        const markerImageVars = [
            '--marker-dot-background-image',
            '--fingerboard-row-0-image',
            '--fret-divider-image',
            '--nut-divider-image',
            '--fretbinding-background-image'
        ];
        
        markerImageVars.forEach(varName => {
            const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
            if (value === 'no-image' || value === 'no-dot-image' || value === '') {
                document.documentElement.style.setProperty(varName, 'none');
            }
        });
    }

    // ============================================================================
    // HTML GENERATION FUNCTION
    // ============================================================================

    // Helper function to generate instance-specific element IDs
    function getInstanceElementId(fretboardId, baseId) {
        return `${fretboardId}_${baseId}`;
    }

    /**
     * Generates all HTML structure for the fretboard
     * @param {string} targetContainerId - ID of container element
     * @param {string} fretboardId - Unique ID for this fretboard instance
     */
    function generateHTMLStructure(targetContainerId, fretboardId) {
        const container = document.getElementById(targetContainerId);
        if (!container) {
            console.error(`Container element with id "${targetContainerId}" not found`);
            return false;
        }

        // Clear container
        container.innerHTML = '';

        // Create templates
        const dotTemplate = document.createElement('div');
        dotTemplate.id = getInstanceElementId(fretboardId, 'dot_template');
        dotTemplate.style.display = 'none';
        dotTemplate.innerHTML = `
            <div class="fingering_dot_design">
                <div class="dot_outer_circle"></div>
                <div class="dot_inner_circle"></div>
                <div class="dot_text">1</div>
                <div class="interval_indicator_label">b5</div>
            </div>
        `;

        const hoverDotTemplate = document.createElement('div');
        hoverDotTemplate.id = getInstanceElementId(fretboardId, 'hover_dot_template');
        hoverDotTemplate.style.display = 'none';
        hoverDotTemplate.innerHTML = `
            <div class="fingering_dot_hover_design">
                <div class="dot_hover_outer_circle"></div>
                <div class="dot_hover_inner_circle"></div>
                <div class="dot_hover_text"></div>
            </div>
        `;

        const unplayedDotTemplate = document.createElement('div');
        unplayedDotTemplate.id = getInstanceElementId(fretboardId, 'unplayed_dot_template');
        unplayedDotTemplate.style.display = 'none';
        unplayedDotTemplate.innerHTML = `
            <div class="fingering_dot_unplayed_design">
                <div class="dot_unplayed_outer_circle"></div>
                <div class="dot_unplayed_x">✕</div>
            </div>
        `;

        // Create wrapper
        const wrapper = document.createElement('div');
        wrapper.id = getInstanceElementId(fretboardId, 'chord_builder_wrapper');

        // Create header
        const header = document.createElement('div');
        header.id = getInstanceElementId(fretboardId, 'chord_fretboard_header');
        header.className = 'chord_builder_fret_row_wrapper';

        // Create fret 0
        const fret0 = document.createElement('div');
        fret0.id = getInstanceElementId(fretboardId, 'chord_builder_fret_row_wrapper_0');
        fret0.className = 'chord_builder_fret_row_wrapper';

        // Create nut
        const nut = document.createElement('div');
        nut.id = getInstanceElementId(fretboardId, 'chord_builder_nut');
        nut.className = 'chord_builder_fret_row_wrapper fretrow_non_interactive';

        // Create break row
        const breakRow = document.createElement('div');
        breakRow.id = getInstanceElementId(fretboardId, 'fretboard_break_row');
        // text-align is set in CSS, no need for inline style

        // Append to container
        container.appendChild(dotTemplate);
        container.appendChild(hoverDotTemplate);
        container.appendChild(unplayedDotTemplate);
        container.appendChild(wrapper);
        wrapper.appendChild(header);
        wrapper.appendChild(fret0);
        wrapper.appendChild(nut);
        wrapper.appendChild(breakRow);

        return true;
    }

    // ============================================================================
    // HELPER FUNCTIONS (Preserved from original)
    // ============================================================================

    function getNoteAtFret(stringIndex, fret) {
        const openNote = TUNING[stringIndex];
        if (!openNote) return null;
        const openNoteIndex = CHROMATIC_SCALE.indexOf(openNote);
        const noteIndex = (openNoteIndex + fret) % 12;
        return CHROMATIC_SCALE[noteIndex];
    }

    function getStringNote(stringIndex) {
        return TUNING[stringIndex] || null;
    }

    function getInterval(rootNote, currentNote, fretDistance = null) {
        const rootIndex = CHROMATIC_SCALE.indexOf(rootNote);
        const currentIndex = CHROMATIC_SCALE.indexOf(currentNote);
        let semitones = (currentIndex - rootIndex + 12) % 12;
        
        if (fretDistance !== null && fretDistance > 12) {
            semitones = fretDistance % 12;
            const intervalMap = {
                0: '8', 1: 'b9', 2: '9', 3: '#9', 4: '11', 5: '11',
                6: '#11', 7: '5', 8: 'b6', 9: '6', 10: 'b7', 11: '7'
            };
            return intervalMap[semitones];
        }
        
        const intervalMap = {
            0: 'R', 1: 'b2', 2: '2', 3: 'b3', 4: '3', 5: '4',
            6: 'b5', 7: '5', 8: 'b6', 9: '6', 10: 'b7', 11: '7'
        };
        
        return intervalMap[semitones];
    }

    function updateAllDotText(fretboardId = null) {
        let activeDots;
        
        if (fretboardId) {
            // Update dots only for specific fretboard instance
            const wrapper = document.getElementById(getInstanceElementId(fretboardId, 'chord_builder_wrapper'));
            if (wrapper) {
                activeDots = wrapper.querySelectorAll('.fingering_dot.active');
            } else {
                activeDots = [];
            }
        } else {
            // Update all dots across all instances
            activeDots = document.querySelectorAll('.fingering_dot.active');
        }
        
        activeDots.forEach(dot => {
            const dotText = dot.querySelector('.dot_text');
            if (dotText) {
                if (DOT_TEXT_MODE === 'note') {
                    let note = dotText.getAttribute('data-note');
                    // If data-note is missing, try to recalculate it from the dot's position
                    // Use the exact same logic as updateDotContent function
                    if (!note) {
                        const fretRow = dot.closest('.chord_builder_fret_row_wrapper');
                        if (fretRow) {
                            // Extract fret number using the same pattern as getFingeringFromDotState
                            // This handles both prefixed and non-prefixed IDs
                            let fret = 0;
                            const fretMatchWithPrefix = fretRow.id.match(/^.+_chord_builder_fret_row_wrapper_(\d+)$/);
                            if (fretMatchWithPrefix) {
                                fret = parseInt(fretMatchWithPrefix[1]);
                            } else {
                                // Try without prefix (backward compatibility)
                                const fretMatchNoPrefix = fretRow.id.match(/^chord_builder_fret_row_wrapper_(\d+)$/);
                                if (fretMatchNoPrefix) {
                                    fret = parseInt(fretMatchNoPrefix[1]);
                                }
                            }
                            
                            // Get string index from wrapper position (same as updateDotContent)
                            const wrapper = dot.closest('.fingerboard_piece_wrapper');
                            if (wrapper && fretRow) {
                                const allWrappers = fretRow.querySelectorAll('.fingerboard_piece_wrapper');
                                const stringIndex = Array.from(allWrappers).indexOf(wrapper) + 1; // 1-based
                                
                                if (stringIndex > 0) {
                                    // Use the exact same getNoteAtFret function that updateDotContent uses
                                    // This uses the global TUNING which should be updated from settingsGroupA.tuning
                                    note = getNoteAtFret(stringIndex, fret);
                                    if (note) {
                                        dotText.setAttribute('data-note', note);
                                    }
                                }
                            }
                        }
                    }
                    if (note) {
                        dotText.textContent = note;
                    }
                } else {
                    const finger = dotText.getAttribute('data-finger');
                    if (finger) {
                        dotText.textContent = finger;
                    } else {
                        // If no finger data, show empty
                        dotText.textContent = '';
                    }
                }
            }
        });
    }

    function updateAllIntervals() {
        if (!CURRENT_CHORD_ROOT) {
            // Hide all interval labels when there's no chord root
            const allIntervalLabels = document.querySelectorAll('.interval_indicator_label');
            allIntervalLabels.forEach(label => {
                label.style.display = 'none';
                label.textContent = '';
                label.removeAttribute('data-interval');
                label.classList.remove('active');
            });
            return;
        }
        
        const activeDots = document.querySelectorAll('.fingering_dot.active');
        activeDots.forEach(dot => {
            const dotText = dot.querySelector('.dot_text');
            const intervalLabel = dot.querySelector('.interval_indicator_label');
            
            if (dotText && intervalLabel) {
                const note = dotText.getAttribute('data-note');
                if (note) {
                    const fretRow = dot.closest('.chord_builder_fret_row_wrapper');
                    const fretMatch = fretRow.id.match(/\d+/);
                    const fret = fretMatch ? parseInt(fretMatch[0]) : 0;
                    
                    const interval = getInterval(CURRENT_CHORD_ROOT, note, fret);
                    intervalLabel.textContent = interval;
                    intervalLabel.setAttribute('data-interval', interval);
                    intervalLabel.style.display = 'flex'; // Show interval label
                    intervalLabel.classList.add('active');
                } else {
                    // Hide if no note
                    intervalLabel.style.display = 'none';
                    intervalLabel.textContent = '';
                    intervalLabel.removeAttribute('data-interval');
                    intervalLabel.classList.remove('active');
                }
            }
        });
        
        // Hide interval labels on inactive dots
        const inactiveDots = document.querySelectorAll('.fingering_dot:not(.active)');
        inactiveDots.forEach(dot => {
            const intervalLabel = dot.querySelector('.interval_indicator_label');
            if (intervalLabel) {
                intervalLabel.style.display = 'none';
                intervalLabel.textContent = '';
                intervalLabel.removeAttribute('data-interval');
                intervalLabel.classList.remove('active');
            }
        });
    }

    function saveDotState(fretboardId = null) {
        PERSISTENT_DOT_STATE = [];
        
        // If fretboardId is provided, only query within that fretboard's wrapper
        let allFretRows;
        if (fretboardId) {
            const wrapper = document.getElementById(getInstanceElementId(fretboardId, 'chord_builder_wrapper'));
            if (wrapper) {
                allFretRows = wrapper.querySelectorAll('.chord_builder_fret_row_wrapper');
            } else {
                allFretRows = [];
            }
        } else {
            // Fallback: query all fret rows (for backward compatibility)
            allFretRows = document.querySelectorAll('.chord_builder_fret_row_wrapper');
        }
        
        allFretRows.forEach(fretRow => {
            // Extract fret number from ID - handle both prefixed and non-prefixed IDs
            let fret = null;
            // Try matching with prefix first (most common case)
            const fretMatchWithPrefix = fretRow.id.match(/^.+_chord_builder_fret_row_wrapper_(\d+)$/);
            if (fretMatchWithPrefix) {
                fret = parseInt(fretMatchWithPrefix[1]);
            } else {
                // Try without prefix (backward compatibility)
                const fretMatchNoPrefix = fretRow.id.match(/^chord_builder_fret_row_wrapper_(\d+)$/);
                if (fretMatchNoPrefix) {
                    fret = parseInt(fretMatchNoPrefix[1]);
                } else {
                    // Fallback: try to find any number (less reliable)
                    const fretMatchFallback = fretRow.id.match(/\d+/);
                    if (fretMatchFallback) {
                        fret = parseInt(fretMatchFallback[0]);
                    }
                }
            }
            
            if (fret === null || isNaN(fret)) return;
            
            const wrappers = fretRow.querySelectorAll('.fingerboard_piece_wrapper');
            wrappers.forEach((wrapper, arrayIndex) => {
                // Convert 0-based array index to 1-based string number
                const stringNumber = arrayIndex + 1;
                
                const dot = wrapper.querySelector('.fingering_dot.active');
                const unplayedDot = wrapper.querySelector('.fingering_dot_unplayed.active');
                
                if (dot) {
                    const dotText = dot.querySelector('.dot_text');
                    const intervalLabel = dot.querySelector('.interval_indicator_label');
                    PERSISTENT_DOT_STATE.push({
                        fret: fret,
                        string: stringNumber,
                        type: 'dot',
                        text: dotText ? dotText.textContent : '',
                        noteData: dotText ? dotText.getAttribute('data-note') : '',
                        fingerData: dotText ? dotText.getAttribute('data-finger') : '',
                        interval: intervalLabel ? intervalLabel.textContent : '',
                        intervalAttr: intervalLabel ? intervalLabel.getAttribute('data-interval') : '',
                        intervalColor: intervalLabel ? intervalLabel.style.backgroundColor : '',
                        intervalActive: intervalLabel ? intervalLabel.classList.contains('active') : false
                    });
                } else if (unplayedDot) {
                    // Save unplayed dots on fret 0 as fret: -1 for fingering data structure
                    PERSISTENT_DOT_STATE.push({
                        fret: fret === 0 ? -1 : fret,
                        string: stringNumber,
                        type: 'unplayed'
                    });
                }
            });
        });
    }
    
    /**
     * Converts PERSISTENT_DOT_STATE to fingering array format
     * Unplayed dots on fret 0 are saved as { string: X, fret: -1, finger: 0 }
     * @param {string} [fretboardId] - Optional fretboard ID to read from DOM directly
     * @returns {Array} Fingering array
     */
    function getFingeringFromDotState(fretboardId = null) {
        const fingering = [];
        
        // If fretboardId is provided, read directly from DOM for accuracy
        if (fretboardId) {
            const wrapper = document.getElementById(getInstanceElementId(fretboardId, 'chord_builder_wrapper'));
            if (wrapper) {
                const allFretRows = wrapper.querySelectorAll('.chord_builder_fret_row_wrapper');
                allFretRows.forEach(fretRow => {
                    // Skip header, nut, and break row - they don't represent actual frets
                    if (!fretRow.id) return;
                    if (fretRow.id.includes('chord_fretboard_header') || 
                        fretRow.id.includes('chord_builder_nut') || 
                        fretRow.id.includes('fretboard_break_row')) {
                        return;
                    }
                    
                    // Extract fret number from the ID - this is the most reliable source
                    // IDs are like: {fretboardId}_chord_builder_fret_row_wrapper_{fretNumber}
                    // Match the pattern - can have prefix or not
                    let fret = null;
                    // Try matching with prefix first (most common case)
                    const fretMatchWithPrefix = fretRow.id.match(/^.+_chord_builder_fret_row_wrapper_(\d+)$/);
                    if (fretMatchWithPrefix) {
                        fret = parseInt(fretMatchWithPrefix[1]);
                    } else {
                        // Try without prefix (backward compatibility)
                        const fretMatchNoPrefix = fretRow.id.match(/^chord_builder_fret_row_wrapper_(\d+)$/);
                        if (fretMatchNoPrefix) {
                            fret = parseInt(fretMatchNoPrefix[1]);
                        }
                    }
                    
                    if (fret === null || isNaN(fret)) {
                        // Skip if we can't determine the fret number from ID
                        return;
                    }
                    
                    const wrappers = fretRow.querySelectorAll('.fingerboard_piece_wrapper');
                    wrappers.forEach((wrapper, arrayIndex) => {
                        // Convert 0-based array index to 1-based string number
                        const stringNumber = arrayIndex + 1;
                        
                        const dot = wrapper.querySelector('.fingering_dot.active');
                        const unplayedDot = wrapper.querySelector('.fingering_dot_unplayed.active');
                        
                        if (dot) {
                            // Only include dots that are actually active
                            const dotText = dot.querySelector('.dot_text');
                            const fingerData = dotText ? dotText.getAttribute('data-finger') : '';
                            const finger = fingerData ? parseInt(fingerData) : 0;
                            
                            // Validate fret number (should be >= 0, or -1 for unplayed)
                            if (fret !== null && !isNaN(fret) && fret >= 0) {
                                fingering.push({
                                    string: stringNumber,
                                    fret: fret,
                                    finger: finger
                                });
                            }
                        } else if (unplayedDot && fret === 0) {
                            // Unplayed dots on fret 0 are saved as fret: -1
                            fingering.push({
                                string: stringNumber,
                                fret: -1,
                                finger: 0
                            });
                        }
                    });
                });
            }
        } else {
            // Fallback to PERSISTENT_DOT_STATE for backward compatibility
            PERSISTENT_DOT_STATE.forEach(state => {
                if (state.type === 'dot') {
                    const finger = state.fingerData ? parseInt(state.fingerData) : 0;
                    fingering.push({
                        string: state.string,
                        fret: state.fret,
                        finger: finger
                    });
                } else if (state.type === 'unplayed') {
                    // Unplayed dots are saved as fret: -1
                    fingering.push({
                        string: state.string,
                        fret: -1,
                        finger: 0
                    });
                }
            });
        }
        
        return fingering;
    }

    function restoreDotState(fretboardId = null) {
        // If fretboardId not provided, try to find it
        if (!fretboardId) {
            const anyWrapper = document.querySelector('[id$="_chord_builder_wrapper"]');
            if (anyWrapper && anyWrapper.id) {
                const match = anyWrapper.id.match(/^(.+)_chord_builder_wrapper$/);
                if (match) fretboardId = match[1];
            }
        }
        
        if (!fretboardId) {
            console.warn('restoreDotState: Could not determine fretboardId');
            return;
        }
        
        PERSISTENT_DOT_STATE.forEach(state => {
            
            const fretRow = document.getElementById(getInstanceElementId(fretboardId, `chord_builder_fret_row_wrapper_${state.fret}`));
            if (!fretRow) return;
            
            // Convert 1-based string number to 0-based array index
            const arrayIndex = state.string - 1;
            const wrappers = fretRow.querySelectorAll('.fingerboard_piece_wrapper');
            const wrapper = wrappers[arrayIndex];
            if (!wrapper) return;
            
            if (state.type === 'dot') {
                const dot = wrapper.querySelector('.fingering_dot');
                if (dot) {
                    dot.classList.add('active');
                    
                    const dotText = dot.querySelector('.dot_text');
                    if (dotText) {
                        dotText.textContent = state.text;
                        if (state.noteData) dotText.setAttribute('data-note', state.noteData);
                        if (state.fingerData) dotText.setAttribute('data-finger', state.fingerData);
                    }
                    
                    const intervalLabel = dot.querySelector('.interval_indicator_label');
                    if (intervalLabel && state.interval) {
                        intervalLabel.textContent = state.interval;
                        if (state.intervalActive) intervalLabel.classList.add('active');
                        if (state.intervalAttr) intervalLabel.setAttribute('data-interval', state.intervalAttr);
                        if (state.intervalColor) intervalLabel.style.backgroundColor = state.intervalColor;
                    }
                }
            } else if (state.type === 'unplayed') {
                const unplayedDot = wrapper.querySelector('.fingering_dot_unplayed');
                if (unplayedDot) {
                    unplayedDot.classList.add('active');
                }
            }
        });
    }

    function updateFretboardBreakRow(fretboardId = null) {
        // If fretboardId not provided, try to find it
        if (!fretboardId) {
            const anyBreakRow = document.querySelector('[id$="_fretboard_break_row"]');
            if (anyBreakRow && anyBreakRow.id) {
                const match = anyBreakRow.id.match(/^(.+)_fretboard_break_row$/);
                if (match) fretboardId = match[1];
            }
        }
        
        if (!fretboardId) {
            console.warn('updateFretboardBreakRow: Could not determine fretboardId');
            return;
        }
        
        const breakRow = document.getElementById(getInstanceElementId(fretboardId, 'fretboard_break_row'));
        if (!breakRow) return;
        
        const startFret = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--start-fret')) || 1;
        const numStrings = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--num-strings')) || 6;
        
        if (startFret === 1) {
            breakRow.style.display = 'none';
            breakRow.innerHTML = '';
            return;
        }
        
        breakRow.style.display = '';
        
        const hiddenFrets = startFret - 1;
        const fretWord = hiddenFrets === 1 ? 'fret' : 'frets';
        let breakHTML = `
            <div class="chord_builder_fret_indicator"></div>
            <div class="fretboard_binding break_binding"></div>
            <div class="chord_builder_fretboard_row break_row">
                <div class="break_row_overlay"><div class="break_row_text">Hiding ${hiddenFrets} ${fretWord}</div></div>
                <div class="strings_container">`;
        
        for (let i = 1; i <= numStrings; i++) {
            const stringClass = `string_${i}`;
            if (STRING_TYPE === '2') {
                breakHTML += `
                    <div class="fingerboard_piece_wrapper">
                        <div class="fingerboard_piece"></div>
                        <div class="${stringClass}"></div>
                        <div class="fingerboard_piece_middle"></div>
                        <div class="${stringClass} fingerboard_second_string"></div>
                        <div class="fingerboard_piece"></div>
                    </div>`;
            } else {
                breakHTML += `
                    <div class="fingerboard_piece_wrapper">
                        <div class="fingerboard_piece"></div>
                        <div class="${stringClass}"></div>
                        <div class="fingerboard_piece"></div>
                    </div>`;
            }
        }
        
        breakHTML += `
                </div>
            </div>
            </div><div class="fretboard_binding break_binding"></div>`;
        
        breakRow.innerHTML = breakHTML;
        
        // Apply binding display setting to break row bindings (same as all other bindings)
        const breakBindings = breakRow.querySelectorAll('.break_binding');
        const displayValue = FRETBOARD_BINDING_DISPLAY ? 'block' : 'none';
        breakBindings.forEach(binding => {
            binding.style.display = displayValue;
        });
    }

    // Helper to get fretboardId from container element or find it
    function getFretboardIdFromContainer(containerElement) {
        if (containerElement && containerElement.dataset.fretboardId) {
            return containerElement.dataset.fretboardId;
        }
        // Try to find by looking for the wrapper
        const wrapper = containerElement ? containerElement.querySelector('[id$="_chord_builder_wrapper"]') : null;
        if (wrapper && wrapper.id) {
            const match = wrapper.id.match(/^(.+)_chord_builder_wrapper$/);
            if (match) return match[1];
        }
        return null;
    }

    function generateFretRows(forceRegenerate = false, fretboardId = null) {
        // If fretboardId not provided, try to find it
        if (!fretboardId) {
            // Try to find from any existing wrapper
            const anyWrapper = document.querySelector('[id$="_chord_builder_wrapper"]');
            if (anyWrapper && anyWrapper.id) {
                const match = anyWrapper.id.match(/^(.+)_chord_builder_wrapper$/);
                if (match) fretboardId = match[1];
            }
        }
        
        if (!fretboardId) {
            console.warn('generateFretRows: Could not determine fretboardId');
            return;
        }
        
        const chordBuilderWrapper = document.getElementById(getInstanceElementId(fretboardId, 'chord_builder_wrapper'));
        if (!chordBuilderWrapper) return;
        
        const startFret = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--start-fret')) || START_FRET;
        const numFrets = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--num-frets')) || 4;
        
        const existingFrets = chordBuilderWrapper.querySelectorAll(`[id^="${getInstanceElementId(fretboardId, 'chord_builder_fret_row_wrapper_')}"]:not(#${getInstanceElementId(fretboardId, 'chord_builder_fret_row_wrapper_0')})`);
        
        if (forceRegenerate && existingFrets.length > 0) {
            existingFrets.forEach(fret => fret.remove());
        }
        
        if (existingFrets.length > 0 && !forceRegenerate) {
            existingFrets.forEach(fret => {
                fret.classList.remove('first-visible-fret', 'last-visible-fret');
                fret.style.display = 'none';
            });
            
            let firstVisibleFret = null;
            let lastVisibleFret = null;
            
            for (let i = startFret; i < startFret + numFrets; i++) {
                if (i < 1 || i > 24) continue;
                const fretRow = document.getElementById(getInstanceElementId(fretboardId, `chord_builder_fret_row_wrapper_${i}`));
                if (fretRow) {
                    fretRow.style.display = '';
                    if (!firstVisibleFret) firstVisibleFret = fretRow;
                    lastVisibleFret = fretRow;
                }
            }
            
            if (firstVisibleFret) firstVisibleFret.classList.add('first-visible-fret');
            if (lastVisibleFret) lastVisibleFret.classList.add('last-visible-fret');
            
            // Apply fret indicator visibility and binding display settings
            applyFretIndicatorVisibility(fretboardId);
            applyFretboardBindingDisplay(fretboardId);
            
            updateFretboardBreakRow(fretboardId);
            return;
        }
        
        for (let i = 1; i <= 24; i++) {
            if (i < 1 || i > 24) continue;
            
            const fretRow = document.createElement('div');
            fretRow.id = getInstanceElementId(fretboardId, `chord_builder_fret_row_wrapper_${i}`);
            fretRow.className = 'chord_builder_fret_row_wrapper';
            
            const numStringsVar = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--num-strings')) || 6;
            const numStrings = Math.min(numStringsVar, 10);
            
            const generateStringWrapper = (stringIndex) => {
                const stringClass = `string_${stringIndex}`;
                
                if (STRING_TYPE === '2') {
                    return `
                        <div class="fingerboard_piece_wrapper">
                            <div class="fingerboard_piece"></div>
                            <div class="${stringClass}"></div>
                            <div class="fingerboard_piece_middle"></div>
                            <div class="${stringClass} fingerboard_second_string"></div>
                            <div class="fingerboard_piece"></div>
                            <div class="fingering_dot_hover">
                                <div class="fingering_dot_hover_design">
                                    <div class="dot_hover_outer_circle"></div>
                                    <div class="dot_hover_inner_circle"></div>
                                    <div class="dot_hover_text"></div>
                                </div>
                            </div>
                            <div class="fingering_dot">
                                <div class="fingering_dot_design">
                                    <div class="dot_outer_circle"></div>
                                    <div class="dot_inner_circle"></div>
                                    <div class="dot_text">1</div>
                                    <div class="interval_indicator_label">b5</div>
                                </div>
                            </div>
                            <div class="fingering_dot_unplayed">
                                <div class="fingering_dot_unplayed_design">
                                    <div class="dot_unplayed_outer_circle"></div>
                                    <div class="dot_unplayed_x">✕</div>
                                </div>
                            </div>
                        </div>`;
                } else {
                    return `
                        <div class="fingerboard_piece_wrapper">
                            <div class="fingerboard_piece"></div>
                            <div class="${stringClass}"></div>
                            <div class="fingerboard_piece"></div>
                            <div class="fingering_dot_hover">
                                <div class="fingering_dot_hover_design">
                                    <div class="dot_hover_outer_circle"></div>
                                    <div class="dot_hover_inner_circle"></div>
                                    <div class="dot_hover_text"></div>
                                </div>
                            </div>
                            <div class="fingering_dot">
                                <div class="fingering_dot_design">
                                    <div class="dot_outer_circle"></div>
                                    <div class="dot_inner_circle"></div>
                                    <div class="dot_text">1</div>
                                    <div class="interval_indicator_label">b5</div>
                                </div>
                            </div>
                            <div class="fingering_dot_unplayed">
                                <div class="fingering_dot_unplayed_design">
                                    <div class="dot_unplayed_outer_circle"></div>
                                    <div class="dot_unplayed_x">✕</div>
                                </div>
                            </div>
                        </div>`;
                }
            };
            
            let stringsHTML = '';
            for (let s = 1; s <= numStrings; s++) {
                stringsHTML += generateStringWrapper(s);
            }
            
            let fretDividerStringsHTML = '';
            for (let s = 1; s <= numStrings; s++) {
                const stringClass = `string_${s}`;
                if (STRING_TYPE === '2') {
                    fretDividerStringsHTML += `
                        <div class="fingerboard_piece_wrapper">
                            <div class="fingerboard_piece"></div>
                            <div class="${stringClass}"></div>
                            <div class="fingerboard_piece_middle"></div>
                            <div class="${stringClass} fingerboard_second_string"></div>
                            <div class="fingerboard_piece"></div>
                        </div>`;
                } else {
                    fretDividerStringsHTML += `
                        <div class="fingerboard_piece_wrapper">
                            <div class="fingerboard_piece"></div>
                            <div class="${stringClass}"></div>
                            <div class="fingerboard_piece"></div>
                        </div>`;
                }
            }
            
            // Check for fret position markers
            const markerType = FRET_MARKERS && FRET_MARKERS[i];
            let markerHTML = '';
            if (markerType === 'single') {
                markerHTML = '<div class="fret_position_marker"><div class="marker_dot"></div></div>';
            } else if (markerType === 'double') {
                markerHTML = '<div class="fret_position_marker double"><div class="marker_dot"></div><div class="marker_dot"></div></div>';
            }
            
            fretRow.innerHTML = `
                <div class="chord_builder_fret_indicator"><div class="fret_indicator_content_wrapper">${i}</div></div>
                <div class="fretboard_binding fretboard_binding_fx binding_left"></div>
                <div class="chord_builder_fretboard_row">
                    ${markerHTML}
                    <div class="strings_container">
                        ${stringsHTML}
                    </div>
                    <div class="fret_divider">
                        <div class="fret_divider_overlay"></div>
                        <div class="strings_container">
                            ${fretDividerStringsHTML}
                        </div>
                    </div>
                </div>
                <div class="fretboard_binding fretboard_binding_fx binding_right"></div>
            `;
            
            chordBuilderWrapper.appendChild(fretRow);
            
            if (i < startFret || i >= startFret + numFrets) {
                fretRow.style.display = 'none';
            }
        }
        
        let firstVisibleFret = null;
        let lastVisibleFret = null;
        
        for (let i = startFret; i < startFret + numFrets; i++) {
            if (i < 1 || i > 24) continue;
            const fretRow = document.getElementById(getInstanceElementId(fretboardId, `chord_builder_fret_row_wrapper_${i}`));
            if (fretRow && fretRow.style.display !== 'none') {
                if (!firstVisibleFret) firstVisibleFret = fretRow;
                lastVisibleFret = fretRow;
            }
        }
        
        if (firstVisibleFret) firstVisibleFret.classList.add('first-visible-fret');
        if (lastVisibleFret) lastVisibleFret.classList.add('last-visible-fret');
        
        // Apply fret indicator visibility and binding display settings
        applyFretIndicatorVisibility(fretboardId);
        applyFretboardBindingDisplay(fretboardId);
        
        updateFretboardBreakRow(fretboardId);
    }

    /**
     * Updates only the fret position markers without regenerating the entire fret row
     * This preserves binding divs and other elements
     * @param {string} fretboardId - Optional fretboard ID
     */
    function updateFretMarkersOnly(fretboardId = null) {
        // If fretboardId not provided, try to find it
        if (!fretboardId) {
            const anyWrapper = document.querySelector('[id$="_chord_builder_wrapper"]');
            if (anyWrapper && anyWrapper.id) {
                const match = anyWrapper.id.match(/^(.+)_chord_builder_wrapper$/);
                if (match) fretboardId = match[1];
            }
        }
        
        if (!fretboardId) {
            console.warn('updateFretMarkersOnly: Could not determine fretboardId');
            return;
        }
        
        const chordBuilderWrapper = document.getElementById(getInstanceElementId(fretboardId, 'chord_builder_wrapper'));
        if (!chordBuilderWrapper) return;
        
        // Update markers for all fret rows (1-24)
        for (let i = 1; i <= 24; i++) {
            const fretRow = document.getElementById(getInstanceElementId(fretboardId, `chord_builder_fret_row_wrapper_${i}`));
            if (!fretRow) continue;
            
            // Find the fretboard row container
            const fretboardRow = fretRow.querySelector('.chord_builder_fretboard_row');
            if (!fretboardRow) continue;
            
            // Remove existing marker if any
            const existingMarker = fretboardRow.querySelector('.fret_position_marker');
            if (existingMarker) {
                existingMarker.remove();
            }
            
            // Add new marker if needed
            const markerType = FRET_MARKERS && FRET_MARKERS[i];
            if (markerType === 'single') {
                const markerDiv = document.createElement('div');
                markerDiv.className = 'fret_position_marker';
                const dotDiv = document.createElement('div');
                dotDiv.className = 'marker_dot';
                markerDiv.appendChild(dotDiv);
                // Insert at the beginning of the fretboard row (before strings_container)
                const stringsContainer = fretboardRow.querySelector('.strings_container');
                if (stringsContainer) {
                    fretboardRow.insertBefore(markerDiv, stringsContainer);
                } else {
                    fretboardRow.appendChild(markerDiv);
                }
            } else if (markerType === 'double') {
                const markerDiv = document.createElement('div');
                markerDiv.className = 'fret_position_marker double';
                const dot1 = document.createElement('div');
                dot1.className = 'marker_dot';
                const dot2 = document.createElement('div');
                dot2.className = 'marker_dot';
                markerDiv.appendChild(dot1);
                markerDiv.appendChild(dot2);
                // Insert at the beginning of the fretboard row (before strings_container)
                const stringsContainer = fretboardRow.querySelector('.strings_container');
                if (stringsContainer) {
                    fretboardRow.insertBefore(markerDiv, stringsContainer);
                } else {
                    fretboardRow.appendChild(markerDiv);
                }
            }
        }
    }

    function applyFretHeights(fretboardId = null) {
        // If fretboardId not provided, try to find it
        if (!fretboardId) {
            const anyWrapper = document.querySelector('[id$="_chord_builder_wrapper"]');
            if (anyWrapper && anyWrapper.id) {
                const match = anyWrapper.id.match(/^(.+)_chord_builder_wrapper$/);
                if (match) fretboardId = match[1];
            }
        }
        
        if (!fretboardId) {
            console.warn('applyFretHeights: Could not determine fretboardId');
            return;
        }
        
        const wrapperElement = document.getElementById(getInstanceElementId(fretboardId, 'chord_builder_wrapper'));
        if (!wrapperElement) return;
        
        // Use getBoundingClientRect for more reliable height calculation
        // This works even if computed style height isn't available yet
        const totalHeight = wrapperElement.getBoundingClientRect().height;
        
        // Fallback: if getBoundingClientRect returns 0, try computed style
        let actualHeight = totalHeight;
        if (actualHeight === 0 || isNaN(actualHeight)) {
            const computedStyle = getComputedStyle(wrapperElement);
            const computedHeight = parseFloat(computedStyle.height);
            if (!isNaN(computedHeight) && computedHeight > 0) {
                actualHeight = computedHeight;
            } else {
                // Last resort: calculate from viewport if using vh units
                const heightVar = getComputedStyle(document.documentElement).getPropertyValue('--fretboard-height').trim();
                if (heightVar && heightVar.includes('vh')) {
                    const vhValue = parseFloat(heightVar);
                    actualHeight = (window.innerHeight * vhValue) / 100;
                }
            }
        }
        
        // If we still don't have a valid height, wait and retry
        if (!actualHeight || isNaN(actualHeight) || actualHeight <= 0) {
            // Retry on next frame to allow layout to settle
            requestAnimationFrame(() => {
                applyFretHeights(fretboardId);
            });
            return;
        }
        
        const headerHeightStr = getComputedStyle(document.documentElement).getPropertyValue('--header-height').trim();
        const fret0HeightStr = getComputedStyle(document.documentElement).getPropertyValue('--fret-0-height').trim();
        
        const headerHeight = parseFloat(headerHeightStr) || 0;
        const fret0Height = parseFloat(fret0HeightStr) || 0;
        
        // Validate fret0Height - it should come from CSS source of truth
        if (isNaN(fret0Height) || fret0Height <= 0) {
            console.warn('Invalid --fret-0-height from CSS:', fret0HeightStr, 'Expected value from CSS source of truth');
            // Retry on next frame to allow CSS to load
            requestAnimationFrame(() => {
                applyFretHeights(fretboardId);
            });
            return;
        }
        
        const fretRatio = Math.pow(2, -1/12);
        
        const allFretRows = [];
        for (let i = 0; i <= 24; i++) {
            const fretRow = document.getElementById(getInstanceElementId(fretboardId, `chord_builder_fret_row_wrapper_${i}`));
            if (fretRow && !fretRow.closest('.fretrow_non_interactive') && fretRow.style.display !== 'none') {
                allFretRows.push({ element: fretRow, fretNumber: i });
            }
        }
        
        // Don't set --fret-0-height on the element - CSS is the source of truth
        // The CSS rule #chord_builder_fret_row_wrapper_0 { height: var(--fret-0-height); }
        // will use the value from :root automatically
        
        const availableHeight = actualHeight - headerHeight - fret0Height;
        
        // Safety check
        if (availableHeight <= 0 || isNaN(availableHeight)) {
            console.warn('Invalid available height for fret calculation:', availableHeight);
            return;
        }
        
        let ratioSum = 0;
        for (let i = 1; i < allFretRows.length; i++) {
            const fretNumber = allFretRows[i].fretNumber;
            ratioSum += Math.pow(fretRatio, fretNumber);
        }
        
        // Safety check
        if (ratioSum === 0 || isNaN(ratioSum)) {
            console.warn('Invalid ratio sum for fret calculation:', ratioSum);
            return;
        }
        
        const baseHeight = availableHeight / ratioSum;
        
        for (let i = 1; i < allFretRows.length; i++) {
            const fretNumber = allFretRows[i].fretNumber;
            const fretWrapper = allFretRows[i].element;
            
            const height = baseHeight * Math.pow(fretRatio, fretNumber);
            
            // Safety check before setting
            if (!isNaN(height) && height > 0) {
                // Use CSS variable instead of inline style
                fretWrapper.style.setProperty('--fret-row-height', `${height}px`);
            } else {
                console.warn(`Invalid height calculated for fret ${fretNumber}:`, height);
            }
        }
    }

    function applyHoverDotTemplate(fretboardId = null) {
        // If fretboardId not provided, try to find it
        if (!fretboardId) {
            const anyTemplate = document.querySelector('[id$="_hover_dot_template"]');
            if (anyTemplate && anyTemplate.id) {
                const match = anyTemplate.id.match(/^(.+)_hover_dot_template$/);
                if (match) fretboardId = match[1];
            }
        }
        
        if (!fretboardId) {
            console.warn('applyHoverDotTemplate: Could not determine fretboardId');
            return;
        }
        
        const hoverTemplate = document.getElementById(getInstanceElementId(fretboardId, 'hover_dot_template'));
        if (!hoverTemplate) return;
        
        const hoverDots = document.querySelectorAll('.fingering_dot_hover');
        
        hoverDots.forEach(hoverDot => {
            if (hoverDot.children.length === 0) {
                const clone = hoverTemplate.cloneNode(true);
                hoverDot.innerHTML = clone.innerHTML;
            }
        });
    }

    function updateDotContent(dot, fretRow, stringIndex) {
        // Extract fret number from the end of the ID (after 'chord_builder_fret_row_wrapper_')
        const fretMatch = fretRow.id.match(/chord_builder_fret_row_wrapper_(\d+)$/);
        const fret = fretMatch ? parseInt(fretMatch[1]) : 0;
        
        const note = getNoteAtFret(stringIndex, fret);
        
        const dotText = dot.querySelector('.dot_text');
        const intervalLabel = dot.querySelector('.interval_indicator_label');
        
        if (dotText && note) {
            dotText.setAttribute('data-note', note);
            
            if (DOT_TEXT_MODE === 'note') {
                dotText.textContent = note;
            } else {
                dotText.textContent = '';
            }
        }
        
        if (intervalLabel) {
            if (CURRENT_CHORD_ROOT && note) {
                const interval = getInterval(CURRENT_CHORD_ROOT, note, fret);
                intervalLabel.textContent = interval;
                intervalLabel.setAttribute('data-interval', interval);
                intervalLabel.style.backgroundColor = '';
                intervalLabel.style.display = 'flex'; // Show interval label
            } else {
                // Hide interval label when there's no chord
                intervalLabel.style.display = 'none';
                intervalLabel.textContent = '';
                intervalLabel.removeAttribute('data-interval');
            }
        }
    }

    function clearStringDots(stringNumber) {
        // Convert 1-based string number to 0-based array index
        const arrayIndex = stringNumber - 1;
        
        const allFretRows = document.querySelectorAll('.chord_builder_fret_row_wrapper');
        allFretRows.forEach(row => {
            if (row.classList.contains('fretrow_non_interactive')) return;
            
            const rowWrappers = row.querySelectorAll('.fingerboard_piece_wrapper');
            if (rowWrappers[arrayIndex]) {
                const existingDot = rowWrappers[arrayIndex].querySelector('.fingering_dot');
                const existingUnplayedDot = rowWrappers[arrayIndex].querySelector('.fingering_dot_unplayed');
                if (existingDot && existingDot.classList.contains('active')) {
                    existingDot.classList.add('removing');
                    setTimeout(() => {
                        existingDot.classList.remove('active', 'removing');
                    }, 200);
                }
                if (existingUnplayedDot && existingUnplayedDot.classList.contains('active')) {
                    existingUnplayedDot.classList.add('removing');
                    setTimeout(() => {
                        existingUnplayedDot.classList.remove('active', 'removing');
                    }, 200);
                }
            }
        });
    }

    function addDotInteractivity(fretboardId = null) {
        // If fretboardId not provided, try to find it
        if (!fretboardId) {
            const anyWrapper = document.querySelector('[id$="_chord_builder_wrapper"]');
            if (anyWrapper && anyWrapper.id) {
                const match = anyWrapper.id.match(/^(.+)_chord_builder_wrapper$/);
                if (match) fretboardId = match[1];
            }
        }
        
        if (!fretboardId) {
            console.warn('addDotInteractivity: Could not determine fretboardId');
            return;
        }
        
        const wrapper = document.getElementById(getInstanceElementId(fretboardId, 'chord_builder_wrapper'));
        if (!wrapper) return;
        
        if (wrapper._clickHandler) {
            wrapper.removeEventListener('click', wrapper._clickHandler);
        }
        
        const clickHandler = function(e) {
            const clickedWrapper = e.target.closest('.fingerboard_piece_wrapper');
            if (!clickedWrapper) return;
            
            if (clickedWrapper.closest('.fretrow_non_interactive')) {
                return;
            }
            
            (function() {
                const wrapper = clickedWrapper;
                const dot = wrapper.querySelector('.fingering_dot');
                const unplayedDot = wrapper.querySelector('.fingering_dot_unplayed');
                const fretRow = wrapper.closest('.chord_builder_fret_row_wrapper');
                const isFretZero = fretRow && (fretRow.id === getInstanceElementId(fretboardId, 'chord_builder_fret_row_wrapper_0') || fretRow.id.endsWith('_chord_builder_fret_row_wrapper_0'));
                
                const allWrappers = fretRow.querySelectorAll('.fingerboard_piece_wrapper');
                const arrayIndex = Array.from(allWrappers).indexOf(wrapper);
                // Convert 0-based array index to 1-based string number
                const stringNumber = arrayIndex + 1;
                
                // Check if click was directly on unplayed dot (on fret 0 only)
                const clickedUnplayedDot = e.target.closest('.fingering_dot_unplayed');
                
                if (isFretZero && unplayedDot) {
                    const dotActive = dot && dot.classList.contains('active');
                    const unplayedActive = unplayedDot.classList.contains('active');
                    
                    if (clickedUnplayedDot) {
                        // Clicked directly on unplayed dot
                        if (!unplayedActive) {
                            if (dotActive) {
                                dot.classList.add('removing');
                                setTimeout(() => {
                                    dot.classList.remove('active', 'removing');
                                }, 200);
                            }
                            clearStringDots(stringNumber);
                            unplayedDot.classList.add('active');
                        } else {
                            unplayedDot.classList.add('removing');
                            setTimeout(() => {
                                unplayedDot.classList.remove('active', 'removing');
                            }, 200);
                        }
                    } else if (dot) {
                        // Clicked on regular dot area
                        if (!dotActive && !unplayedActive) {
                            clearStringDots(stringNumber);
                            dot.classList.add('active');
                            updateDotContent(dot, fretRow, stringNumber);
                        } else if (dotActive && !unplayedActive) {
                            dot.classList.add('removing');
                            setTimeout(() => {
                                dot.classList.remove('active', 'removing');
                            }, 200);
                            unplayedDot.classList.add('active');
                        } else if (!dotActive && unplayedActive) {
                            unplayedDot.classList.add('removing');
                            setTimeout(() => {
                                unplayedDot.classList.remove('active', 'removing');
                            }, 200);
                        }
                    }
                } else if (dot) {
                    // Not fret 0 - only handle regular dots
                    const wasActive = dot.classList.contains('active');
                    
                    if (!wasActive) {
                        clearStringDots(stringNumber);
                        dot.classList.add('active');
                        updateDotContent(dot, fretRow, stringNumber);
                    } else {
                        dot.classList.add('removing');
                        setTimeout(() => {
                            dot.classList.remove('active', 'removing');
                        }, 200);
                    }
                }
                
                saveDotState(fretboardId);
                
                // Update control panel if it exists
                if (window.FretboardControlPanel && window.FretboardControlPanel.updateFromFretboard) {
                    try {
                        window.FretboardControlPanel.updateFromFretboard(fretboardId);
                    } catch (e) {
                        // Fail gracefully if panel update fails
                        console.debug('Control panel update failed (this is OK if no panel exists):', e);
                    }
                }
            })();
        };
        
        wrapper._clickHandler = clickHandler;
        wrapper.addEventListener('click', clickHandler);
    }

    function initializeDynamicStrings(fretboardId = null) {
        const numStrings = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--num-strings')) || 6;
        
        // Try to get fretboardId if not provided
        let detectedFretboardId = fretboardId;
        if (!detectedFretboardId) {
            // Try to get fretboardId from any wrapper
            const wrapperForStrings = document.querySelector('[id$="_chord_builder_wrapper"]');
            if (wrapperForStrings && wrapperForStrings.id) {
                const match = wrapperForStrings.id.match(/^(.+)_chord_builder_wrapper$/);
                if (match) detectedFretboardId = match[1];
            }
        }
        
        if (!detectedFretboardId) {
            console.warn('initializeDynamicStrings: Could not determine fretboardId');
            return;
        }
        
        const header = document.getElementById(getInstanceElementId(detectedFretboardId, 'chord_fretboard_header'));
        if (header) {
            let headerHTML = `
                <div class="chord_builder_fret_indicator"></div>
                <div class="fretboard_binding"></div>
                <div class="chord_builder_fretboard_row tuning_header_row">
                    <div class="strings_container">`;
            
            for (let i = 1; i <= numStrings; i++) {
                const tuningNote = TUNING[i] || '';
                headerHTML += `
                        <div class="fingerboard_piece_wrapper">
                            <div class="tuning_label">${tuningNote}</div>
                        </div>`;
            }
            
            headerHTML += `
                    </div>
                </div>
                <div class="fretboard_binding"></div>`;
            
            header.innerHTML = headerHTML;
        }
        
        const fret0 = document.getElementById(getInstanceElementId(detectedFretboardId, 'chord_builder_fret_row_wrapper_0'));
        if (fret0) {
            let fret0HTML = `
                <div class="chord_builder_fret_indicator"><div class="fret_indicator_content_wrapper">0</div></div>
                <div class="fretboard_binding fretboard_binding_fx binding_0_fret_left"></div>
                <div class="chord_builder_fretboard_row">
                    <div class="strings_container">`;
            
            for (let i = 1; i <= numStrings; i++) {
                const stringClass = `string_${i}`;
                const tuningNote = TUNING[i] || '';
                if (STRING_TYPE === '2') {
                    fret0HTML += `
                        <div class="fingerboard_piece_wrapper">
                            <div class="fingerboard_piece"></div>
                            <div class="${stringClass}"></div>
                            <div class="fingerboard_piece_middle"></div>
                            <div class="${stringClass} fingerboard_second_string"></div>
                            <div class="fingerboard_piece"></div>
                            <div class="fingering_dot_hover">
                                <div class="fingering_dot_hover_design">
                                    <div class="dot_hover_outer_circle"></div>
                                    <div class="dot_hover_inner_circle"></div>
                                    <div class="dot_hover_text"></div>
                                </div>
                            </div>
                            <div class="fingering_dot">
                                <div class="fingering_dot_design">
                                    <div class="dot_outer_circle"></div>
                                    <div class="dot_inner_circle"></div>
                                    <div class="dot_text">${tuningNote}</div>
                                    <div class="interval_indicator_label">b5</div>
                                </div>
                            </div>
                            <div class="fingering_dot_unplayed">
                                <div class="fingering_dot_unplayed_design">
                                    <div class="dot_unplayed_outer_circle"></div>
                                    <div class="dot_unplayed_x">✕</div>
                                </div>
                            </div>
                        </div>`;
                } else {
                    fret0HTML += `
                        <div class="fingerboard_piece_wrapper">
                            <div class="fingerboard_piece"></div>
                            <div class="${stringClass}"></div>
                            <div class="fingerboard_piece"></div>
                            <div class="fingering_dot_hover">
                                <div class="fingering_dot_hover_design">
                                    <div class="dot_hover_outer_circle"></div>
                                    <div class="dot_hover_inner_circle"></div>
                                    <div class="dot_hover_text"></div>
                                </div>
                            </div>
                            <div class="fingering_dot">
                                <div class="fingering_dot_design">
                                    <div class="dot_outer_circle"></div>
                                    <div class="dot_inner_circle"></div>
                                    <div class="dot_text">${tuningNote}</div>
                                    <div class="interval_indicator_label">b5</div>
                                </div>
                            </div>
                            <div class="fingering_dot_unplayed">
                                <div class="fingering_dot_unplayed_design">
                                    <div class="dot_unplayed_outer_circle"></div>
                                    <div class="dot_unplayed_x">✕</div>
                                </div>
                            </div>
                        </div>`;
                }
            }
            
            fret0HTML += `
                    </div>
                </div>
                <div class="fretboard_binding fretboard_binding_fx binding_0_fret_right"></div>`;
            
            fret0.innerHTML = fret0HTML;
        }
        
        const nut = document.getElementById(getInstanceElementId(detectedFretboardId, 'chord_builder_nut'));
        if (nut) {
            let nutHTML = `
            <div class="chord_builder_fret_indicator"></div>
            <div class="fretboard_binding binding_nut_left"></div>
            <div class="chord_builder_fretboard_row">
                <div class="strings_container">`;
        
            for (let i = 1; i <= numStrings; i++) {
                const stringClass = `string_${i}`;
                if (STRING_TYPE === '2') {
                    nutHTML += `
                    <div class="fingerboard_piece_wrapper">
                        <div class="fingerboard_piece"></div>
                        <div class="${stringClass}"></div>
                        <div class="fingerboard_piece_middle"></div>
                        <div class="${stringClass} fingerboard_second_string"></div>
                        <div class="fingerboard_piece"></div>
                    </div>`;
                } else {
                    nutHTML += `
                    <div class="fingerboard_piece_wrapper">
                        <div class="fingerboard_piece"></div>
                        <div class="${stringClass}"></div>
                        <div class="fingerboard_piece"></div>
                    </div>`;
                }
            }
            
            nutHTML += `
                </div>
            </div>
            <div class="fretboard_binding binding_nut_right"></div>`;
        
            nut.innerHTML = nutHTML;
        }
        
        // Try to get fretboardId from any wrapper
        let detectedFretboardIdForBreak = null;
        const wrapperForBreak = document.querySelector('[id$="_chord_builder_wrapper"]');
        if (wrapperForBreak && wrapperForBreak.id) {
            const match = wrapperForBreak.id.match(/^(.+)_chord_builder_wrapper$/);
            if (match) detectedFretboardIdForBreak = match[1];
        }
        
        if (detectedFretboardIdForBreak) {
            updateFretboardBreakRow(detectedFretboardIdForBreak);
        } else {
            updateFretboardBreakRow();
        }
    }

    function setChordConfiguration(startFret, numFrets, fretboardId = null) {
        START_FRET = startFret;
        
        document.documentElement.style.setProperty('--start-fret', startFret);
        document.documentElement.style.setProperty('--num-frets', numFrets);
        
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'syncDropdowns',
                startFret: startFret,
                numFrets: numFrets
            }, '*');
        }
        
        // Try to get fretboardId if not provided
        if (!fretboardId) {
            const anyWrapper = document.querySelector('[id$="_chord_builder_wrapper"]');
            if (anyWrapper && anyWrapper.id) {
                const match = anyWrapper.id.match(/^(.+)_chord_builder_wrapper$/);
                if (match) fretboardId = match[1];
            }
        }
        
        // Save current dot state before regenerating
        if (fretboardId && isInitialized) {
            saveDotState(fretboardId);
            const savedDotState = [...PERSISTENT_DOT_STATE];
            
            generateFretRows(false, fretboardId);
            applyFretHeights(fretboardId);
            applyFretIndicatorVisibility(fretboardId);
            applyFretboardBindingDisplay(fretboardId);
            applyHoverDotTemplate(fretboardId);
            addDotInteractivity(fretboardId);
            updateFretboardBreakRow(fretboardId);
            
            // Restore dot state after regeneration
            PERSISTENT_DOT_STATE = savedDotState;
            restoreDotState(fretboardId);
        } else {
            // Fallback if fretboardId not available
            generateFretRows(false, fretboardId);
            applyFretHeights(fretboardId);
            applyFretIndicatorVisibility(fretboardId);
            applyFretboardBindingDisplay(fretboardId);
            applyHoverDotTemplate(fretboardId);
            addDotInteractivity(fretboardId);
            updateFretboardBreakRow(fretboardId);
        }
    }

    function clearChord(fretboardId = null) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/8cd7cac6-1452-4896-a1f2-bc2f0796f08c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fretboard.js:1375',message:'clearChord entry',data:{fretboardId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
        // #endregion
        // If fretboardId is provided, only clear dots within that fretboard
        let dots, unplayedDots;
        if (fretboardId) {
            const wrapper = document.getElementById(getInstanceElementId(fretboardId, 'chord_builder_wrapper'));
            if (wrapper) {
                dots = wrapper.querySelectorAll('.fingering_dot.active');
                unplayedDots = wrapper.querySelectorAll('.fingering_dot_unplayed.active');
            } else {
                return; // Fretboard not found
            }
        } else {
            // Fallback: clear all dots (for backward compatibility)
            dots = document.querySelectorAll('.fingering_dot.active');
            unplayedDots = document.querySelectorAll('.fingering_dot_unplayed.active');
        }
        
        dots.forEach(dot => {
            dot.classList.add('removing');
            // Hide interval labels when clearing chord
            const intervalLabel = dot.querySelector('.interval_indicator_label');
            if (intervalLabel) {
                intervalLabel.style.display = 'none';
                intervalLabel.textContent = '';
                intervalLabel.removeAttribute('data-interval');
                intervalLabel.classList.remove('active');
            }
            setTimeout(() => {
                dot.classList.remove('active', 'removing');
            }, 200);
        });
        unplayedDots.forEach(dot => {
            dot.classList.add('removing');
            // Hide interval labels on unplayed dots too
            const intervalLabel = dot.querySelector('.interval_indicator_label');
            if (intervalLabel) {
                intervalLabel.style.display = 'none';
                intervalLabel.textContent = '';
                intervalLabel.removeAttribute('data-interval');
                intervalLabel.classList.remove('active');
            }
            setTimeout(() => {
                dot.classList.remove('active', 'removing');
            }, 200);
        });
        
        // Also hide all interval labels in the fretboard (including inactive dots)
        if (fretboardId) {
            const wrapper = document.getElementById(getInstanceElementId(fretboardId, 'chord_builder_wrapper'));
            if (wrapper) {
                const allIntervalLabels = wrapper.querySelectorAll('.interval_indicator_label');
                allIntervalLabels.forEach(label => {
                    label.style.display = 'none';
                    label.textContent = '';
                    label.removeAttribute('data-interval');
                    label.classList.remove('active');
                });
            }
        } else {
            // Fallback: hide all interval labels
            const allIntervalLabels = document.querySelectorAll('.interval_indicator_label');
            allIntervalLabels.forEach(label => {
                label.style.display = 'none';
                label.textContent = '';
                label.removeAttribute('data-interval');
                label.classList.remove('active');
            });
        }
        
        // Clear CURRENT_CHORD_ROOT when chord is cleared
        CURRENT_CHORD_ROOT = null;
    }

    function redrawChordOnly(chordConfig, fretboardId = null) {
        if (!chordConfig) return;
        displayChord(chordConfig, fretboardId);
    }

    function displayChord(chordConfig, fretboardId = null) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/8cd7cac6-1452-4896-a1f2-bc2f0796f08c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fretboard.js:1411',message:'displayChord entry',data:{chordConfig:JSON.parse(JSON.stringify(chordConfig)),fingeringLength:chordConfig.fingering?.length||0,hasFingering:chordConfig.hasOwnProperty('fingering'),fretboardId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
        // #endregion
        
        // Try to get fretboardId if not provided (do this first)
        if (!fretboardId) {
            const anyWrapper = document.querySelector('[id$="_chord_builder_wrapper"]');
            if (anyWrapper && anyWrapper.id) {
                const match = anyWrapper.id.match(/^(.+)_chord_builder_wrapper$/);
                if (match) fretboardId = match[1];
            }
        }
        
        if (!fretboardId) {
            console.warn('displayChord: Could not determine fretboardId');
            return;
        }
        
        clearChord(fretboardId);
        
        if (Array.isArray(chordConfig)) {
            const fingering = chordConfig;
            const rootNote = arguments[1] || null;
            chordConfig = {
                name: "Unknown",
                root: rootNote,
                fingering: fingering,
                showIntervals: !!rootNote
            };
        }
        
        CURRENT_CHORD_CONFIG = chordConfig;
        
        const {
            name = "Unknown Chord",
            root = null,
            fingering = [],
            tuning = settingsGroupA.tuning || null, // Default to settingsGroupA.tuning if not provided in chordConfig
            numStrings = settingsGroupA.numStrings || null, // Default to settingsGroupA.numStrings if not provided in chordConfig
            stringType = settingsGroupA.stringType || null, // Default to settingsGroupA.stringType if not provided in chordConfig
            displayMode = DOT_TEXT_MODE,
            showIntervals = true,
            customColors = {},
            startFret = 1,
            numFrets = 4
        } = chordConfig;
        
        CURRENT_CHORD_ROOT = root;
        
        let calculatedNumStrings = numStrings;
        if (calculatedNumStrings === null && fingering.length > 0) {
            // Filter out skipped strings (fret: null, undefined, or 'none')
            const validFingering = fingering.filter(f => f.fret !== null && f.fret !== undefined && f.fret !== 'none');
            if (validFingering.length > 0) {
                const maxStringIndex = Math.max(...validFingering.map(f => f.string));
                calculatedNumStrings = maxStringIndex; // Strings are now 1-based, so max is the count
            }
        }
        
        let needsRegeneration = false;
        
        if (calculatedNumStrings !== null) {
            const currentNumStrings = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--num-strings')) || 6;
            if (currentNumStrings !== calculatedNumStrings) {
                document.documentElement.style.setProperty('--num-strings', calculatedNumStrings);
                needsRegeneration = true;
            }
        }
        
        const targetStringType = stringType !== null ? stringType : '1';
        if (STRING_TYPE !== targetStringType) {
            STRING_TYPE = targetStringType;
            needsRegeneration = true;
        }
        
        const originalTuning = tuning ? { ...TUNING } : null;
        if (tuning) {
            Object.keys(tuning).forEach(stringIndex => {
                const tuningValue = tuning[stringIndex];
                if (typeof tuningValue === 'string') {
                    TUNING[stringIndex] = tuningValue;
                } else if (typeof tuningValue === 'object' && tuningValue.note) {
                    TUNING[stringIndex] = tuningValue.note;
                    
                    if (tuningValue.color) {
                        let colorValue = tuningValue.color;
                        if (colorValue === 'bronze') {
                            colorValue = 'var(--stringcolor_bronze)';
                        } else if (colorValue === 'nickel') {
                            colorValue = 'var(--stringcolor_nickel)';
                        }
                        document.documentElement.style.setProperty(`--string-${stringIndex}-color`, colorValue);
                    }
                }
            });
        }
        
        if (needsRegeneration) {
            initializeDynamicStrings(fretboardId);
            generateFretRows(true, fretboardId);
            applyFretHeights(fretboardId);
            applyFretIndicatorVisibility(fretboardId);
            applyFretboardBindingDisplay(fretboardId);
            applyHoverDotTemplate(fretboardId);
            addDotInteractivity(fretboardId);
            updateFretboardBreakRow(fretboardId);
        }
        
        setChordConfiguration(startFret, numFrets, fretboardId);
        
        // Reapply fret indicator visibility after setting chord configuration
        // (setChordConfiguration already calls this, but ensure it's applied after dots are placed)
        applyFretIndicatorVisibility(fretboardId);
        
        fingering.forEach(({ string, fret, finger }) => {
            // Skip strings with null, undefined, or 'none' fret values
            if (fret === null || fret === undefined || fret === 'none') {
                return;
            }
            
            // Convert 1-based string number to 0-based array index
            const stringArrayIndex = string - 1;
            
            if (fret === -1) {
                const fretRow = document.getElementById(getInstanceElementId(fretboardId, 'chord_builder_fret_row_wrapper_0'));
                if (fretRow) {
                    const wrappers = fretRow.querySelectorAll('.fingerboard_piece_wrapper');
                    if (wrappers[stringArrayIndex]) {
                        const unplayedDot = wrappers[stringArrayIndex].querySelector('.fingering_dot_unplayed');
                        if (unplayedDot) {
                            unplayedDot.classList.add('active');
                        }
                    }
                }
                return;
            }
            
            const fretRow = document.getElementById(getInstanceElementId(fretboardId, `chord_builder_fret_row_wrapper_${fret}`));
            if (fretRow) {
                const wrappers = fretRow.querySelectorAll('.fingerboard_piece_wrapper');
                if (wrappers[stringArrayIndex]) {
                    const dot = wrappers[stringArrayIndex].querySelector('.fingering_dot');
                    if (dot) {
                        dot.classList.add('active');
                        
                        const note = getNoteAtFret(string, fret);
                        
                        const dotText = dot.querySelector('.dot_text');
                        if (dotText) {
                            // Always set data-finger attribute if finger is provided
                            if (finger !== undefined && finger !== null) {
                                dotText.setAttribute('data-finger', String(finger));
                            }
                            
                            if (displayMode === 'finger' && finger !== undefined) {
                                dotText.textContent = finger;
                            } else if (displayMode === 'note' && note) {
                                dotText.textContent = note;
                            }
                        }
                        
                        if (showIntervals && root && note) {
                            const intervalLabel = dot.querySelector('.interval_indicator_label');
                            if (intervalLabel) {
                                const interval = getInterval(root, note, fret);
                                if (interval) {
                                    intervalLabel.textContent = interval;
                                    intervalLabel.classList.add('active');
                                    intervalLabel.setAttribute('data-interval', interval);
                                    intervalLabel.style.display = 'flex'; // Show interval label
                                    
                                    if (customColors && customColors[interval]) {
                                        intervalLabel.style.backgroundColor = customColors[interval];
                                    } else {
                                        intervalLabel.style.backgroundColor = '';
                                    }
                                } else {
                                    // Hide if no interval calculated
                                    intervalLabel.style.display = 'none';
                                }
                            }
                        } else {
                            // Hide interval label when there's no root or intervals shouldn't be shown
                            const intervalLabel = dot.querySelector('.interval_indicator_label');
                            if (intervalLabel) {
                                intervalLabel.style.display = 'none';
                                intervalLabel.textContent = '';
                                intervalLabel.removeAttribute('data-interval');
                                intervalLabel.classList.remove('active');
                            }
                        }
                        
                        if (customColors && customColors[string] !== undefined) {
                            const outerCircle = dot.querySelector('.dot_outer_circle');
                            if (outerCircle) {
                                outerCircle.style.backgroundColor = customColors[string];
                            }
                        }
                    }
                }
            }
        });
        
        if (originalTuning) {
            Object.assign(TUNING, originalTuning);
        }
        
        console.log(`Displayed chord: ${name}`);
        
        saveDotState(fretboardId);
        
        // Update control panel if it exists
        if (window.FretboardControlPanel && window.FretboardControlPanel.updateFromFretboard) {
            try {
                window.FretboardControlPanel.updateFromFretboard(fretboardId);
            } catch (e) {
                // Fail gracefully if panel update fails
                console.debug('Control panel update failed (this is OK if no panel exists):', e);
            }
        }
    }

    // ============================================================================
    // SETTINGS UPDATE FUNCTIONS
    // ============================================================================

    /**
     * Applies fret indicator visibility based on SHOW_FRET_INDICATORS setting
     */
    function applyFretIndicatorVisibility(fretboardId = null) {
        // If fretboardId not provided, try to find it
        if (!fretboardId) {
            const anyWrapper = document.querySelector('[id$="_chord_builder_wrapper"]');
            if (anyWrapper && anyWrapper.id) {
                const match = anyWrapper.id.match(/^(.+)_chord_builder_wrapper$/);
                if (match) fretboardId = match[1];
            }
        }
        
        if (!fretboardId) {
            console.warn('applyFretIndicatorVisibility: Could not determine fretboardId');
            return;
        }
        
        const wrapper = document.getElementById(getInstanceElementId(fretboardId, 'chord_builder_wrapper'));
        if (!wrapper) return;
        
        const indicators = wrapper.querySelectorAll('.chord_builder_fret_indicator > div');
        const firstVisibleFret = wrapper.querySelector('.first-visible-fret');
        const isFirstFretOne = firstVisibleFret && firstVisibleFret.id === getInstanceElementId(fretboardId, 'chord_builder_fret_row_wrapper_1');

        indicators.forEach(indicator => {
            const fretRow = indicator.closest('[id^="chord_builder_fret_row_wrapper_"]');
            const isFirstVisible = fretRow && fretRow.classList.contains('first-visible-fret');

            switch (SHOW_FRET_INDICATORS) {
                case 'all':
                    indicator.style.display = 'block';
                    break;
                case 'none':
                    indicator.style.display = 'none';
                    break;
                case 'first-fret':
                    indicator.style.display = isFirstVisible ? 'block' : 'none';
                    break;
                case 'first-fret-cond':
                    // Show only if first visible fret AND it's not fret 1
                    // Also show if it's the first visible fret (regardless of whether it's fret 1)
                    // The condition means: show if it's the first visible fret, but only if that first visible fret is NOT fret 1
                    // So if startFret > 1, the first visible fret will be > 1, so isFirstFretOne will be false, and it should show
                    indicator.style.display = (isFirstVisible && !isFirstFretOne) ? 'block' : 'none';
                    break;
                default:
                    // Default to first-fret-cond behavior
                    indicator.style.display = (isFirstVisible && !isFirstFretOne) ? 'block' : 'none';
            }
        });
        
        // Ensure the first visible fret indicator is shown
        // This is a fallback in case the class wasn't set correctly or timing issues
        if (firstVisibleFret) {
            if (SHOW_FRET_INDICATORS === 'first-fret') {
                // For 'first-fret', always show the first visible fret indicator, even if it's fret 1
                const firstVisibleIndicator = firstVisibleFret.querySelector('.chord_builder_fret_indicator > div');
                if (firstVisibleIndicator) {
                    firstVisibleIndicator.style.display = 'block';
                }
            } else if (SHOW_FRET_INDICATORS === 'first-fret-cond' && !isFirstFretOne) {
                // For 'first-fret-cond', only show if it's not fret 1
                const firstVisibleIndicator = firstVisibleFret.querySelector('.chord_builder_fret_indicator > div');
                if (firstVisibleIndicator) {
                    firstVisibleIndicator.style.display = 'block';
                }
            }
        }
        
        // Additional fallback: if startFret > 1, ensure the first visible fret indicator is shown
        // This handles cases where the first-visible-fret class might not be set yet
        if (START_FRET > 1 && (SHOW_FRET_INDICATORS === 'first-fret-cond' || SHOW_FRET_INDICATORS === 'first-fret')) {
            const firstFretRow = document.getElementById(getInstanceElementId(fretboardId, `chord_builder_fret_row_wrapper_${START_FRET}`));
            if (firstFretRow && firstFretRow.style.display !== 'none') {
                const firstFretIndicator = firstFretRow.querySelector('.chord_builder_fret_indicator > div');
                if (firstFretIndicator) {
                    firstFretIndicator.style.display = 'block';
                }
            }
        }
        
        // Additional fallback for 'first-fret' when startFret = 1
        // This ensures fret 1 indicator is shown when startFret = 1 and mode is 'first-fret'
        if (START_FRET === 1 && SHOW_FRET_INDICATORS === 'first-fret') {
            const fret1Row = document.getElementById(getInstanceElementId(fretboardId, 'chord_builder_fret_row_wrapper_1'));
            if (fret1Row && fret1Row.style.display !== 'none') {
                const fret1Indicator = fret1Row.querySelector('.chord_builder_fret_indicator > div');
                if (fret1Indicator) {
                    fret1Indicator.style.display = 'block';
                }
            }
        }
    }

    /**
     * Applies fretboard binding display based on FRETBOARD_BINDING_DISPLAY setting
     */
    function applyFretboardBindingDisplay(fretboardId = null) {
        // If fretboardId not provided, try to find it
        if (!fretboardId) {
            const anyWrapper = document.querySelector('[id$="_chord_builder_wrapper"]');
            if (anyWrapper && anyWrapper.id) {
                const match = anyWrapper.id.match(/^(.+)_chord_builder_wrapper$/);
                if (match) fretboardId = match[1];
            }
        }
        
        if (!fretboardId) {
            console.warn('applyFretboardBindingDisplay: Could not determine fretboardId');
            return;
        }
        
        const wrapper = document.getElementById(getInstanceElementId(fretboardId, 'chord_builder_wrapper'));
        if (!wrapper) return;
        
        // Select all bindings including break_binding (all bindings should be controlled by the checkbox)
        const bindings = wrapper.querySelectorAll('.fretboard_binding');
        const displayValue = FRETBOARD_BINDING_DISPLAY ? 'block' : 'none';
        bindings.forEach(binding => {
            binding.style.display = displayValue;
        });
    }

    /**
     * Updates Settings Group A - Fretboard Variables
     * @param {Object} settings - Settings object with dotTextMode, showFretIndicators, and/or cssVariables
     * @param {string} [fretboardId] - Optional fretboard ID to update specific instance
     */
    function updateSettingsGroupA(settings, fretboardId = null) {
        if (!settings) return;

        // Update JS variables
        if (settings.dotTextMode !== undefined) {
            DOT_TEXT_MODE = settings.dotTextMode;
            settingsGroupA.dotTextMode = settings.dotTextMode;
            updateAllDotText(fretboardId);
        }

        if (settings.showFretIndicators !== undefined) {
            SHOW_FRET_INDICATORS = settings.showFretIndicators;
            settingsGroupA.showFretIndicators = settings.showFretIndicators;
            applyFretIndicatorVisibility();
        }

        // Update tuning
        if (settings.tuning !== undefined) {
            settingsGroupA.tuning = settings.tuning;
            
            if (settings.tuning) {
                Object.keys(settings.tuning).forEach(stringIndex => {
                    const tuningValue = settings.tuning[stringIndex];
                    if (typeof tuningValue === 'string') {
                        TUNING[stringIndex] = tuningValue;
                    } else if (typeof tuningValue === 'object' && tuningValue.note) {
                        TUNING[stringIndex] = tuningValue.note;
                        
                        // Handle string colors if provided
                        if (tuningValue.color) {
                            let colorValue = tuningValue.color;
                            if (colorValue === 'bronze') {
                                colorValue = 'var(--stringcolor_bronze)';
                            } else if (colorValue === 'nickel') {
                                colorValue = 'var(--stringcolor_nickel)';
                            }
                            document.documentElement.style.setProperty(`--string-${stringIndex}-color`, colorValue);
                        }
                    }
                });
                
                // Update tuning labels in the header when tuning changes
                if (isInitialized) {
                    // Update tuning labels for all fretboard instances
                    const allHeaders = document.querySelectorAll('[id$="_chord_fretboard_header"], [id="chord_fretboard_header"]');
                    allHeaders.forEach(header => {
                        const tuningLabels = header.querySelectorAll('.tuning_label');
                        tuningLabels.forEach((label, index) => {
                            // Tuning labels use 1-based indexing (string 1, 2, 3, etc.)
                            const stringIndex = index + 1;
                            const tuningNote = TUNING[stringIndex] || '';
                            label.textContent = tuningNote;
                        });
                    });
                    // Update note labels on existing dots when tuning changes
                    // Note: This will recalculate notes based on new tuning, but won't clear dots
                    updateAllDotText(fretboardId);
                    // Also update intervals since note positions may have changed
                    if (CURRENT_CHORD_ROOT) {
                        updateAllIntervals();
                    }
                }
            } else {
                // If tuning is explicitly set to null, reset to defaults
                settingsGroupA.tuning = null;
            }
        }

        // Update numStrings
        if (settings.numStrings !== undefined) {
            settingsGroupA.numStrings = settings.numStrings;
            document.documentElement.style.setProperty('--num-strings', settings.numStrings);
            
            if (isInitialized) {
                // Save current dot state before regenerating
                if (fretboardId) {
                    saveDotState(fretboardId);
                    const savedDotState = [...PERSISTENT_DOT_STATE];
                    
                    initializeDynamicStrings(fretboardId);
                    generateFretRows(true, fretboardId);
                    applyFretHeights(fretboardId);
                    applyHoverDotTemplate(fretboardId);
                    addDotInteractivity(fretboardId);
                    
                    // Restore dot state after regeneration
                    PERSISTENT_DOT_STATE = savedDotState;
                    restoreDotState(fretboardId);
                } else {
                    // Fallback if we can't determine fretboardId
                    initializeDynamicStrings();
                    generateFretRows(true);
                    applyFretHeights();
                    applyHoverDotTemplate();
                    addDotInteractivity();
                }
            }
        }

        // Update stringType
        if (settings.stringType !== undefined) {
            settingsGroupA.stringType = settings.stringType;
            STRING_TYPE = settings.stringType;
            
            if (isInitialized) {
                // Save current dot state before regenerating
                if (fretboardId) {
                    saveDotState(fretboardId);
                    const savedDotState = [...PERSISTENT_DOT_STATE];
                    
                    initializeDynamicStrings(fretboardId);
                    generateFretRows(true, fretboardId);
                    applyFretHeights(fretboardId);
                    applyHoverDotTemplate(fretboardId);
                    addDotInteractivity(fretboardId);
                    
                    // Restore dot state after regeneration
                    PERSISTENT_DOT_STATE = savedDotState;
                    restoreDotState(fretboardId);
                } else {
                    // Fallback if we can't determine fretboardId
                    initializeDynamicStrings();
                    generateFretRows(true);
                    applyFretHeights();
                    applyHoverDotTemplate();
                    addDotInteractivity();
                }
            }
        }

        // Update CSS variables
        if (settings.cssVariables) {
            Object.keys(settings.cssVariables).forEach(key => {
                let value = settings.cssVariables[key];
                // Convert marker values ("no-image", "no-dot-image") to empty string for proper CSS fallback
                if (value === 'no-image' || value === 'no-dot-image') {
                    value = '';
                }
                document.documentElement.style.setProperty(key, value);
                settingsGroupA.cssVariables[key] = settings.cssVariables[key];
            });

            // Check if dimensions changed - if so, regenerate
            const dimensionVars = [
                '--fretboard-width', '--fretboard-height', '--header-height',
                '--fret-0-height', '--string-thickest-width',
                '--string-thinnest-width', '--dot-size', '--num-strings'
            ];
            
            const needsRegeneration = dimensionVars.some(v => settings.cssVariables.hasOwnProperty(v));
            
            if (needsRegeneration) {
                // Regenerate if string count or key dimensions changed
                if (settings.cssVariables['--num-strings']) {
                    // Try to get fretboardId - we need it to preserve dots
                    let fretboardId = null;
                    const anyWrapper = document.querySelector('[id$="_chord_builder_wrapper"]');
                    if (anyWrapper && anyWrapper.id) {
                        const match = anyWrapper.id.match(/^(.+)_chord_builder_wrapper$/);
                        if (match) fretboardId = match[1];
                    }
                    
                    // Save current dot state before regenerating
                    if (fretboardId) {
                        saveDotState(fretboardId);
                        const savedDotState = [...PERSISTENT_DOT_STATE];
                        
                        initializeDynamicStrings(fretboardId);
                        generateFretRows(true, fretboardId);
                        applyFretHeights(fretboardId);
                        applyHoverDotTemplate(fretboardId);
                        addDotInteractivity(fretboardId);
                        
                        // Restore dot state after regeneration
                        PERSISTENT_DOT_STATE = savedDotState;
                        restoreDotState(fretboardId);
                    } else {
                        // Fallback if we can't determine fretboardId
                        initializeDynamicStrings();
                        generateFretRows(true);
                        applyFretHeights();
                        applyHoverDotTemplate();
                        addDotInteractivity();
                    }
                } else {
                    applyFretHeights();
                }
            }
        }

        // Don't redraw chord when updating settings - preserve current dot state
        // Only redraw if dimensions changed (which requires regeneration)
        // The dots should remain as the user placed them
    }

    /**
     * Applies custom CSS to a specific fretboard instance
     * @param {string} cssString - CSS string to apply
     * @param {string} fretboardId - Fretboard ID
     */
    function applyCustomCSS(cssString, fretboardId) {
        if (!fretboardId) {
            // Try to detect fretboardId if not provided
            const anyWrapper = document.querySelector('[id$="_chord_builder_wrapper"]');
            if (anyWrapper && anyWrapper.id) {
                const match = anyWrapper.id.match(/^(.+)_chord_builder_wrapper$/);
                if (match) fretboardId = match[1];
            }
        }
        
        if (!fretboardId) {
            console.warn('applyCustomCSS: Could not determine fretboardId');
            return;
        }
        
        const styleTagId = `fretboard-custom-css-${fretboardId}`;
        let styleTag = document.getElementById(styleTagId);
        
        // Get wrapper ID for scoping
        const wrapperId = getInstanceElementId(fretboardId, 'chord_builder_wrapper');
        
        if (!cssString || cssString.trim() === '') {
            // Remove style tag if CSS is empty
            if (styleTag) {
                styleTag.remove();
            }
            return;
        }
        
        // Create style tag if it doesn't exist
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = styleTagId;
            document.head.appendChild(styleTag);
        }
        
        // Scope the CSS by prepending the wrapper ID selector to each rule
        // This ensures the CSS only applies to elements within this specific fretboard instance
        // The user's CSS can contain multiple rules, so we need to parse and scope each one
        let scopedCSS = '';
        const rules = cssString.split(/(?<=})\s*(?=\S)/); // Split on } followed by whitespace and a non-whitespace char (start of next rule)
        
        rules.forEach(rule => {
            const trimmed = rule.trim();
            if (!trimmed) return;
            
            // Find the selector part (before the first {)
            const braceIndex = trimmed.indexOf('{');
            if (braceIndex === -1) {
                // No brace found, might be a comment or incomplete rule, include as-is
                scopedCSS += trimmed + '\n';
                return;
            }
            
            const selector = trimmed.substring(0, braceIndex).trim();
            const properties = trimmed.substring(braceIndex);
            
            // Prepend wrapper ID to selector (add space for descendant selector)
            scopedCSS += `#${wrapperId} ${selector}${properties}\n`;
        });
        
        styleTag.textContent = scopedCSS.trim();
    }

    /**
     * Updates Settings Group B - Fretboard Skin
     * @param {Object} settings - Settings object with fretMarkers, fretboardBindingDisplay, cssVariables, and/or customCSS
     * @param {string} fretboardId - Optional fretboard ID (will be detected if not provided)
     */
    function updateSettingsGroupB(settings, fretboardId = null) {
        if (!settings) return;

        // Update fret markers
        if (settings.fretMarkers !== undefined) {
            FRET_MARKERS = JSON.parse(JSON.stringify(settings.fretMarkers)); // Deep copy to ensure proper reference
            settingsGroupB.fretMarkers = JSON.parse(JSON.stringify(settings.fretMarkers));
            // Update only the markers without regenerating the entire fret row
            // This preserves binding divs and other elements
            updateFretMarkersOnly();
        }

        // Update binding display
        if (settings.fretboardBindingDisplay !== undefined) {
            FRETBOARD_BINDING_DISPLAY = settings.fretboardBindingDisplay;
            settingsGroupB.fretboardBindingDisplay = settings.fretboardBindingDisplay;
            applyFretboardBindingDisplay();
        }

        // Update CSS variables
        if (settings.cssVariables) {
            Object.keys(settings.cssVariables).forEach(key => {
                let value = settings.cssVariables[key];
                // For marker-dot-background-image, directly update all marker dot elements
                if (key === '--marker-dot-background-image') {
                    // Update all marker dots directly
                    const markerDots = document.querySelectorAll('.marker_dot');
                    if (value === 'no-image' || value === 'no-dot-image' || value === '' || !value || value === 'none') {
                        // Remove background-image property
                        markerDots.forEach(dot => {
                            dot.style.backgroundImage = '';
                        });
                        // Store empty string for sync
                        value = '';
                    } else {
                        // Add background-image property (value should already be formatted as url("..."))
                        markerDots.forEach(dot => {
                            dot.style.backgroundImage = value;
                        });
                    }
                    // Also set the CSS variable for consistency
                    document.documentElement.style.setProperty(key, value || 'none');
                    // Store the processed value (not the original) so sync works correctly
                    settingsGroupB.cssVariables[key] = value;
                } else {
                    // For other marker image vars, convert to empty string
                    if (value === 'no-image' || value === 'no-dot-image') {
                        value = '';
                    }
                    console.log(`Setting CSS variable ${key} = ${value}`);
                    document.documentElement.style.setProperty(key, value);
                    // Store the processed value (not the original) so sync works correctly
                    settingsGroupB.cssVariables[key] = value;
                }
            });
        }

        // Update custom CSS
        if (settings.customCSS !== undefined) {
            settingsGroupB.customCSS = settings.customCSS || null;
            applyCustomCSS(settings.customCSS || '', fretboardId);
        }

        // No regeneration needed for visual-only changes
    }

    /**
     * Applies a theme to the fretboard
     * @param {string} themeName - Name of the theme to apply
     * @param {string} fretboardId - Optional fretboard ID (will be detected if not provided)
     */
    function applyTheme(themeName, fretboardId = null) {
        // Try to get fretboardId if not provided
        if (!fretboardId) {
            const anyWrapper = document.querySelector('[id$="_chord_builder_wrapper"]');
            if (anyWrapper && anyWrapper.id) {
                const match = anyWrapper.id.match(/^(.+)_chord_builder_wrapper$/);
                if (match) fretboardId = match[1];
            }
        }
        
        if (!fretboardId) {
            console.warn('applyTheme: Could not determine fretboardId');
            return;
        }
        
        // Get the instance
        const instance = fretboardInstances.get(fretboardId);
        if (!instance) {
            console.error('applyTheme: No instance found for', fretboardId);
            return;
        }
        
        // Get themes from instance
        const themes = instance.themes;
        if (!themes || !themes[themeName]) {
            console.error('applyTheme: Theme not found:', themeName);
            return;
        }
        
        // Get the theme
        const theme = themes[themeName];
        
        // Apply theme values to Settings Group B
        const themeB = {
            fretMarkers: theme.fretMarkers,
            fretboardBindingDisplay: theme.fretboardBindingDisplay,
            cssVariables: theme.cssVariables || {},
            customCSS: theme.customCSS
        };
        
        updateSettingsGroupB(themeB, fretboardId);
        
        // Update active theme in instance
        instance.activeTheme = themeName;
    }

    /**
     * Applies an instrument to the fretboard
     * @param {string} instrumentName - Name of the instrument to apply
     * @param {string} fretboardId - Optional fretboard ID (will be detected if not provided)
     */
    function applyInstrument(instrumentName, fretboardId = null) {
        // Try to get fretboardId if not provided
        if (!fretboardId) {
            const anyWrapper = document.querySelector('[id$="_chord_builder_wrapper"]');
            if (anyWrapper && anyWrapper.id) {
                const match = anyWrapper.id.match(/^(.+)_chord_builder_wrapper$/);
                if (match) fretboardId = match[1];
            }
        }
        
        if (!fretboardId) {
            console.warn('applyInstrument: Could not determine fretboardId');
            return;
        }
        
        // Get the instance
        const instance = fretboardInstances.get(fretboardId);
        if (!instance) {
            console.error('applyInstrument: No instance found for', fretboardId);
            return;
        }
        
        // Get instruments from instance
        const instruments = instance.instruments;
        if (!instruments || !instruments[instrumentName]) {
            console.error('applyInstrument: Instrument not found:', instrumentName);
            return;
        }
        
        // Get the instrument
        const instrument = instruments[instrumentName];
        
        // Apply instrument values to Settings Group A (only tuning, numStrings, stringType)
        const instrumentA = {
            tuning: instrument.tuning,
            numStrings: instrument.numStrings,
            stringType: instrument.stringType
        };
        
        updateSettingsGroupA(instrumentA, fretboardId);
        
        // Update active instrument in instance
        instance.activeInstrument = instrumentName;
    }

    /**
     * Updates Settings Group C - Chord Variables
     * @param {Object} settings - Chord configuration object
     * @param {boolean} skipRegeneration - If true, skip regeneration (used during init)
     */
    function updateSettingsGroupC(settings, skipRegeneration = false, fretboardId = null) {
        if (!settings) return;

        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/8cd7cac6-1452-4896-a1f2-bc2f0796f08c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fretboard.js:1867',message:'updateSettingsGroupC entry',data:{settingsKeys:Object.keys(settings),hasFingering:settings.hasOwnProperty('fingering'),fingeringLength:settings.fingering?.length||0,settingsGroupCBefore:JSON.parse(JSON.stringify(settingsGroupC))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion

        // Merge with existing settings (exclude tuning, numStrings, stringType - they're now in settingsGroupA)
        Object.keys(settings).forEach(key => {
            if (key !== 'tuning' && key !== 'numStrings' && key !== 'stringType') {
                settingsGroupC[key] = settings[key];
            }
        });
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/8cd7cac6-1452-4896-a1f2-bc2f0796f08c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fretboard.js:1873',message:'updateSettingsGroupC after merge',data:{settingsGroupCAfter:JSON.parse(JSON.stringify(settingsGroupC)),hasFingeringAfter:settingsGroupC.hasOwnProperty('fingering'),fingeringLengthAfter:settingsGroupC.fingering?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion

        // Update CURRENT_CHORD_ROOT if root is being updated
        if (settings.root !== undefined) {
            CURRENT_CHORD_ROOT = settings.root;
            // Update interval labels on existing dots without redrawing the chord
            if (isInitialized) {
                updateAllIntervals();
            }
        }

        // Update internal state
        if (settings.startFret !== undefined || settings.numFrets !== undefined) {
            // Try to get fretboardId from any wrapper
            let fretboardId = null;
            const anyWrapper = document.querySelector('[id$="_chord_builder_wrapper"]');
            if (anyWrapper && anyWrapper.id) {
                const match = anyWrapper.id.match(/^(.+)_chord_builder_wrapper$/);
                if (match) fretboardId = match[1];
            }
            
            setChordConfiguration(
                settings.startFret !== undefined ? settings.startFret : settingsGroupC.startFret,
                settings.numFrets !== undefined ? settings.numFrets : settingsGroupC.numFrets,
                fretboardId
            );
        }

        // If chord data is provided and fretboard is already initialized, display it
        // (During init, displayChord is called at the end of init() to ensure proper initialization order)
        // Only call displayChord if fingering was explicitly provided in the settings update
        // This prevents resetting dots when updating other settings (like binding display)
        // IMPORTANT: Only display chord if fingering is explicitly provided in THIS update
        // Do not use settingsGroupC.fingering as it may contain stale data from previous chords
        
        // #region agent log
        const checkFingering = isInitialized && settings.fingering !== undefined && Object.prototype.hasOwnProperty.call(settings, 'fingering');
        fetch('http://127.0.0.1:7242/ingest/8cd7cac6-1452-4896-a1f2-bc2f0796f08c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fretboard.js:1959',message:'updateSettingsGroupC fingering check',data:{isInitialized,settingsHasFingering:settings.hasOwnProperty('fingering'),settingsFingeringUndefined:settings.fingering===undefined,checkFingering,settingsFingeringLength:settings.fingering?.length||0,settingsGroupCFingeringLength:settingsGroupC.fingering?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
        
        if (checkFingering) {
            // Only display if fingering array is provided and has entries
            if (Array.isArray(settings.fingering) && settings.fingering.length > 0) {
                // Check if fingering actually changed before redisplaying
                const currentFingering = settingsGroupC.fingering || [];
                const newFingering = settings.fingering;
                const fingeringChanged = JSON.stringify(currentFingering) !== JSON.stringify(newFingering);
                
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/8cd7cac6-1452-4896-a1f2-bc2f0796f08c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fretboard.js:1972',message:'updateSettingsGroupC about to displayChord',data:{fingeringChanged,currentFingeringLength:currentFingering.length,newFingeringLength:newFingering.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
                // #endregion
                
                if (fingeringChanged) {
                    // Create a clean chord config with only the fingering data from this update
                    // Don't use settingsGroupC as it may have stale data
                    const chordConfig = {
                        fingering: settings.fingering,
                        root: settings.root !== undefined ? settings.root : settingsGroupC.root,
                        name: settings.name !== undefined ? settings.name : settingsGroupC.name,
                        tuning: settingsGroupA.tuning || null, // Get tuning from settingsGroupA
                        numStrings: settingsGroupA.numStrings || null, // Get numStrings from settingsGroupA
                        stringType: settingsGroupA.stringType || null, // Get stringType from settingsGroupA
                        startFret: settings.startFret !== undefined ? settings.startFret : settingsGroupC.startFret,
                        numFrets: settings.numFrets !== undefined ? settings.numFrets : settingsGroupC.numFrets
                    };
                    
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/8cd7cac6-1452-4896-a1f2-bc2f0796f08c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fretboard.js:1987',message:'updateSettingsGroupC calling displayChord',data:{chordConfig:JSON.parse(JSON.stringify(chordConfig))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
                    // #endregion
                    
                    displayChord(chordConfig, fretboardId);
                }
            } else if (Array.isArray(settings.fingering) && settings.fingering.length === 0) {
                // Explicitly clear chord if empty fingering array is provided
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/8cd7cac6-1452-4896-a1f2-bc2f0796f08c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fretboard.js:1990',message:'updateSettingsGroupC calling clearChord',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
                // #endregion
                clearChord(fretboardId);
            }
        }
    }

    // ============================================================================
    // INITIALIZATION FUNCTION
    // ============================================================================

    /**
     * Initializes the fretboard with configuration
     * @param {Object} config - Configuration object
     * @param {string} [config.containerId='chord_builder_wrapper'] - ID of container element
     * @param {string} [config.cssPath='fretboard.css'] - Path to CSS file
     * @param {Object} [config.settingsGroupA] - Settings Group A configuration
     * @param {Object} [config.settingsGroupB] - Settings Group B configuration
     * @param {Object} [config.settingsGroupC] - Settings Group C configuration
     */
    async function init(config) {
        config = config || {};

        // Get or generate fretboard ID
        let fretboardId = config.fretboardId;
        if (!fretboardId) {
            // Try to get from container element's data attribute
            const containerElement = document.getElementById(config.containerId || 'fretboard');
            if (containerElement && containerElement.dataset.fretboardId) {
                fretboardId = containerElement.dataset.fretboardId;
            } else {
                // Generate a unique ID
                fretboardId = config.containerId || 'fretboard-' + Date.now();
            }
        }
        
        // Check if this init call is from a script with apply_to_fretboard attribute
        // If so, store the config for use in auto-init and check if we should actually initialize
        let isScriptInitForDefaults = false;
        try {
            const currentScript = document.currentScript;
            if (currentScript) {
                const applyToFretboard = currentScript.getAttribute('apply_to_fretboard');
                if (applyToFretboard) {
                    isScriptInitForDefaults = true;
                    // Store config using the apply_to_fretboard value as key
                    scriptInitConfigs.set(applyToFretboard, JSON.parse(JSON.stringify(config)));
                    // Also store using the actual fretboardId as key for lookup
                    scriptInitConfigs.set(fretboardId, JSON.parse(JSON.stringify(config)));
                    // Also store by containerId for matching
                    if (config.containerId) {
                        scriptInitConfigs.set(config.containerId, JSON.parse(JSON.stringify(config)));
                    }
                    console.log('Stored script-init config for defaults (apply_to_fretboard:', applyToFretboard, ')');
                    
                    // Check if the target element exists and has a different data-fretboard-id
                    // If so, this script is meant to provide defaults, not actually initialize
                    const targetElement = document.querySelector(`[data-fretboard-id="${applyToFretboard}"]`);
                    if (targetElement && targetElement.dataset.fretboardId !== fretboardId) {
                        // The script's target doesn't match the init's fretboardId
                        // This means the script is providing defaults for auto-init
                        // Don't mark as manually initialized, let auto-init handle it
                        console.log('Script init is for defaults only, will be used by auto-init');
                        // Still continue with initialization, but auto-init will use the stored config
                    }
                }
            }
        } catch (e) {
            // document.currentScript may not be available in all contexts, fail silently
            console.debug('Could not access currentScript:', e);
        }
        
        // Mark as manually initialized (if config was explicitly provided)
        // But if this is a script-init for defaults and the IDs don't match, don't mark it
        // This allows auto-init to run and use the stored config
        if (!isScriptInitForDefaults && (config.containerId || config.fretboardId || config.settingsGroupA || config.settingsGroupB || config.settingsGroupC)) {
            manuallyInitialized.add(fretboardId);
        } else if (isScriptInitForDefaults) {
            // For script inits with apply_to_fretboard, only mark as manually initialized
            // if the fretboardId matches the apply_to_fretboard value
            try {
                const currentScript = document.currentScript;
                if (currentScript) {
                    const applyToFretboard = currentScript.getAttribute('apply_to_fretboard');
                    if (applyToFretboard === fretboardId) {
                        manuallyInitialized.add(fretboardId);
                    }
                }
            } catch (e) {
                // If we can't check, mark it to be safe
                manuallyInitialized.add(fretboardId);
            }
        } else {
            manuallyInitialized.add(fretboardId);
        }

        // Get container ID (don't overwrite global - store in instance)
        const instanceContainerId = config.containerId || 'fretboard';
        
        // Check if instance already exists
        const existingInstance = fretboardInstances.get(fretboardId);
        if (existingInstance && existingInstance.isInitialized) {
            console.log('Fretboard instance already initialized:', fretboardId, '- reinitializing with new config');
            // Remove existing HTML structure to allow regeneration
            const existingWrapper = document.getElementById(getInstanceElementId(fretboardId, 'chord_builder_wrapper'));
            if (existingWrapper) {
                existingWrapper.remove();
            }
        }
        
        // Determine first theme key if themes exist
        let firstThemeKey = null;
        let activeTheme = null;
        if (config.themes && typeof config.themes === 'object' && Object.keys(config.themes).length > 0) {
            firstThemeKey = Object.keys(config.themes)[0];
            activeTheme = firstThemeKey;
        }
        
        // Determine first instrument key if instruments exist
        let firstInstrumentKey = null;
        let activeInstrument = null;
        if (config.instruments && typeof config.instruments === 'object' && Object.keys(config.instruments).length > 0) {
            firstInstrumentKey = Object.keys(config.instruments)[0];
            activeInstrument = firstInstrumentKey;
        }
        
        // Store instance data (update if exists, create if new)
        const instanceData = {
            fretboardId: fretboardId,
            containerId: instanceContainerId,
            config: config,
            isInitialized: false,
            themes: config.themes || null,
            activeTheme: activeTheme,
            instruments: config.instruments || null,
            activeInstrument: activeInstrument
        };
        fretboardInstances.set(fretboardId, instanceData);

        // Inject CSS and wait for it to load, then process marker variables
        await injectCSS(config.cssPath);

        // Generate HTML structure
        if (!generateHTMLStructure(instanceContainerId, fretboardId)) {
            console.error('Failed to generate HTML structure');
            return;
        }

        // Apply settings groups in order (A, B, C)
        // CSS is the single source of truth - only apply overrides when explicitly provided
        
        // Apply instrument first (if exists), then settingsGroupA can override instrument values
        if (firstInstrumentKey && config.instruments[firstInstrumentKey]) {
            const firstInstrument = config.instruments[firstInstrumentKey];
            const instrumentA = {
                tuning: firstInstrument.tuning,
                numStrings: firstInstrument.numStrings,
                stringType: firstInstrument.stringType
            };
            updateSettingsGroupA(instrumentA, fretboardId);
        }
        
        if (config.settingsGroupA) {
            // Merge non-CSS defaults with provided config
            // This will override any instrument values that were just applied
            const mergedA = {
                dotTextMode: config.settingsGroupA.dotTextMode !== undefined ? config.settingsGroupA.dotTextMode : defaultSettingsGroupA.dotTextMode,
                showFretIndicators: config.settingsGroupA.showFretIndicators !== undefined ? config.settingsGroupA.showFretIndicators : defaultSettingsGroupA.showFretIndicators,
                tuning: config.settingsGroupA.tuning !== undefined ? config.settingsGroupA.tuning : defaultSettingsGroupA.tuning,
                numStrings: config.settingsGroupA.numStrings !== undefined ? config.settingsGroupA.numStrings : defaultSettingsGroupA.numStrings,
                stringType: config.settingsGroupA.stringType !== undefined ? config.settingsGroupA.stringType : defaultSettingsGroupA.stringType
            };
            // Only include cssVariables if explicitly provided
            if (config.settingsGroupA.cssVariables) {
                mergedA.cssVariables = config.settingsGroupA.cssVariables;
            }
            updateSettingsGroupA(mergedA, fretboardId);
        } else if (!firstInstrumentKey) {
            // No config provided and no instrument - use defaults
            updateSettingsGroupA(defaultSettingsGroupA, fretboardId);
        }

        // Apply theme first (if exists), then settingsGroupB can override theme values
        if (firstThemeKey && config.themes[firstThemeKey]) {
            const firstTheme = config.themes[firstThemeKey];
            const themeB = {
                fretMarkers: firstTheme.fretMarkers,
                fretboardBindingDisplay: firstTheme.fretboardBindingDisplay,
                cssVariables: firstTheme.cssVariables || {},
                customCSS: firstTheme.customCSS
            };
            updateSettingsGroupB(themeB, fretboardId);
        }

        if (config.settingsGroupB) {
            // Merge non-CSS defaults with provided config
            // This will override any theme values that were just applied
            const mergedB = {
                fretMarkers: config.settingsGroupB.fretMarkers !== undefined ? config.settingsGroupB.fretMarkers : defaultSettingsGroupB.fretMarkers,
                fretboardBindingDisplay: config.settingsGroupB.fretboardBindingDisplay !== undefined ? config.settingsGroupB.fretboardBindingDisplay : defaultSettingsGroupB.fretboardBindingDisplay
            };
            // Only include cssVariables if explicitly provided
            if (config.settingsGroupB.cssVariables) {
                mergedB.cssVariables = config.settingsGroupB.cssVariables;
            }
            // Include customCSS if provided
            if (config.settingsGroupB.customCSS !== undefined) {
                mergedB.customCSS = config.settingsGroupB.customCSS;
            }
            updateSettingsGroupB(mergedB, fretboardId);
        } else if (!firstThemeKey) {
            // No config provided and no theme - use defaults
            updateSettingsGroupB(defaultSettingsGroupB, fretboardId);
        }

        if (config.settingsGroupC) {
            updateSettingsGroupC(config.settingsGroupC, true, fretboardId); // Skip regeneration during init
        } else {
            // No settingsGroupC provided - set fingering to empty array (no finger dots)
            // Apply other defaults needed for fretboard functionality
            const settingsGroupCWithoutFingering = JSON.parse(JSON.stringify(defaultSettingsGroupC));
            settingsGroupCWithoutFingering.fingering = []; // Explicitly set to empty - no dots
            updateSettingsGroupC(settingsGroupCWithoutFingering, true, fretboardId); // Skip regeneration during init
        }

        // Initialize dynamic strings (pass fretboardId so it uses the correct instance)
        initializeDynamicStrings(fretboardId);

        // Ensure FRET_MARKERS is set before generating frets
        // This is a safety check in case updateSettingsGroupB didn't set it
        if (!FRET_MARKERS || Object.keys(FRET_MARKERS).length === 0) {
            FRET_MARKERS = JSON.parse(JSON.stringify(defaultSettingsGroupB.fretMarkers));
            settingsGroupB.fretMarkers = JSON.parse(JSON.stringify(defaultSettingsGroupB.fretMarkers));
        }

        // Generate fret rows
        // Get fretboardId from instance
        const instance = fretboardInstances.get(fretboardId);
        const instanceFretboardId = instance ? instance.fretboardId : fretboardId;
        
        generateFretRows(false, instanceFretboardId);

        // Apply fret heights
        applyFretHeights(instanceFretboardId);

        // Apply JavaScript-only settings (fret indicators and binding display)
        applyFretIndicatorVisibility(fretboardId);
        applyFretboardBindingDisplay(fretboardId);

        // Apply hover dot template
        applyHoverDotTemplate(fretboardId);

        // Add dot interactivity
        addDotInteractivity(fretboardId);

        // Update break row
        updateFretboardBreakRow(fretboardId);

        // Display chord if provided in settingsGroupC (after all initialization is complete)
        if (config.settingsGroupC && config.settingsGroupC.fingering && config.settingsGroupC.fingering.length > 0) {
            displayChord(settingsGroupC, fretboardId);
        } else if (settingsGroupC.fingering && settingsGroupC.fingering.length > 0) {
            displayChord(settingsGroupC, fretboardId);
        } else if (!config.settingsGroupC) {
            // If settingsGroupC was not provided in init, ensure no finger dots are displayed
            clearChord(fretboardId);
        }

        // Hide all interval labels by default if there's no chord
        if (!CURRENT_CHORD_ROOT) {
            const wrapper = document.getElementById(getInstanceElementId(fretboardId, 'chord_builder_wrapper'));
            if (wrapper) {
                const allIntervalLabels = wrapper.querySelectorAll('.interval_indicator_label');
                allIntervalLabels.forEach(label => {
                    label.style.display = 'none';
                    label.textContent = '';
                    label.removeAttribute('data-interval');
                    label.classList.remove('active');
                });
            }
        }
        
        // Mark this instance as initialized (stored in instance data)
        instanceData.isInitialized = true;
        // Also set global flag for backward compatibility (but don't block other instances)
        isInitialized = true;
        
        console.log('Fretboard instance initialized:', fretboardId);

        // Set up message listener for iframe communication
        window.addEventListener('message', function(event) {
            const data = event.data;
            
            switch(data.type) {
                case 'requestChordLibrary':
                    if (window.parent && window.parent !== window) {
                        window.parent.postMessage({
                            type: 'syncChordLibrary',
                            chordLibrary: {}
                        }, '*');
                    }
                    break;
                    
                case 'selectChord':
                    if (data.chordConfig) {
                        displayChord(data.chordConfig);
                    }
                    break;
                    
                case 'clearChord':
                    // clearChord() without fretboardId will clear all (for backward compatibility)
                    clearChord();
                    CURRENT_CHORD_CONFIG = null;
                    CURRENT_CHORD_ROOT = null;
                    break;
                    
                case 'updateDisplayMode':
                    DOT_TEXT_MODE = data.value;
                    if (CURRENT_CHORD_CONFIG) {
                        redrawChordOnly(CURRENT_CHORD_CONFIG);
                    }
                    break;
                    
                case 'updateStringType':
                    STRING_TYPE = data.value;
                    const chordBuilderWrapper = document.getElementById('chord_builder_wrapper');
                    if (chordBuilderWrapper) {
                        const existingFrets = chordBuilderWrapper.querySelectorAll('[id^="chord_builder_fret_row_wrapper_"]:not(#chord_builder_fret_row_wrapper_0)');
                        existingFrets.forEach(fret => fret.remove());
                    }
                    initializeDynamicStrings();
                    generateFretRows();
                    applyFretHeights();
                    applyHoverDotTemplate();
                    addDotInteractivity();
                    if (CURRENT_CHORD_CONFIG) {
                        displayChord(CURRENT_CHORD_CONFIG);
                    }
                    break;
                    
                case 'updateStartFret':
                    START_FRET = data.value;
                    document.documentElement.style.setProperty('--start-fret', START_FRET);
                    generateFretRows();
                    applyFretHeights();
                    break;
                    
                case 'updateNumFrets':
                    document.documentElement.style.setProperty('--num-frets', data.value);
                    generateFretRows();
                    applyFretHeights();
                    break;
                    
                case 'updateNumStrings':
                    document.documentElement.style.setProperty('--num-strings', data.value);
                    let numStringsWrapper = document.getElementById('chord_builder_wrapper');
                    if (numStringsWrapper) {
                        const existingFrets = numStringsWrapper.querySelectorAll('[id^="chord_builder_fret_row_wrapper_"]:not(#chord_builder_fret_row_wrapper_0)');
                        existingFrets.forEach(fret => fret.remove());
                    }
                    initializeDynamicStrings();
                    generateFretRows();
                    applyFretHeights();
                    applyHoverDotTemplate();
                    addDotInteractivity();
                    if (CURRENT_CHORD_CONFIG) {
                        redrawChordOnly(CURRENT_CHORD_CONFIG);
                    }
                    break;
                    
                case 'updateCSSVariable':
                    if (data.variable && data.value !== undefined) {
                        document.documentElement.style.setProperty(data.variable, data.value);
                        
                        if (data.variable === '--num-frets' || data.variable === '--start-fret') {
                            generateFretRows();
                            applyFretHeights();
                            applyHoverDotTemplate();
                            addDotInteractivity();
                            if (CURRENT_CHORD_CONFIG) {
                                redrawChordOnly(CURRENT_CHORD_CONFIG);
                            }
                        }
                    }
                    break;
            }
        });

        console.log('Fretboard initialized');
    }

    // ============================================================================
    // IMPORT CONFIG FUNCTION
    // ============================================================================

    /**
     * Completely resets and applies imported configuration
     * This function resets all state to defaults, then applies the imported settings
     * @param {Object} config - Configuration object with settingsGroupA, settingsGroupB, settingsGroupC
     * @param {string} fretboardId - Optional fretboard ID (will be detected if not provided)
     */
    async function applyImportedConfig(config, fretboardId = null) {
        console.log('applyImportedConfig: Starting complete reinitialization', config);
        
        // Try to get fretboardId if not provided
        if (!fretboardId) {
            const anyWrapper = document.querySelector('[id$="_chord_builder_wrapper"]');
            if (anyWrapper && anyWrapper.id) {
                const match = anyWrapper.id.match(/^(.+)_chord_builder_wrapper$/);
                if (match) fretboardId = match[1];
            }
        }
        
        if (!fretboardId) {
            console.warn('applyImportedConfig: Could not determine fretboardId');
            return;
        }
        
        // Get the existing instance to find containerId
        const instance = fretboardInstances.get(fretboardId);
        if (!instance) {
            console.error('applyImportedConfig: No instance found for', fretboardId);
            return;
        }
        
        const containerId = instance.containerId || 'fretboard';
        
        // Build the init config with imported settings
        const initConfig = {
            fretboardId: fretboardId,
            containerId: containerId,
            cssPath: 'fretboard.css', // Use default CSS path
            settingsGroupA: config.settingsGroupA || null,
            settingsGroupB: config.settingsGroupB || null,
            settingsGroupC: config.settingsGroupC || null
        };
        
        console.log('applyImportedConfig: Calling init with config', initConfig);
        
        // Reinitialize the fretboard with imported settings
        // This will completely reset and apply all settings, including displaying the chord
        await init(initConfig);
        
        console.log('applyImportedConfig: Complete');
    }

    // ============================================================================
    // PUBLIC API
    // ============================================================================

    // Get instance by ID
    function getInstance(fretboardId) {
        return fretboardInstances.get(fretboardId);
    }
    
    // Get instance by container ID
    function getInstanceByContainer(containerId) {
        for (const [id, instance] of fretboardInstances.entries()) {
            if (instance.containerId === containerId) {
                return instance;
            }
        }
        return null;
    }

    // Get themes for a fretboard
    function getThemes(fretboardId = null) {
        // Try to get fretboardId if not provided
        if (!fretboardId) {
            const anyWrapper = document.querySelector('[id$="_chord_builder_wrapper"]');
            if (anyWrapper && anyWrapper.id) {
                const match = anyWrapper.id.match(/^(.+)_chord_builder_wrapper$/);
                if (match) fretboardId = match[1];
            }
        }
        
        if (!fretboardId) {
            console.warn('getThemes: Could not determine fretboardId');
            return null;
        }
        
        const instance = fretboardInstances.get(fretboardId);
        if (!instance) {
            console.error('getThemes: No instance found for', fretboardId);
            return null;
        }
        
        return instance.themes;
    }
    
    // Get active theme for a fretboard
    function getActiveTheme(fretboardId = null) {
        // Try to get fretboardId if not provided
        if (!fretboardId) {
            const anyWrapper = document.querySelector('[id$="_chord_builder_wrapper"]');
            if (anyWrapper && anyWrapper.id) {
                const match = anyWrapper.id.match(/^(.+)_chord_builder_wrapper$/);
                if (match) fretboardId = match[1];
            }
        }
        
        if (!fretboardId) {
            console.warn('getActiveTheme: Could not determine fretboardId');
            return null;
        }
        
        const instance = fretboardInstances.get(fretboardId);
        if (!instance) {
            console.error('getActiveTheme: No instance found for', fretboardId);
            return null;
        }
        
        return instance.activeTheme;
    }
    
    // Get instruments for a fretboard
    function getInstruments(fretboardId = null) {
        // Try to get fretboardId if not provided
        if (!fretboardId) {
            const anyWrapper = document.querySelector('[id$="_chord_builder_wrapper"]');
            if (anyWrapper && anyWrapper.id) {
                const match = anyWrapper.id.match(/^(.+)_chord_builder_wrapper$/);
                if (match) fretboardId = match[1];
            }
        }
        
        if (!fretboardId) {
            console.warn('getInstruments: Could not determine fretboardId');
            return null;
        }
        
        const instance = fretboardInstances.get(fretboardId);
        if (!instance) {
            console.error('getInstruments: No instance found for', fretboardId);
            return null;
        }
        
        return instance.instruments;
    }
    
    // Get active instrument for a fretboard
    function getActiveInstrument(fretboardId = null) {
        // Try to get fretboardId if not provided
        if (!fretboardId) {
            const anyWrapper = document.querySelector('[id$="_chord_builder_wrapper"]');
            if (anyWrapper && anyWrapper.id) {
                const match = anyWrapper.id.match(/^(.+)_chord_builder_wrapper$/);
                if (match) fretboardId = match[1];
            }
        }
        
        if (!fretboardId) {
            console.warn('getActiveInstrument: Could not determine fretboardId');
            return null;
        }
        
        const instance = fretboardInstances.get(fretboardId);
        if (!instance) {
            console.error('getActiveInstrument: No instance found for', fretboardId);
            return null;
        }
        
        return instance.activeInstrument;
    }

    window.Fretboard = {
        // Initialization
        init: init,
        
        // Instance management
        getInstance: getInstance,
        getInstanceByContainer: getInstanceByContainer,
        getAllInstances: () => Array.from(fretboardInstances.values()),

        // Settings update functions
        updateSettingsGroupA: updateSettingsGroupA,
        updateSettingsGroupB: updateSettingsGroupB,
        updateSettingsGroupC: updateSettingsGroupC,
        applyImportedConfig: applyImportedConfig,
        
        // Theme functions
        applyTheme: applyTheme,
        getThemes: getThemes,
        getActiveTheme: getActiveTheme,

        // Instrument functions
        applyInstrument: applyInstrument,
        getInstruments: getInstruments,
        getActiveInstrument: getActiveInstrument,

        // Chord display functions
        displayChord: displayChord,
        clearChord: clearChord,
        redrawChordOnly: redrawChordOnly,

        // Utility functions
        toggleDotTextMode: function() {
            DOT_TEXT_MODE = DOT_TEXT_MODE === 'note' ? 'finger' : 'note';
            updateAllDotText();
            console.log('Dot text mode:', DOT_TEXT_MODE);
        },
        setChordRoot: function(rootNote) {
            CURRENT_CHORD_ROOT = rootNote;
            console.log('Chord root set to:', rootNote);
            updateAllIntervals();
        },
        getNoteAtFret: getNoteAtFret,
        getStringNote: getStringNote,
        getInterval: getInterval,

        // Configuration functions
        setStartFret: function(startFret) {
            START_FRET = startFret;
            console.log('Start fret set to:', startFret);
        },
        setChordConfiguration: setChordConfiguration,

        // State access (read-only)
        getSettingsGroupA: function() {
            return JSON.parse(JSON.stringify(settingsGroupA));
        },
        getSettingsGroupB: function() {
            return JSON.parse(JSON.stringify(settingsGroupB));
        },
        getSettingsGroupC: function() {
            return JSON.parse(JSON.stringify(settingsGroupC));
        },
        getFingeringFromDotState: getFingeringFromDotState,
        getTuning: function() {
            return JSON.parse(JSON.stringify(TUNING));
        },
        getDotTextMode: function() {
            return DOT_TEXT_MODE;
        },
        getFretMarkers: function() {
            return JSON.parse(JSON.stringify(FRET_MARKERS));
        }
    };

    // Alias function for convenience (matches user's original request format)
    window.initializeFretboard = function(containerId, config) {
        config = config || {};
        config.containerId = containerId;
        return window.Fretboard.init(config);
    };

    // ============================================================================
    // AUTO-INITIALIZATION WITH DEFAULTS
    // ============================================================================

    /**
     * Default configuration for auto-initialization
     * These match the defaults shown in fretboard_example.html
     */
    // Auto-init config - CSS is the source of truth, only provide non-CSS values
    const defaultAutoInitConfig = {
        containerId: 'chord_builder_wrapper', // Default container ID
        cssPath: 'fretboard.css',
        settingsGroupA: {
            dotTextMode: 'note',
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
            }
            // No cssVariables - CSS file is the source of truth
        },
        // No settingsGroupB - CSS file is the source of truth
        // default chord commented out for posterity. don't remove
        // settingsGroupC: {
        //     name: "G Major",
        //     root: "G",
        //     startFret: 1,
        //     numFrets: 4,
        //     numStrings: 6,
        //     stringType: '1',
        //     tuning: {
        //         1: 'E',
        //         2: 'A',
        //         3: 'D',
        //         4: 'G',
        //         5: 'B',
        //         6: 'E'
        //     },
        //     fingering: [
        //         { string: 1, fret: 3, finger: 2 },
        //         { string: 2, fret: 2, finger: 1 },
        //         { string: 3, fret: 0, finger: 0 },
        //         { string: 4, fret: 0, finger: 0 },
        //         { string: 5, fret: 0, finger: 0 },
        //         { string: 6, fret: 3, finger: 3 }
        //     ]
        // }
    };

    /**
     * Auto-initialize if DOM is ready and no manual init has been called
     */
    function attemptAutoInit() {
        // Mark that we've attempted auto-init
        autoInitAttempted = true;

        // Find all elements with data-fretboard="full" attribute
        const fretboardElements = document.querySelectorAll('[data-fretboard="full"]');
        
        // If no elements found, don't auto-init
        if (fretboardElements.length === 0) {
            return;
        }

        // Initialize a fretboard for each element found
        fretboardElements.forEach(element => {
            // Use the element's id as the containerId
            const containerId = element.id;
            if (!containerId) {
                console.warn('Fretboard element with data-fretboard="full" must have an id attribute');
                return;
            }
            
            // Get or generate fretboardId from data-fretboard-id attribute
            let fretboardId = element.dataset.fretboardId;
            if (!fretboardId) {
                // Generate a unique ID based on containerId
                fretboardId = containerId + '-' + Date.now();
            }
            
            // Check if this instance was manually initialized or already exists
            if (manuallyInitialized.has(fretboardId)) {
                console.log('Fretboard instance was manually initialized:', fretboardId, '- skipping auto-init');
                return;
            }
            
            const existingInstance = fretboardInstances.get(fretboardId);
            if (existingInstance && existingInstance.isInitialized) {
                console.log('Fretboard instance already exists for:', fretboardId, '- skipping auto-init');
                return;
            }
            
            // Check if there's a stored config from a script with apply_to_fretboard attribute
            // First check by fretboardId directly
            let storedConfig = scriptInitConfigs.get(fretboardId);
            
            // If not found by fretboardId, check script tags with apply_to_fretboard matching this element's data-fretboard-id
            if (!storedConfig) {
                const scripts = document.querySelectorAll('script[apply_to_fretboard]');
                for (const script of scripts) {
                    const scriptTargetId = script.getAttribute('apply_to_fretboard');
                    // Check if the script's target matches this element's data-fretboard-id
                    if (scriptTargetId === fretboardId) {
                        storedConfig = scriptInitConfigs.get(scriptTargetId);
                        if (storedConfig) {
                            console.log('Found stored config by script apply_to_fretboard:', scriptTargetId);
                            break;
                        }
                    }
                }
            }
            
            // Also check all stored configs to see if any have a matching containerId
            // This handles cases where apply_to_fretboard doesn't match fretboardId exactly
            if (!storedConfig) {
                for (const [key, config] of scriptInitConfigs.entries()) {
                    if (config.containerId === containerId) {
                        storedConfig = config;
                        console.log('Found stored config by containerId:', containerId);
                        break;
                    }
                }
            }
            
            // Use stored config if found, otherwise use defaultAutoInitConfig
            let autoConfig;
            if (storedConfig) {
                // Merge stored config with defaults to ensure all required properties exist
                autoConfig = JSON.parse(JSON.stringify(defaultAutoInitConfig));
                // Deep merge stored config over defaults
                if (storedConfig.settingsGroupA) {
                    autoConfig.settingsGroupA = { ...autoConfig.settingsGroupA, ...storedConfig.settingsGroupA };
                }
                if (storedConfig.settingsGroupB) {
                    autoConfig.settingsGroupB = { ...autoConfig.settingsGroupB, ...storedConfig.settingsGroupB };
                }
                if (storedConfig.settingsGroupC) {
                    autoConfig.settingsGroupC = { ...autoConfig.settingsGroupC, ...storedConfig.settingsGroupC };
                }
                // Override containerId and fretboardId
                autoConfig.containerId = containerId;
                autoConfig.fretboardId = fretboardId;
                // Preserve cssPath if provided in stored config
                if (storedConfig.cssPath) {
                    autoConfig.cssPath = storedConfig.cssPath;
                }
                console.log('Auto-initializing with stored script config for fretboardId:', fretboardId);
            } else {
                // Use default config
                autoConfig = JSON.parse(JSON.stringify(defaultAutoInitConfig));
                autoConfig.containerId = containerId;
                autoConfig.fretboardId = fretboardId;
                console.log('Auto-initializing with default config for fretboardId:', fretboardId);
            }
            
            console.log('Auto-initializing fretboard in container:', containerId, 'with fretboardId:', fretboardId);
            
            // Initialize each instance independently (don't await to allow parallel initialization)
            window.Fretboard.init(autoConfig).catch(err => {
                console.error('Error initializing fretboard instance:', fretboardId, err);
            });
        });
    }

    // Auto-initialize when DOM is ready
    // Use a small delay to allow manual init() calls in the same script block to run first
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            // Small delay to allow manual init() calls
            setTimeout(attemptAutoInit, 10);
        });
    } else {
        // DOM is already ready, but wait a tick to allow manual init to happen first
        setTimeout(attemptAutoInit, 10);
    }

})();

