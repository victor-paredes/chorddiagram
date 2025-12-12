// Fretboard Control Panel
// This file provides a side panel interface for controlling all fretboard variables in real-time

(function() {
    'use strict';
    
    // Store control panel instances by target fretboard ID
    // Now stores input references for bidirectional sync
    const controlPanelInstances = new Map(); // Map<fretboardId, {element, inputRefs, syncTimer, lastFingeringState}>
    
    // Initialize all control panels found in the DOM
    function initAllControlPanels() {
        const controlPanels = document.querySelectorAll('#fretboard-control-panel');
        
        controlPanels.forEach(panelElement => {
            const targetId = panelElement.getAttribute('fretboard_target');
            if (!targetId) {
                console.warn('Fretboard Control Panel: Missing fretboard_target attribute on', panelElement);
                return;
            }
            
            // Find the corresponding fretboard instance
            const fretboardInstance = window.Fretboard && window.Fretboard.getInstance 
                ? window.Fretboard.getInstance(targetId)
                : null;
            
            if (!fretboardInstance) {
                console.warn('Fretboard Control Panel: Fretboard instance not found for target:', targetId);
                // Wait a bit and try again
                setTimeout(() => {
                    initControlPanelForTarget(panelElement, targetId);
                }, 500);
                return;
            }
            
            initControlPanelForTarget(panelElement, targetId, fretboardInstance.config);
        });
    }
    
    // Get current state from fretboard (always reads live state)
    function getCurrentFretboardState(targetId) {
        if (!window.Fretboard) {
            return null;
        }
        
        // Get the stored state
        const state = {
            settingsGroupA: window.Fretboard.getSettingsGroupA ? window.Fretboard.getSettingsGroupA() : {},
            settingsGroupB: window.Fretboard.getSettingsGroupB ? window.Fretboard.getSettingsGroupB() : {},
            settingsGroupC: window.Fretboard.getSettingsGroupC ? window.Fretboard.getSettingsGroupC() : {}
        };
        
        // Update settingsGroupC.fingering with the current dot state from the DOM
        // This ensures the export reflects what's actually displayed on the fretboard
        if (window.Fretboard.getFingeringFromDotState) {
            const currentFingering = window.Fretboard.getFingeringFromDotState(targetId);
            if (currentFingering && Array.isArray(currentFingering)) {
                state.settingsGroupC.fingering = currentFingering;
            }
        }
        
        return state;
    }
    
    // Initialize a single control panel for a specific target
    function initControlPanelForTarget(panelElement, targetId, config) {
        if (!config) {
            const fretboardInstance = window.Fretboard && window.Fretboard.getInstance 
                ? window.Fretboard.getInstance(targetId)
                : null;
            if (!fretboardInstance) {
                console.warn('Fretboard Control Panel: No config available for target:', targetId);
                return;
            }
            config = fretboardInstance.config;
        }
        
        try {
            // Get current state from fretboard
            const currentState = getCurrentFretboardState(targetId);
            if (!currentState) {
                console.warn('Fretboard Control Panel: Could not get current state for target:', targetId);
                return;
            }
            
            // IMPORTANT: Override fingering in state with actual dots from DOM (source of truth)
            // This ensures we don't use stale fingering data from settingsGroupC
            if (window.Fretboard && window.Fretboard.getFingeringFromDotState) {
                const actualFingering = window.Fretboard.getFingeringFromDotState(targetId) || [];
                if (currentState.settingsGroupC) {
                    currentState.settingsGroupC.fingering = actualFingering;
                }
            }
            
            // Store instance with input references
            const inputRefs = {};
            controlPanelInstances.set(targetId, {
                element: panelElement,
                inputRefs: inputRefs,
                targetId: targetId,
                syncTimer: null,
                isSyncing: false, // Prevent circular updates
                userEditing: false, // Track if user is actively editing
                editingKey: null, // Track which key is being edited
                lastFingeringState: null // Cache for fingering state to optimize sync
            });
            
            console.log('Fretboard Control Panel: Initializing for target', targetId);
            
            // Build the control panel (will populate inputRefs)
            buildControlPanel(panelElement, currentState, targetId, inputRefs);
            
            // Start periodic sync from fretboard to panel
            startPanelSync(targetId);
        } catch (error) {
            console.error('Fretboard Control Panel: Error initializing for target', targetId, error);
        }
    }
    
    // Start periodic sync from fretboard to panel
    function startPanelSync(targetId) {
        const instance = controlPanelInstances.get(targetId);
        if (!instance) return;
        
        // Clear any existing timer
        if (instance.syncTimer) {
            clearInterval(instance.syncTimer);
        }
        
        // Sync every 200ms to catch changes (reduced from 500ms for faster updates)
        // Only sync if not currently syncing and not in the middle of an update
        instance.syncTimer = setInterval(() => {
            if (!instance.isSyncing) {
                syncPanelFromFretboard(targetId);
            }
        }, 200);
    }
    
    // Stop periodic sync
    function stopPanelSync(targetId) {
        const instance = controlPanelInstances.get(targetId);
        if (instance && instance.syncTimer) {
            clearInterval(instance.syncTimer);
            instance.syncTimer = null;
        }
    }
    
    function togglePanel() {
        const panel = document.getElementById('control-panel');
        if (panel) {
            panel.classList.toggle('hidden');
        }
    }
    
    function createControlGroup(label, input, variableName = null) {
        const group = document.createElement('div');
        group.className = 'control-group';
        const labelEl = document.createElement('label');
        labelEl.textContent = label;
        group.appendChild(labelEl);
        
        // Add variable name in small grey text if provided
        if (variableName) {
            const varNameEl = document.createElement('div');
            varNameEl.className = 'variable-name';
            varNameEl.textContent = variableName;
            group.appendChild(varNameEl);
        }
        
        group.appendChild(input);
        return group;
    }
    
    function createInputWithArrows(input, step = 1) {
        // Parse value to extract number and unit
        function parseValue(value) {
            if (!value || typeof value !== 'string') return { number: 0, unit: 'px' };
            const match = value.match(/^([-\d.]+)(.*)$/);
            if (match) {
                return { number: parseFloat(match[1]) || 0, unit: match[2] || 'px' };
            }
            return { number: 0, unit: 'px' };
        }
        
        // Create wrapper
        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'center';
        
        // Add input to wrapper
        wrapper.appendChild(input);
        
        // Create arrow buttons container
        const arrowsContainer = document.createElement('div');
        arrowsContainer.style.display = 'flex';
        arrowsContainer.style.flexDirection = 'column';
        arrowsContainer.style.position = 'absolute';
        arrowsContainer.style.right = '4px';
        arrowsContainer.style.height = '100%';
        arrowsContainer.style.justifyContent = 'center';
        arrowsContainer.style.pointerEvents = 'none';
        
        // Create up arrow
        const upArrow = document.createElement('button');
        upArrow.type = 'button';
        upArrow.innerHTML = '▲';
        upArrow.style.cssText = 'border: none; background: transparent; cursor: pointer; padding: 2px 4px; font-size: 10px; line-height: 1; pointer-events: auto; color: #666;';
        upArrow.addEventListener('mouseenter', () => upArrow.style.color = '#333');
        upArrow.addEventListener('mouseleave', () => upArrow.style.color = '#666');
        upArrow.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const parsed = parseValue(input.value);
            const newNumber = parsed.number + step;
            input.value = newNumber + parsed.unit;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        
        // Create down arrow
        const downArrow = document.createElement('button');
        downArrow.type = 'button';
        downArrow.innerHTML = '▼';
        downArrow.style.cssText = 'border: none; background: transparent; cursor: pointer; padding: 2px 4px; font-size: 10px; line-height: 1; pointer-events: auto; color: #666;';
        downArrow.addEventListener('mouseenter', () => downArrow.style.color = '#333');
        downArrow.addEventListener('mouseleave', () => downArrow.style.color = '#666');
        downArrow.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const parsed = parseValue(input.value);
            const newNumber = Math.max(0, parsed.number - step);
            input.value = newNumber + parsed.unit;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        
        arrowsContainer.appendChild(upArrow);
        arrowsContainer.appendChild(downArrow);
        wrapper.appendChild(arrowsContainer);
        
        // Add padding to input to make room for arrows
        input.style.paddingRight = '24px';
        
        return wrapper;
    }
    
    function createCollapsibleSection(title, contentCallback, startCollapsed = false) {
        const section = document.createElement('div');
        section.className = 'collapsible-section';
        if (startCollapsed) {
            section.classList.add('collapsed');
        }
        
        const toggle = document.createElement('div');
        toggle.className = 'section-toggle';
        toggle.innerHTML = `<span class="toggle-icon">${startCollapsed ? '▶' : '▼'}</span> ${title}`;
        toggle.addEventListener('click', () => {
            section.classList.toggle('collapsed');
            const icon = toggle.querySelector('.toggle-icon');
            icon.textContent = section.classList.contains('collapsed') ? '▶' : '▼';
        });
        
        const content = document.createElement('div');
        content.className = 'section-content';
        
        if (contentCallback) {
            contentCallback(content);
        }
        
        section.appendChild(toggle);
        section.appendChild(content);
        return section;
    }
    
    function createSelect(name, options, value, onChange) {
        const select = document.createElement('select');
        select.id = name;
        options.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            if (opt.value === value) option.selected = true;
            select.appendChild(option);
        });
        select.addEventListener('change', onChange);
        return select;
    }
    
    function createInput(type, name, value, onChange, placeholder = '', min = null, max = null, step = null) {
        const input = document.createElement('input');
        input.type = type;
        input.id = name;
        input.value = value;
        input.placeholder = placeholder;
        
        // For number and range inputs, set min, max, and step if provided
        if (type === 'number' || type === 'range') {
            if (min !== null) input.min = min;
            if (max !== null) input.max = max;
            if (step !== null) input.step = step;
            input.addEventListener('input', onChange);
        } else {
            input.addEventListener('change', onChange);
        }
        return input;
    }
    
    // Helper function to parse color and extract rgba components
    function parseColorValue(value) {
        let r = 0, g = 0, b = 0, a = 1;
        
        if (!value || !value.trim()) {
            return { r, g, b, a, hex: '#000000', rgba: 'rgba(0, 0, 0, 1)' };
        }
        
        const trimmed = value.trim();
        
        // Handle rgba format
        const rgbaMatch = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (rgbaMatch) {
            r = parseInt(rgbaMatch[1]);
            g = parseInt(rgbaMatch[2]);
            b = parseInt(rgbaMatch[3]);
            a = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1;
        } 
        // Handle hex format
        else if (trimmed.startsWith('#')) {
            const hex = trimmed.replace('#', '');
            if (hex.length === 3) {
                r = parseInt(hex[0] + hex[0], 16);
                g = parseInt(hex[1] + hex[1], 16);
                b = parseInt(hex[2] + hex[2], 16);
                a = 1; // Hex colors default to full opacity
            } else if (hex.length === 6) {
                r = parseInt(hex.substring(0, 2), 16);
                g = parseInt(hex.substring(2, 4), 16);
                b = parseInt(hex.substring(4, 6), 16);
                a = 1; // Hex colors default to full opacity
            } else if (hex.length === 8) {
                // RGBA hex format (#RRGGBBAA)
                r = parseInt(hex.substring(0, 2), 16);
                g = parseInt(hex.substring(2, 4), 16);
                b = parseInt(hex.substring(4, 6), 16);
                a = parseInt(hex.substring(6, 8), 16) / 255;
            }
        }
        
        const hex = '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
        const rgba = `rgba(${r}, ${g}, ${b}, ${a})`;
        
        return { r, g, b, a, hex, rgba };
    }
    
    function createColorInput(name, value, onChange) {
        // Extract hex color from gradient or use as-is
        let hexValue = value;
        if (value && value.trim()) {
            if (value.trim().startsWith('#')) {
                hexValue = value.trim();
            } else if (value.includes('rgba') || value.includes('rgb(')) {
                // Try to extract from rgba or rgb
                const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                if (match) {
                    const r = parseInt(match[1]).toString(16).padStart(2, '0');
                    const g = parseInt(match[2]).toString(16).padStart(2, '0');
                    const b = parseInt(match[3]).toString(16).padStart(2, '0');
                    hexValue = '#' + r + g + b;
                } else {
                    hexValue = '#000000';
                }
            } else {
                // If it's not a recognized format, try to use it as-is (might be a hex without #)
                hexValue = value.trim().startsWith('#') ? value.trim() : '#' + value.trim().replace('#', '');
            }
        } else {
            hexValue = '#000000';
        }
        return createInput('color', name, hexValue, onChange);
    }
    
    // Create color input with opacity slider
    function createColorInputWithOpacity(name, value, onChange, swatch = null) {
        const container = document.createElement('div');
        container.className = 'color-input-with-opacity';
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.gap = '8px';
        container.style.width = '100%';
        
        // Parse the color value
        let currentParsed = parseColorValue(value);
        
        // Create color picker
        const colorInput = createInput('color', `${name}_color`, currentParsed.hex, (e) => {
            const newHex = e.target.value;
            // Convert hex to rgb
            const r = parseInt(newHex.substring(1, 3), 16);
            const g = parseInt(newHex.substring(3, 5), 16);
            const b = parseInt(newHex.substring(5, 7), 16);
            // Update current parsed values
            currentParsed = { r, g, b, a: currentParsed.a };
            const newRgba = `rgba(${r}, ${g}, ${b}, ${currentParsed.a})`;
            if (onChange) {
                // Create a synthetic event object
                const syntheticEvent = { target: { value: newRgba } };
                onChange(syntheticEvent);
            }
            if (swatch) swatch.updateSwatch(newRgba);
        });
        colorInput.style.flexShrink = '0';
        
        // Create opacity slider
        const opacityContainer = document.createElement('div');
        opacityContainer.style.display = 'flex';
        opacityContainer.style.alignItems = 'center';
        opacityContainer.style.gap = '4px';
        opacityContainer.style.flex = '1';
        
        const opacityInput = createInput('range', `${name}_opacity`, currentParsed.a, (e) => {
            const newA = parseFloat(e.target.value);
            // Get current color from color input
            const currentHex = colorInput.value;
            const r = parseInt(currentHex.substring(1, 3), 16);
            const g = parseInt(currentHex.substring(3, 5), 16);
            const b = parseInt(currentHex.substring(5, 7), 16);
            // Update current parsed values
            currentParsed = { r, g, b, a: newA };
            const newRgba = `rgba(${r}, ${g}, ${b}, ${newA})`;
            if (onChange) {
                const syntheticEvent = { target: { value: newRgba } };
                onChange(syntheticEvent);
            }
            if (swatch) swatch.updateSwatch(newRgba);
            opacityValueDisplay.textContent = Math.round(newA * 100) + '%';
        }, '', 0, 1, 0.01);
        opacityInput.style.flex = '1';
        opacityInput.style.minWidth = '60px';
        
        const opacityValueDisplay = document.createElement('span');
        opacityValueDisplay.className = 'opacity-value';
        opacityValueDisplay.textContent = Math.round(currentParsed.a * 100) + '%';
        opacityValueDisplay.style.fontSize = '11px';
        opacityValueDisplay.style.color = '#666';
        opacityValueDisplay.style.minWidth = '35px';
        opacityValueDisplay.style.textAlign = 'right';
        
        opacityContainer.appendChild(opacityInput);
        opacityContainer.appendChild(opacityValueDisplay);
        
        container.appendChild(colorInput);
        container.appendChild(opacityContainer);
        
        // Store references for updating
        container.updateColor = (newValue) => {
            const newParsed = parseColorValue(newValue);
            currentParsed = newParsed;
            colorInput.value = newParsed.hex;
            opacityInput.value = newParsed.a;
            opacityValueDisplay.textContent = Math.round(newParsed.a * 100) + '%';
        };
        
        // Store references to inputs for syncing
        container.colorInput = colorInput;
        container.opacityInput = opacityInput;
        
        return container;
    }
    
    // Helper function to get current CSS variable value from DOM
    function getCurrentCSSVariable(varName) {
        try {
            const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
            return value || '';
        } catch (e) {
            return '';
        }
    }
    
    // Sync panel inputs from current fretboard state
    function syncPanelFromFretboard(targetId) {
        const instance = controlPanelInstances.get(targetId);
        if (!instance || !instance.inputRefs || instance.isSyncing) return;
        
        // Don't sync if user is actively typing or has any input focused
        const activeElement = document.activeElement;
        const isInputFocused = activeElement && (
            activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'SELECT' ||
            activeElement.tagName === 'TEXTAREA'
        );
        
        if (isInputFocused) return; // Don't sync while user is typing
        
        const state = getCurrentFretboardState(targetId);
        if (!state) return;
        
        instance.isSyncing = true; // Prevent circular updates
        
        try {
            const refs = instance.inputRefs;
            const groupA = state.settingsGroupA || {};
            const groupB = state.settingsGroupB || {};
            const groupC = state.settingsGroupC || {};
            
            // Sync Settings Group A
            if (refs.dotTextMode && groupA.dotTextMode !== undefined) {
                if (refs.dotTextMode !== activeElement && refs.dotTextMode.value !== groupA.dotTextMode) {
                    refs.dotTextMode.value = groupA.dotTextMode;
                }
            }
            if (refs.showFretIndicators && groupA.showFretIndicators !== undefined) {
                if (refs.showFretIndicators !== activeElement && refs.showFretIndicators.value !== groupA.showFretIndicators) {
                    refs.showFretIndicators.value = groupA.showFretIndicators;
                }
            }
            
            // Sync CSS variables for Group A
            if (groupA.cssVariables && refs.cssVarsA) {
                Object.keys(groupA.cssVariables).forEach(key => {
                    const input = refs.cssVarsA[key];
                    if (input && input !== activeElement && input.value !== groupA.cssVariables[key]) {
                        input.value = groupA.cssVariables[key];
                    }
                });
            }
            
            // Sync string color inputs (stored in Group B cssVariables)
            if (groupB.cssVariables && refs.stringColorInputs) {
                Object.keys(refs.stringColorInputs).forEach(stringNum => {
                    const stringNumInt = parseInt(stringNum);
                    const cssVarName = stringNumInt <= 6 ? `--string-${stringNumInt}-default-color` : `--string-${stringNumInt}-color`;
                    const colorValue = groupB.cssVariables[cssVarName];
                    
                    if (colorValue !== undefined && colorValue !== null) {
                        const input = refs.stringColorInputs[stringNum];
                        if (input && input !== document.activeElement && input.value !== colorValue) {
                            input.value = colorValue;
                            // Update swatch
                            if (refs.stringColorSwatches && refs.stringColorSwatches[stringNum]) {
                                refs.stringColorSwatches[stringNum].updateSwatch(colorValue);
                            }
                        }
                    }
                });
            }
            
            // Sync CSS variables for Group B
            // Only sync if we have saved values in settingsGroupB.cssVariables
            // Don't read from computed CSS as that would overwrite user changes with defaults
            // Don't sync if user is actively editing or if any color input is focused
            const anyColorInputFocused = refs.cssVarsB && Object.values(refs.cssVarsB).some(input => input && input === document.activeElement);
            
            if (groupB.cssVariables && refs.cssVarsB && !instance.userEditing && !anyColorInputFocused) {
                Object.keys(groupB.cssVariables).forEach(key => {
                    // Skip the input that user is currently editing
                    if (instance.editingKey === key) return;
                    
                    const input = refs.cssVarsB[key];
                    if (input && groupB.cssVariables[key] !== undefined && groupB.cssVariables[key] !== null && groupB.cssVariables[key] !== '') {
                        // Only update if the saved value is different from current input value
                        // And the input is not currently focused
                        if (input !== document.activeElement) {
                            let valueToSet = groupB.cssVariables[key];
                            
                            // Check if this is a color input container with opacity
                            if (input.updateColor) {
                                // It's a color input with opacity - use the updateColor method
                                if (input.updateColor) {
                                    input.updateColor(valueToSet);
                                    // Update swatch
                                    if (refs.swatchesB && refs.swatchesB[key]) {
                                        refs.swatchesB[key].updateSwatch(valueToSet);
                                    }
                                }
                            } 
                            // For image URLs, extract URL from url("...") format for display
                            else if ((key === '--main-fret-area-bg-image' || key === '--marker-dot-background-image') && valueToSet && valueToSet.startsWith('url(')) {
                                const match = valueToSet.match(/url\(["']?([^"']+)["']?\)/);
                                if (match) {
                                    valueToSet = match[1];
                                }
                                if (input.value !== valueToSet) {
                                    input.value = valueToSet;
                                }
                            } else if (key === '--marker-dot-background-image' && (valueToSet === 'no-dot-image' || valueToSet === 'no-image' || valueToSet === '')) {
                                valueToSet = '';
                                if (input.value !== valueToSet) {
                                    input.value = valueToSet;
                                }
                            } else {
                                // Regular text input
                                if (input.value !== valueToSet) {
                                    input.value = valueToSet;
                                    // Update swatch with whatever is now in the input
                                    if (refs.swatchesB && refs.swatchesB[key]) {
                                        refs.swatchesB[key].updateSwatch(input.value);
                                    }
                                }
                            }
                        }
                    }
                });
            }
            
            // Sync theme selector if it exists
            if (refs.themeSelector) {
                const instance = window.Fretboard && window.Fretboard.getInstance 
                    ? window.Fretboard.getInstance(targetId)
                    : null;
                if (instance && instance.activeTheme) {
                    const activeTheme = instance.activeTheme;
                    if (refs.themeSelector !== activeElement && refs.themeSelector.value !== activeTheme) {
                        refs.themeSelector.value = activeTheme;
                    }
                }
            }
            
            // Sync instrument selector if it exists
            if (refs.instrumentSelector) {
                const instance = window.Fretboard && window.Fretboard.getInstance 
                    ? window.Fretboard.getInstance(targetId)
                    : null;
                if (instance) {
                    // Get instruments to determine first instrument key as default
                    const instruments = instance.instruments || (instance.config && instance.config.instruments);
                    const firstInstrumentKey = instruments && Object.keys(instruments).length > 0 ? Object.keys(instruments)[0] : null;
                    // Use activeInstrument if set, otherwise default to first instrument
                    const activeInstrument = (instance.activeInstrument !== null && instance.activeInstrument !== undefined) 
                        ? instance.activeInstrument 
                        : firstInstrumentKey;
                    if (activeInstrument && refs.instrumentSelector !== activeElement && refs.instrumentSelector.value !== activeInstrument) {
                        refs.instrumentSelector.value = activeInstrument;
                    }
                }
            }
            
            // Sync fretboard binding display from Group B
            if (refs.fretboardBindingDisplay !== undefined && refs.fretboardBindingDisplay !== activeElement && groupB.fretboardBindingDisplay !== undefined) {
                if (refs.fretboardBindingDisplay.checked !== groupB.fretboardBindingDisplay) {
                    refs.fretboardBindingDisplay.checked = groupB.fretboardBindingDisplay;
                }
            }
            
            // Sync fret markers from Group B
            if (groupB.fretMarkers) {
                Object.keys(groupB.fretMarkers).forEach(fret => {
                    const selectId = `fretMarker_${fret}`;
                    const select = refs[selectId];
                    if (select && select !== activeElement && groupB.fretMarkers[fret]) {
                        if (select.value !== groupB.fretMarkers[fret]) {
                            select.value = groupB.fretMarkers[fret];
                        }
                    }
                });
            }
            
            // Sync custom CSS from Group B
            if (refs.customCSS && groupB.customCSS !== undefined) {
                const customCSSValue = groupB.customCSS || '';
                if (refs.customCSS !== activeElement && refs.customCSS.value !== customCSSValue) {
                    refs.customCSS.value = customCSSValue;
                }
            }
            
            // Sync Settings Group C
            if (refs.chordName && groupC.name !== undefined) {
                if (refs.chordName !== activeElement && refs.chordName.value !== (groupC.name || '')) {
                    refs.chordName.value = groupC.name || '';
                }
            }
            if (refs.rootNote && groupC.root !== undefined) {
                // Convert null/undefined to 'null' string for the select, otherwise use the root value
                const rootValue = (groupC.root === null || groupC.root === undefined) ? 'null' : groupC.root;
                if (refs.rootNote !== activeElement && refs.rootNote.value !== rootValue) {
                    refs.rootNote.value = rootValue;
                }
            }
            if (refs.startFret && groupC.startFret !== undefined) {
                if (refs.startFret !== activeElement && parseInt(refs.startFret.value) !== groupC.startFret) {
                    refs.startFret.value = groupC.startFret || 1;
                }
            }
            if (refs.numFrets && groupC.numFrets !== undefined) {
                if (refs.numFrets !== activeElement && parseInt(refs.numFrets.value) !== groupC.numFrets) {
                    refs.numFrets.value = groupC.numFrets || 4;
                }
            }
            // Sync stringType and numStrings (now from settingsGroupA)
            if (refs.stringType && groupA.stringType !== undefined) {
                if (refs.stringType !== activeElement && refs.stringType.value !== (groupA.stringType || '1')) {
                    refs.stringType.value = groupA.stringType || '1';
                }
            }
            if (refs.numStrings && groupA.numStrings !== undefined) {
                if (refs.numStrings !== activeElement) {
                    const currentNumStrings = parseInt(refs.numStrings.value) || 6;
                    if (currentNumStrings !== groupA.numStrings) {
                        refs.numStrings.value = groupA.numStrings || 6;
                        // Rebuild string rows if number of strings changed
                        const panelElement = instance.element;
                        const chordSection = panelElement.querySelector('.collapsible-section');
                        if (chordSection) {
                            const content = chordSection.querySelector('.section-content');
                            if (content) {
                                const newNumStrings = groupA.numStrings || 6;
                                rebuildStringRows(content, targetId, refs, newNumStrings);
                            }
                        }
                        // Also rebuild string colors section in Group B with the new number
                        const newNumStrings = groupA.numStrings || 6;
                        rebuildStringColorsSection(targetId, refs, newNumStrings);
                    }
                }
            }
            
            // Sync tuning inputs (now from settingsGroupA)
            if (groupA.tuning && refs.tuningInputs) {
                Object.keys(groupA.tuning).forEach(stringNum => {
                    const input = refs.tuningInputs[stringNum];
                    if (input && input !== activeElement && input.value !== (groupA.tuning[stringNum] || '')) {
                        input.value = groupA.tuning[stringNum] || '';
                    }
                });
            }
            
            // Sync fingering from dots (if available)
            // Optimized: Only sync if there are actually dots on the fretboard
            if (window.Fretboard && window.Fretboard.getFingeringFromDotState && refs.fingeringInputs) {
                const fingering = window.Fretboard.getFingeringFromDotState(targetId);
                
                // Cache last fingering state to avoid unnecessary updates
                const lastFingeringState = instance.lastFingeringState || null;
                const fingeringKey = fingering ? JSON.stringify(fingering.sort((a, b) => (a.string || 0) - (b.string || 0))) : '';
                const lastFingeringKey = lastFingeringState ? JSON.stringify(lastFingeringState.sort((a, b) => (a.string || 0) - (b.string || 0))) : '';
                
                // Only proceed if fingering actually changed
                if (fingeringKey !== lastFingeringKey) {
                    instance.lastFingeringState = fingering ? JSON.parse(JSON.stringify(fingering)) : null;
                    
                    if (fingering && Array.isArray(fingering) && fingering.length > 0) {
                        // Quick validation: check if we have any valid entries
                        const hasValidFingering = fingering.some(f => f && f.string >= 1 && (f.fret !== undefined && f.fret !== null));
                        
                        if (hasValidFingering) {
                            // Create a map for faster lookup
                            const fingeringMap = new Map();
                            fingering.forEach(f => {
                                if (f && f.string >= 1) {
                                    fingeringMap.set(f.string, f);
                                }
                            });
                            
                            // Batch DOM updates - update all text elements in one pass
                            const updates = [];
                            Object.keys(refs.fingeringInputs).forEach(stringNum => {
                                const stringNumInt = parseInt(stringNum);
                                if (stringNumInt >= 1 && refs.fingeringInputs[stringNum]) {
                                    const inputs = refs.fingeringInputs[stringNum];
                                    const f = fingeringMap.get(stringNumInt);
                                    
                                    if (f) {
                                        // Calculate values
                                        let fretValue = '';
                                        if (f.fret === -1) fretValue = '-1';
                                        else if (f.fret === null || f.fret === 'none') fretValue = 'none';
                                        else fretValue = String(f.fret || 0);
                                        
                                        let fingerValue = '';
                                        if (f.finger === null || f.finger === 'none') fingerValue = 'none';
                                        else fingerValue = String(f.finger || 0);
                                        
                                        // Only add to updates if values changed (fret is text, finger is input)
                                        if (inputs.fret && inputs.fret !== activeElement && inputs.fret.textContent !== fretValue) {
                                            updates.push({ element: inputs.fret, value: fretValue, isText: true });
                                        }
                                        if (inputs.finger && inputs.finger !== activeElement && inputs.finger.value !== fingerValue) {
                                            updates.push({ element: inputs.finger, value: fingerValue, isText: false });
                                        }
                                    } else {
                                        // Clear text for strings not in fingering
                                        if (inputs.fret && inputs.fret !== activeElement && inputs.fret.textContent !== '') {
                                            updates.push({ element: inputs.fret, value: '' });
                                        }
                                        if (inputs.finger && inputs.finger !== activeElement && inputs.finger.textContent !== '') {
                                            updates.push({ element: inputs.finger, value: '' });
                                        }
                                    }
                                }
                            });
                            
                            // Apply all updates at once (batched DOM updates)
                            updates.forEach(update => {
                                if (update.isText) {
                                    update.element.textContent = update.value;
                                } else {
                                    update.element.value = update.value;
                                }
                            });
                        } else {
                            // Clear all fingering text/inputs if no valid dots
                            const updates = [];
                            Object.keys(refs.fingeringInputs).forEach(stringNum => {
                                const inputs = refs.fingeringInputs[stringNum];
                                if (inputs && inputs.fret && inputs.fret !== activeElement && inputs.fret.textContent !== '') {
                                    updates.push({ element: inputs.fret, value: '', isText: true });
                                }
                                if (inputs && inputs.finger && inputs.finger !== activeElement && inputs.finger.value !== '') {
                                    updates.push({ element: inputs.finger, value: '', isText: false });
                                }
                            });
                            updates.forEach(update => {
                                if (update.isText) {
                                    update.element.textContent = update.value;
                                } else {
                                    update.element.value = update.value;
                                }
                            });
                        }
                    } else {
                        // Clear all fingering text/inputs if no fingering data
                        const updates = [];
                        Object.keys(refs.fingeringInputs).forEach(stringNum => {
                            const inputs = refs.fingeringInputs[stringNum];
                            if (inputs && inputs.fret && inputs.fret !== activeElement && inputs.fret.textContent !== '') {
                                updates.push({ element: inputs.fret, value: '', isText: true });
                            }
                            if (inputs && inputs.finger && inputs.finger !== activeElement && inputs.finger.value !== '') {
                                updates.push({ element: inputs.finger, value: '', isText: false });
                            }
                        });
                        updates.forEach(update => {
                            if (update.isText) {
                                update.element.textContent = update.value;
                            } else {
                                update.element.value = update.value;
                            }
                        });
                    }
                }
            }
        } finally {
            instance.isSyncing = false;
        }
    }
    
    // Update fretboard from a single setting change
    function updateFretboardSetting(targetId, group, key, value) {
        if (!window.Fretboard) return;
        
        const instance = controlPanelInstances.get(targetId);
        if (instance) {
            instance.isSyncing = true; // Prevent sync during update
        }
        
        try {
            if (group === 'A') {
                // Check if this is a CSS variable (starts with --)
                if (key.startsWith('--')) {
                    // For CSS variables, merge with existing
                    const state = getCurrentFretboardState(targetId);
                    const currentCssVars = (state && state.settingsGroupA && state.settingsGroupA.cssVariables) || {};
                    const update = { cssVariables: { ...currentCssVars, [key]: value } };
                    window.Fretboard.updateSettingsGroupA(update, targetId);
                } else if (key === 'tuning') {
                    // For tuning, merge with existing
                    const state = getCurrentFretboardState(targetId);
                    const currentTuning = (state && state.settingsGroupA && state.settingsGroupA.tuning) || {};
                    const update = { tuning: { ...currentTuning, ...value } };
                    window.Fretboard.updateSettingsGroupA(update, targetId);
                } else if (key === 'numStrings' || key === 'stringType') {
                    // For numStrings and stringType, update directly
                    const update = {};
                    update[key] = value;
                    window.Fretboard.updateSettingsGroupA(update, targetId);
                } else {
                    const update = {};
                    update[key] = value;
                    window.Fretboard.updateSettingsGroupA(update, targetId);
                }
            } else if (group === 'B') {
                // Group B has both CSS variables and non-CSS settings (fretMarkers, fretboardBindingDisplay)
                if (key.startsWith('--')) {
                    // For CSS variables, merge with existing
                    const state = getCurrentFretboardState(targetId);
                    const currentCssVars = (state && state.settingsGroupB && state.settingsGroupB.cssVariables) || {};
                    const update = { cssVariables: { ...currentCssVars, [key]: value } };
                    window.Fretboard.updateSettingsGroupB(update, targetId);
                } else {
                    // For non-CSS settings (fretMarkers, fretboardBindingDisplay, customCSS)
                    const update = {};
                    update[key] = value;
                    window.Fretboard.updateSettingsGroupB(update, targetId);
                }
            } else if (group === 'C') {
                // For Group C, exclude fingering unless explicitly updating it
                if (key === 'fingering') {
                    window.Fretboard.updateSettingsGroupC({ fingering: value }, false, targetId);
                } else {
                    const update = {};
                    update[key] = value;
                    // Explicitly exclude fingering, tuning, numStrings, and stringType (they're now in Group A)
                    window.Fretboard.updateSettingsGroupC(update, false, targetId);
                }
            }
        } finally {
            if (instance) {
                instance.isSyncing = false;
                // Don't sync immediately after update - let the periodic sync handle it
                // This prevents overwriting values that were just set
            }
        }
    }
    
    // Reset to defaults
    function resetToDefaults(targetId, panelElement) {
        // Default values (matching fretboard.js defaults)
        const defaultSettingsGroupA = {
            dotTextMode: 'note',
            showFretIndicators: 'first-fret-cond',
            tuning: null,
            numStrings: 6,
            stringType: '1',
            cssVariables: {} // Clear CSS overrides - CSS is source of truth
        };
        
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
            fretboardBindingDisplay: true,
            cssVariables: {} // Clear CSS overrides - CSS is source of truth
        };
        
        const defaultSettingsGroupC = {
            name: null,
            root: null,
            startFret: 1,
            numFrets: 4,
            fingering: []
        };
        
        // Create default config
        const defaultConfig = {
            settingsGroupA: JSON.parse(JSON.stringify(defaultSettingsGroupA)),
            settingsGroupB: JSON.parse(JSON.stringify(defaultSettingsGroupB)),
            settingsGroupC: JSON.parse(JSON.stringify(defaultSettingsGroupC))
        };
        
        // Update fretboard with defaults
        if (window.Fretboard) {
            window.Fretboard.updateSettingsGroupA(defaultSettingsGroupA, targetId);
            window.Fretboard.updateSettingsGroupB(defaultSettingsGroupB, targetId);
            window.Fretboard.updateSettingsGroupC(defaultSettingsGroupC, false, targetId);
        }
        
        // Clear CSS variable overrides by removing them from the DOM
        const instance = controlPanelInstances.get(targetId);
        if (instance) {
            // Get all CSS variables that might have been set
            const allDimensionVars = [
                '--fretboard-width', '--fretboard-height', '--header-height',
                '--fret-0-height', '--nut-divider-height',
                '--string-thickest-width', '--string-thinnest-width', '--dot-size',
                '--interval-indicator-width', '--marker-dot-size', '--dot-text-font-size',
                '--interval-label-font-size', '--tuning-label-font-size',
                '--fret-indicator-font-size', '--fret-divider-height', '--fret-divider-width'
            ];
            
            const allBgVars = [
                '--fingerboard-row-0-color', '--main-fret-area-bg-color',
                '--fret-divider-color', '--nut-divider-color',
                '--fretbinding-background', '--marker-dot-color',
                '--tuning-label-color', '--fret-indicator-color'
            ];
            
            const allIntervalVars = [
                '--interval-root-color', '--interval-minor-2nd-color', '--interval-major-2nd-color',
                '--interval-minor-3rd-color', '--interval-major-3rd-color', '--interval-perfect-4th-color',
                '--interval-tritone-color', '--interval-perfect-5th-color', '--interval-minor-6th-color',
                '--interval-major-6th-color', '--interval-minor-7th-color', '--interval-major-7th-color',
                '--interval-octave-color', '--interval-minor-9th-color', '--interval-major-9th-color',
                '--interval-aug-9th-color', '--interval-perfect-11th-color', '--interval-aug-11th-color'
            ];
            
            // Remove all CSS variable overrides
            [...allDimensionVars, ...allBgVars, ...allIntervalVars].forEach(varName => {
                document.documentElement.style.removeProperty(varName);
            });
            
            // Sync panel from fretboard (which now has defaults)
            setTimeout(() => {
                syncPanelFromFretboard(targetId);
            }, 100);
            
            console.log('Fretboard Control Panel: Reset to defaults completed');
        }
    }
    
    // Helper function to rebuild string rows (fingering only, no tuning)
    // Defined at module scope so it can be accessed from applyImportedSettings
    function rebuildStringRows(container, targetId, inputRefs, numStringsOverride = null) {
        // Find the wrapper first, then the container inside it
        const stringsWrapper = container.querySelector('.strings-rows-wrapper');
        const stringsContainer = stringsWrapper ? stringsWrapper.querySelector('.strings-rows-container') : container.querySelector('.strings-rows-container');
        if (!stringsContainer) return;
        
        // Clear existing data rows (but keep header)
        const dataRows = stringsContainer.querySelectorAll('.string-row:not(.string-header-row)');
        dataRows.forEach(row => row.remove());
        
        // Get number of strings - use override if provided, otherwise from state
        let numStrings;
        if (numStringsOverride !== null && numStringsOverride !== undefined) {
            numStrings = numStringsOverride;
        } else {
            const state = getCurrentFretboardState(targetId);
            if (!state || !state.settingsGroupA) return;
            numStrings = state.settingsGroupA.numStrings || 6;
        }
        
        // Get fingering from dots if available (source of truth, not from settingsGroupC)
        let fingering = [];
        if (window.Fretboard && window.Fretboard.getFingeringFromDotState) {
            fingering = window.Fretboard.getFingeringFromDotState(targetId) || [];
        }
        
        // Validate fingering - remove any invalid entries
        fingering = fingering.filter(f => {
            if (!f || typeof f.string !== 'number' || f.string < 1) return false;
            if (f.fret === undefined || f.fret === null) return false;
            if (f.fret !== -1 && (typeof f.fret !== 'number' || f.fret < 0)) return false;
            return true;
        });
        
        // Create a map of fingering by string number for quick lookup
        const fingeringByString = {};
        fingering.forEach(f => {
            if (f.string) {
                fingeringByString[f.string] = f;
            }
        });
        
        for (let i = 1; i <= numStrings; i++) {
            const row = document.createElement('div');
            row.className = 'string-row';
            
            // String number label
            const stringCol = document.createElement('div');
            stringCol.className = 'string-col';
            stringCol.textContent = i;
            row.appendChild(stringCol);
            
            // Fret input column
            const fretCol = document.createElement('div');
            fretCol.className = 'fret-col';
            const fretValue = fingeringByString[i];
            let fretInputValue = '';
            if (fretValue) {
                if (fretValue.fret === -1) fretInputValue = '-1';
                else if (fretValue.fret === null || fretValue.fret === 'none') fretInputValue = 'none';
                else fretInputValue = String(fretValue.fret || 0);
            }
            
            // Create regular text element for fret (non-editable, display only)
            const fretText = document.createElement('span');
            fretText.id = `fingering_fret_${i}`;
            fretText.textContent = fretInputValue || '';
            fretText.className = 'fret-text';
            fretCol.appendChild(fretText);
            row.appendChild(fretCol);
            
            // Finger input column
            const fingerCol = document.createElement('div');
            fingerCol.className = 'finger-col';
            let fingerInputValue = '';
            if (fretValue) {
                if (fretValue.finger === 'none' || fretValue.finger === null) fingerInputValue = 'none';
                else fingerInputValue = String(fretValue.finger || 0);
            }
            
            // Handler for finger input changes (updates fretboard when user types)
            const handleFingerInput = (e) => {
                // Don't update if we're currently syncing (prevents circular updates)
                const instance = controlPanelInstances.get(targetId);
                if (instance && instance.isSyncing) return;
                
                // Get current fingering from dots (source of truth)
                const currentFingering = window.Fretboard && window.Fretboard.getFingeringFromDotState
                    ? window.Fretboard.getFingeringFromDotState(targetId) || []
                    : [];
                
                // Find or create fingering entry for this string
                let fingeringEntry = currentFingering.find(f => f.string === i);
                if (!fingeringEntry) {
                    // Can't set finger without a fret, so ignore
                    return;
                }
                
                const value = e.target.value.trim().toLowerCase();
                if (value === 'none' || value === 'null' || value === '') {
                    fingeringEntry.finger = 'none';
                } else {
                    const fingerNum = parseInt(value);
                    fingeringEntry.finger = isNaN(fingerNum) ? 0 : fingerNum;
                }
                
                // Always update when user types (real-time sync to fretboard)
                updateFretboardSetting(targetId, 'C', 'fingering', currentFingering);
            };
            
            // Create input element for finger (editable)
            const fingerInput = document.createElement('input');
            fingerInput.type = 'text';
            fingerInput.id = `fingering_finger_${i}`;
            fingerInput.value = fingerInputValue || '';
            fingerInput.placeholder = '';
            fingerInput.className = 'finger-input';
            fingerInput.maxLength = 4;
            // Add input event for real-time updates
            fingerInput.addEventListener('input', handleFingerInput);
            fingerInput.addEventListener('change', handleFingerInput);
            fingerCol.appendChild(fingerInput);
            row.appendChild(fingerCol);
            
            // Store references (fret is text, finger is input)
            if (!inputRefs.fingeringInputs[i]) {
                inputRefs.fingeringInputs[i] = {};
            }
            inputRefs.fingeringInputs[i].fret = fretText;
            inputRefs.fingeringInputs[i].finger = fingerInput;
            stringsContainer.appendChild(row);
        }
    }
    
    // Helper function to rebuild string colors section
    // Defined at module scope so it can be accessed from applyImportedSettings
    function rebuildStringColorsSection(targetId, inputRefs, numStringsOverride = null) {
        // Get the instance and find the string colors section
        const instance = controlPanelInstances.get(targetId);
        if (!instance) return;
        
        // Try to get stored reference first
        let stringColorsSection = instance.stringColorsSection;
        
        // If not found, search for it
        if (!stringColorsSection && instance.element) {
            const sections = instance.element.querySelectorAll('.collapsible-section');
            for (let section of sections) {
                const toggle = section.querySelector('.section-toggle');
                if (toggle && toggle.textContent.includes('String Colors')) {
                    stringColorsSection = section;
                    break;
                }
            }
        }
        
        if (!stringColorsSection) return;
        
        const sectionContent = stringColorsSection.querySelector('.section-content');
        if (!sectionContent) return;
        
        // Clear existing content
        sectionContent.innerHTML = '';
        
        // Get number of strings - use override if provided, otherwise from state
        let numStrings;
        if (numStringsOverride !== null && numStringsOverride !== undefined) {
            numStrings = numStringsOverride;
        } else {
            const state = getCurrentFretboardState(targetId);
            numStrings = (state && state.settingsGroupA && state.settingsGroupA.numStrings) || 6;
        }
        
        // Ensure we have a valid number
        if (!numStrings || numStrings < 1 || isNaN(numStrings)) {
            numStrings = 6;
        }
        
        // Get CSS variables from Group B
        const state = getCurrentFretboardState(targetId);
        const groupB = (state && state.settingsGroupB) || {};
        const cssVarsForColors = (groupB.cssVariables) || {};
        
        // Helper function to create a color swatch for string colors
        function createStringColorSwatch(value) {
            const swatch = document.createElement('div');
            swatch.className = 'string-color-swatch';
            swatch.style.width = '30px';
            swatch.style.height = '30px';
            swatch.style.border = '1px solid #ccc';
            swatch.style.borderRadius = '4px';
            swatch.style.display = 'inline-block';
            swatch.style.verticalAlign = 'middle';
            swatch.style.marginLeft = '8px';
            swatch.title = 'Color preview';
            
            function updateSwatch(val) {
                if (!val || !val.trim()) {
                    swatch.style.background = 'transparent';
                    swatch.style.backgroundImage = 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)';
                    swatch.style.backgroundSize = '8px 8px';
                    swatch.style.backgroundPosition = '0 0, 0 4px, 4px -4px, -4px 0px';
                } else {
                    const bgValue = val.trim();
                    swatch.style.setProperty('background', bgValue, 'important');
                }
            }
            
            updateSwatch(value);
            swatch.updateSwatch = updateSwatch;
            return swatch;
        }
        
        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'controls-container';
        
        // Clear existing references
        if (inputRefs.stringColorInputs) {
            inputRefs.stringColorInputs = {};
        }
        if (inputRefs.stringColorSwatches) {
            inputRefs.stringColorSwatches = {};
        }
        
        // Create color input for each string
        for (let i = 1; i <= numStrings; i++) {
            // Determine CSS variable name based on string number
            // Strings 1-6 use --string-X-default-color, strings 7+ use --string-X-color
            const cssVarName = i <= 6 ? `--string-${i}-default-color` : `--string-${i}-color`;
            
            // Get current value from CSS variable
            let currentColorValue = '';
            if (cssVarsForColors[cssVarName]) {
                currentColorValue = cssVarsForColors[cssVarName];
            } else {
                currentColorValue = getCurrentCSSVariable(cssVarName);
            }
            
            // Create text input for color/gradient
            const colorInput = createInput('text', `string_color_${i}`, currentColorValue,
                (e) => {
                    const instance = controlPanelInstances.get(targetId);
                    if (instance) {
                        instance.userEditing = true;
                        instance.editingKey = cssVarName;
                    }
                    
                    // Update CSS variable through Settings Group B
                    updateFretboardSetting(targetId, 'B', cssVarName, e.target.value);
                    
                    // Update swatch
                    if (swatch) swatch.updateSwatch(e.target.value);
                    
                    // Clear editing flag after a short delay
                    if (instance) {
                        setTimeout(() => {
                            instance.userEditing = false;
                            instance.editingKey = null;
                        }, 300);
                    }
                }
            );
            colorInput.placeholder = 'Color/Gradient';
            colorInput.className = 'string-color-input';
            colorInput.style.width = '100%';
            colorInput.style.fontSize = '11px';
            colorInput.style.padding = '4px';
            
            // Create swatch
            const swatch = createStringColorSwatch(currentColorValue);
            
            // Create wrapper for input and swatch
            const colorInputWrapper = document.createElement('div');
            colorInputWrapper.style.display = 'flex';
            colorInputWrapper.style.alignItems = 'center';
            colorInputWrapper.style.gap = '4px';
            colorInputWrapper.appendChild(colorInput);
            colorInputWrapper.appendChild(swatch);
            
            // Handle blur to ensure value is saved
            colorInput.addEventListener('blur', (e) => {
                const instance = controlPanelInstances.get(targetId);
                if (instance) {
                    updateFretboardSetting(targetId, 'B', cssVarName, e.target.value);
                    if (swatch) swatch.updateSwatch(e.target.value);
                    setTimeout(() => {
                        instance.userEditing = false;
                        instance.editingKey = null;
                    }, 100);
                }
            });
            
            // Store reference for syncing
            if (!inputRefs.stringColorInputs) inputRefs.stringColorInputs = {};
            inputRefs.stringColorInputs[i] = colorInput;
            if (!inputRefs.stringColorSwatches) inputRefs.stringColorSwatches = {};
            inputRefs.stringColorSwatches[i] = swatch;
            
            controlsContainer.appendChild(createControlGroup(`String ${i} Color`, colorInputWrapper, cssVarName));
        }
        
        sectionContent.appendChild(controlsContainer);
    }
    
    function buildControlPanel(panelElement, currentState, targetId, inputRefs) {
        try {
            // Find or create content div
            let content = panelElement.querySelector('#controls-content');
            if (!content) {
                content = document.createElement('div');
                content.id = 'controls-content';
                panelElement.appendChild(content);
            }
            
            if (!currentState) {
                console.warn('Fretboard Control Panel: No state available yet.');
                content.innerHTML = '<p>Waiting for Fretboard initialization...</p>';
                return;
            }
            
            console.log('Fretboard Control Panel: Building control panel for target', targetId);
            content.innerHTML = '';
            
            // Helper function to check if a value is a gradient
            function isGradient(val) {
                if (!val || val.trim() === '') return false;
                const trimmed = val.trim().toLowerCase();
                // Check for gradient keywords (even if incomplete)
                return trimmed.includes('gradient') || 
                       trimmed.includes('linear-gradient') || 
                       trimmed.includes('radial-gradient') || 
                       trimmed.includes('conic-gradient') ||
                       trimmed.includes('repeating-linear-gradient') ||
                       trimmed.includes('repeating-radial-gradient');
            }
            
            // Helper function to create a color swatch (shared across sections)
            function createColorSwatch(value, isGradientInput = false) {
                const swatch = document.createElement('div');
                swatch.className = 'color-swatch';
                swatch.style.width = isGradientInput ? '100%' : '30px';
                swatch.style.height = isGradientInput ? '40px' : '30px';
                swatch.style.border = '1px solid #ccc';
                swatch.style.borderRadius = '4px';
                swatch.style.display = isGradientInput ? 'block' : 'inline-block';
                swatch.style.verticalAlign = 'middle';
                swatch.style.marginLeft = isGradientInput ? '0' : '8px';
                swatch.style.marginTop = isGradientInput ? '8px' : '0';
                swatch.title = 'Color preview';
                
                function updateSwatch(val) {
                    if (!val || !val.trim()) {
                        // Show transparent checkerboard pattern
                        swatch.style.background = 'transparent';
                        swatch.style.backgroundImage = 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)';
                        swatch.style.backgroundSize = '8px 8px';
                        swatch.style.backgroundPosition = '0 0, 0 4px, 4px -4px, -4px 0px';
                    } else {
                        // Set background directly - works for colors and gradients
                        const bgValue = val.trim();
                        swatch.style.setProperty('background', bgValue, 'important');
                    }
                }
                
                updateSwatch(value);
                swatch.updateSwatch = updateSwatch;
                swatch.isGradient = () => isGradient(value);
                return swatch;
            }
        
        // Button container
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'control-panel-buttons';
        
        // Export Settings Button
        const exportButton = document.createElement('button');
        exportButton.textContent = 'Export Settings';
        exportButton.className = 'export-settings-btn';
        exportButton.addEventListener('click', () => {
            const currentState = getCurrentFretboardState(targetId);
            if (currentState) {
                showExportModal(currentState, targetId);
            }
        });
        buttonContainer.appendChild(exportButton);
        
        // Import Settings Button
        const importButton = document.createElement('button');
        importButton.textContent = 'Import Settings';
        importButton.className = 'import-settings-btn';
        importButton.addEventListener('click', () => {
            showImportModal(targetId);
        });
        buttonContainer.appendChild(importButton);
        
        // Reset to Defaults Button
        const resetButton = document.createElement('button');
        resetButton.textContent = 'Reset to Defaults';
        resetButton.className = 'reset-defaults-btn';
        resetButton.addEventListener('click', () => {
            if (confirm('Are you sure you want to reset all settings to defaults? This cannot be undone.')) {
                resetToDefaults(targetId, panelElement);
            }
        });
        buttonContainer.appendChild(resetButton);
        
        content.appendChild(buttonContainer);
        
        // Settings Group C - Chord Variables (MOVED TO FIRST POSITION)
        const groupCSection = document.createElement('div');
        groupCSection.className = 'settings-group-section';
        const groupCHeader = document.createElement('div');
        groupCHeader.className = 'settings-group-header';
        groupCHeader.textContent = 'Settings Group C - Chord Variables';
        groupCSection.appendChild(groupCHeader);
        const groupCContent = document.createElement('div');
        groupCContent.className = 'settings-group-content';
        
        // Initialize input refs structure
        inputRefs.tuningInputs = {};
        inputRefs.fingeringInputs = {};
        
        const groupC = currentState.settingsGroupC || {};
        const groupA = currentState.settingsGroupA || {};
        
        // rebuildStringRows and rebuildStringColorsSection are now defined at module scope above
        
        if (groupC) {
            const chordConfigSection = createCollapsibleSection('Chord Configuration & Fingering', (content) => {
                const controlsGrid = document.createElement('div');
                controlsGrid.className = 'controls-grid';
                
                // Chord Configuration controls
                const chordNameInput = createInput('text', 'chordName', groupC.name || '',
                    (e) => {
                        updateFretboardSetting(targetId, 'C', 'name', e.target.value);
                    }
                );
                inputRefs.chordName = chordNameInput;
                controlsGrid.appendChild(createControlGroup('Chord Name', chordNameInput, 'name'));
                
                // Create root note options with 'None' as first option
                const rootNoteOptions = [
                    {value: 'null', label: 'None'},
                    ...['A','A#','B','C','C#','D','D#','E','F','F#','G','G#'].map(n => ({value: n, label: n}))
                ];
                
                // Determine default value: use 'null' if root is null/undefined, otherwise use the root value
                const rootNoteDefault = (groupC.root === null || groupC.root === undefined) ? 'null' : groupC.root;
                
                const rootNoteSelect = createSelect('rootNote',
                    rootNoteOptions,
                    rootNoteDefault,
                    (e) => {
                        // Convert 'null' string to actual null value
                        const rootValue = e.target.value === 'null' ? null : e.target.value;
                        updateFretboardSetting(targetId, 'C', 'root', rootValue);
                    }
                );
                inputRefs.rootNote = rootNoteSelect;
                controlsGrid.appendChild(createControlGroup('Root Note', rootNoteSelect, 'root'));
                
                const startFretInput = createInput('number', 'startFret', groupC.startFret || 1,
                    (e) => {
                        updateFretboardSetting(targetId, 'C', 'startFret', parseInt(e.target.value) || 1);
                    }
                );
                inputRefs.startFret = startFretInput;
                controlsGrid.appendChild(createControlGroup('Start Fret', startFretInput, 'startFret'));
                
                const numFretsInput = createInput('number', 'numFrets', groupC.numFrets || 4,
                    (e) => {
                        updateFretboardSetting(targetId, 'C', 'numFrets', parseInt(e.target.value) || 4);
                    }
                );
                inputRefs.numFrets = numFretsInput;
                controlsGrid.appendChild(createControlGroup('Number of Frets', numFretsInput, 'numFrets'));
                
                content.appendChild(controlsGrid);
                
                // Wrapper for horizontal scrolling
                const stringsWrapper = document.createElement('div');
                stringsWrapper.className = 'strings-rows-wrapper';
                
                // String rows container (using grid)
                const stringsContainer = document.createElement('div');
                stringsContainer.className = 'strings-rows-container';
                
                // Column headers
                const headerRow = document.createElement('div');
                headerRow.className = 'string-row string-header-row';
                headerRow.innerHTML = `
                    <div class="string-col">Str</div>
                    <div class="fret-col">Fret</div>
                    <div class="finger-col">Finger</div>
                `;
                stringsContainer.appendChild(headerRow);
                stringsWrapper.appendChild(stringsContainer);
                content.appendChild(stringsWrapper);
                
                // Initial build of string rows
                rebuildStringRows(content, targetId, inputRefs);
            }, false); // CHANGED: false = expanded by default
            groupCContent.appendChild(chordConfigSection);
        }
        
        groupCSection.appendChild(groupCContent);
        content.appendChild(groupCSection);
        
        // Settings Group A - Fretboard Variables
        const groupASection = document.createElement('div');
        groupASection.className = 'settings-group-section';
        const groupAHeader = document.createElement('div');
        groupAHeader.className = 'settings-group-header';
        groupAHeader.textContent = 'Settings Group A - Fretboard Variables';
        groupASection.appendChild(groupAHeader);
        const groupAContent = document.createElement('div');
        groupAContent.className = 'settings-group-content';
        
        // Check if instruments exist and add instrument selector dropdown
        const fretboardInstance = window.Fretboard && window.Fretboard.getInstance 
            ? window.Fretboard.getInstance(targetId)
            : null;
        // Get instruments from instance (check both instance.instruments and instance.config.instruments)
        const instruments = (fretboardInstance && fretboardInstance.instruments) 
            ? fretboardInstance.instruments 
            : (fretboardInstance && fretboardInstance.config && fretboardInstance.config.instruments)
                ? fretboardInstance.config.instruments
                : null;
        
        if (instruments && typeof instruments === 'object' && Object.keys(instruments).length > 0) {
            // Get active instrument from instance or use first instrument key as default
            const firstInstrumentKey = Object.keys(instruments)[0];
            const activeInstrument = (fretboardInstance && fretboardInstance.activeInstrument !== null && fretboardInstance.activeInstrument !== undefined)
                ? fretboardInstance.activeInstrument
                : firstInstrumentKey;
            
            // Create instrument selector dropdown
            const instrumentOptions = Object.keys(instruments).map(key => ({
                value: key,
                label: instruments[key].instrumentLabel || key
            }));
            
            const instrumentSelector = createSelect('instrumentSelector', instrumentOptions, activeInstrument,
                (e) => {
                    const selectedInstrument = e.target.value;
                    if (window.Fretboard && window.Fretboard.applyInstrument) {
                        window.Fretboard.applyInstrument(selectedInstrument, targetId);
                        // Sync panel after instrument is applied
                        setTimeout(() => {
                            syncPanelFromFretboard(targetId);
                        }, 100);
                    }
                }
            );
            inputRefs.instrumentSelector = instrumentSelector;
            groupAContent.appendChild(createControlGroup('Instrument', instrumentSelector, 'instrument'));
        }
        
        // groupA is already declared earlier in buildControlPanel function
        if (groupA) {
            // Display Settings Section
            const displaySection = createCollapsibleSection('Display Settings', (content) => {
                const controlsGrid = document.createElement('div');
                controlsGrid.className = 'controls-grid';
                
                // Dot Text Mode
                const dotTextModeSelect = createSelect('dotTextMode', 
                    [{value: 'note', label: 'Note'}, {value: 'finger', label: 'Finger'}],
                    groupA.dotTextMode || 'note',
                    (e) => {
                        const newValue = e.target.value;
                        // Prevent sync from overriding this change
                        const instance = controlPanelInstances.get(targetId);
                        if (instance) {
                            instance.isSyncing = true;
                        }
                        updateFretboardSetting(targetId, 'A', 'dotTextMode', newValue);
                        // Clear sync flag after a short delay to allow update to complete
                        if (instance) {
                            setTimeout(() => {
                                instance.isSyncing = false;
                            }, 100);
                        }
                    }
                );
                inputRefs.dotTextMode = dotTextModeSelect;
                controlsGrid.appendChild(createControlGroup('Dot Text Mode', dotTextModeSelect, 'dotTextMode'));
                
                // Show Fret Indicators
                const showFretIndicatorsSelect = createSelect('showFretIndicators',
                    [
                        {value: 'all', label: 'All'},
                        {value: 'none', label: 'None'},
                        {value: 'first-fret', label: 'First Fret'},
                        {value: 'first-fret-cond', label: 'First Fret (Conditional)'}
                    ],
                    groupA.showFretIndicators || 'first-fret-cond',
                    (e) => {
                        updateFretboardSetting(targetId, 'A', 'showFretIndicators', e.target.value);
                    }
                );
                inputRefs.showFretIndicators = showFretIndicatorsSelect;
                controlsGrid.appendChild(createControlGroup('Show Fret Indicators', showFretIndicatorsSelect, 'showFretIndicators'));
                
                content.appendChild(controlsGrid);
            });
            groupAContent.appendChild(displaySection);
            
            // Dimensions & Layout Section
            const dimensionsSection = createCollapsibleSection('Dimensions & Layout', (sectionContent) => {
                const controlsGrid = document.createElement('div');
                controlsGrid.className = 'controls-grid';
            
            const dimensionVars = [
                {key: '--fretboard-width', label: 'Fretboard Width', type: 'text'},
                {key: '--fretboard-height', label: 'Fretboard Height', type: 'text'},
                {key: '--header-height', label: 'Header Height', type: 'text'},
                {key: '--fret-0-height', label: 'Fret 0 Height', type: 'text'},
                {key: '--nut-divider-height', label: 'Nut Divider Height', type: 'text'},
                {key: '--string-thickest-width', label: 'String Thickest Width', type: 'text'},
                {key: '--string-thinnest-width', label: 'String Thinnest Width', type: 'text'},
                {key: '--dot-size', label: 'Dot Size', type: 'text'},
                {key: '--interval-indicator-width', label: 'Interval Indicator Width', type: 'text'},
                {key: '--marker-dot-size', label: 'Marker Dot Size', type: 'text'},
                {key: '--dot-text-font-size', label: 'Dot Text Font Size', type: 'text'},
                {key: '--interval-label-font-size', label: 'Interval Label Font Size', type: 'text'},
                {key: '--tuning-label-font-size', label: 'Tuning Label Font Size', type: 'text'},
                {key: '--fret-indicator-font-size', label: 'Fret Indicator Font Size', type: 'text'},
                {key: '--fret-divider-height', label: 'Fret Divider Height', type: 'text'},
                {key: '--fret-divider-width', label: 'Fret Divider Width', type: 'text'}
            ];
            
            dimensionVars.forEach(v => {
                // Get current value from state, or fall back to computed CSS variable value
                const configValue = (groupA.cssVariables && groupA.cssVariables[v.key]) || '';
                const currentValue = configValue || getCurrentCSSVariable(v.key);
                
                const input = createInput(v.type, v.key, 
                    currentValue,
                    (e) => {
                        updateFretboardSetting(targetId, 'A', v.key, e.target.value);
                    }
                );
                // Store reference for syncing
                if (!inputRefs.cssVarsA) inputRefs.cssVarsA = {};
                inputRefs.cssVarsA[v.key] = input;
                
                // Wrap input with up/down arrows for dimension inputs
                const inputWithArrows = createInputWithArrows(input, 1);
                controlsGrid.appendChild(createControlGroup(v.label, inputWithArrows, v.key));
            });
            sectionContent.appendChild(controlsGrid);
            });
            groupAContent.appendChild(dimensionsSection);
            
            // Tuning & Strings Section
            const tuningStringsSection = createCollapsibleSection('Tuning & Strings', (content) => {
                const controlsGrid = document.createElement('div');
                controlsGrid.className = 'controls-grid';
                
                // String Type and Number of Strings on the same line
                const stringsRow = document.createElement('div');
                stringsRow.style.display = 'flex';
                stringsRow.style.gap = '16px';
                stringsRow.style.marginTop = '16px';
                
                const stringTypeSelect = createSelect('stringType',
                    [{value: '1', label: 'Single'}, {value: '2', label: 'Double'}],
                    groupA.stringType || '1',
                    (e) => {
                        updateFretboardSetting(targetId, 'A', 'stringType', e.target.value);
                    }
                );
                inputRefs.stringType = stringTypeSelect;
                stringsRow.appendChild(createControlGroup('String Type', stringTypeSelect, 'stringType'));
                
                // Helper function to update numStrings and rebuild all related sections
                function updateNumStringsAndRebuild(newNumStrings) {
                    if (newNumStrings < 1) newNumStrings = 1;
                    if (newNumStrings > 20) newNumStrings = 20; // Reasonable max
                    
                    updateFretboardSetting(targetId, 'A', 'numStrings', newNumStrings);
                    
                    // Update the input value
                    numStringsInput.value = newNumStrings;
                    
                    // Rebuild string rows in Group C immediately with the new number
                    const instance = controlPanelInstances.get(targetId);
                    if (instance && instance.element) {
                        // Find Group C section and rebuild string rows there
                        const allSections = instance.element.querySelectorAll('.settings-group-section');
                        let groupCSection = null;
                        for (let section of allSections) {
                            const header = section.querySelector('.settings-group-header');
                            if (header && header.textContent.includes('Settings Group C')) {
                                groupCSection = section;
                                break;
                            }
                        }
                        if (groupCSection) {
                            const chordSection = groupCSection.querySelector('.collapsible-section');
                            if (chordSection) {
                                const chordContent = chordSection.querySelector('.section-content');
                                if (chordContent) {
                                    rebuildStringRows(chordContent, targetId, inputRefs, newNumStrings);
                                }
                            }
                        }
                        
                        // Also rebuild tuning inputs in Group A
                        const allSectionsA = instance.element.querySelectorAll('.settings-group-section');
                        let groupASection = null;
                        for (let section of allSectionsA) {
                            const header = section.querySelector('.settings-group-header');
                            if (header && header.textContent.includes('Settings Group A')) {
                                groupASection = section;
                                break;
                            }
                        }
                        if (groupASection) {
                            const allCollapsibleSections = groupASection.querySelectorAll('.collapsible-section');
                            for (let section of allCollapsibleSections) {
                                const toggle = section.querySelector('.section-toggle');
                                if (toggle && toggle.textContent.includes('Tuning')) {
                                    const tuningContent = section.querySelector('.section-content');
                                    if (tuningContent) {
                                        const tuningGrid = tuningContent.querySelector('.tuning-inputs-wrapper .controls-grid');
                                        if (tuningGrid) {
                                            const state = getCurrentFretboardState(targetId);
                                            const tuning = (state && state.settingsGroupA && state.settingsGroupA.tuning) || {};
                                            const defaultTuning = {
                                                1: 'E', 2: 'A', 3: 'D', 4: 'G', 5: 'B', 6: 'E',
                                                7: 'B', 8: 'F#', 9: 'C#', 10: 'G#',
                                                11: 'D#', 12: 'A#', 13: 'F', 14: 'C', 15: 'G',
                                                16: 'D', 17: 'A', 18: 'E', 19: 'B', 20: 'F#'
                                            };
                                            
                                            tuningGrid.innerHTML = '';
                                            for (let i = 1; i <= newNumStrings; i++) {
                                                const tuningValue = (tuning && tuning[i]) || defaultTuning[i] || '';
                                                const tuningInput = createInput('text', `tuning_${i}`, tuningValue,
                                                    (e) => {
                                                        const state = getCurrentFretboardState(targetId);
                                                        if (!state || !state.settingsGroupA) return;
                                                        
                                                        const currentTuning = (state.settingsGroupA.tuning) || {};
                                                        const newTuning = { ...currentTuning };
                                                        newTuning[i] = e.target.value.toUpperCase();
                                                        updateFretboardSetting(targetId, 'A', 'tuning', newTuning);
                                                    }
                                                );
                                                tuningInput.placeholder = '';
                                                tuningInput.className = 'tuning-input';
                                                tuningInput.maxLength = 4;
                                                inputRefs.tuningInputs[i] = tuningInput;
                                                tuningGrid.appendChild(createControlGroup(`String ${i}`, tuningInput, `tuning_${i}`));
                                            }
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    // Rebuild string colors section immediately with the new number
                    rebuildStringColorsSection(targetId, inputRefs, newNumStrings);
                }
                
                // Number of Strings control with add/remove buttons
                const numStringsInput = createInput('number', 'numStrings', groupA.numStrings || 6,
                    (e) => {
                        const newNumStrings = parseInt(e.target.value) || 6;
                        updateNumStringsAndRebuild(newNumStrings);
                    }
                );
                numStringsInput.min = 1;
                numStringsInput.max = 20;
                inputRefs.numStrings = numStringsInput;
                
                // Create wrapper for input with add/remove buttons
                const numStringsWrapper = document.createElement('div');
                numStringsWrapper.style.display = 'flex';
                numStringsWrapper.style.alignItems = 'center';
                numStringsWrapper.style.gap = '8px';
                
                // Add button (remove string)
                const removeStringBtn = document.createElement('button');
                removeStringBtn.type = 'button';
                removeStringBtn.textContent = '−';
                removeStringBtn.title = 'Remove String';
                removeStringBtn.style.cssText = 'width: 28px; height: 28px; border: 1px solid #ccc; background: #f5f5f5; cursor: pointer; border-radius: 4px; font-size: 18px; line-height: 1; display: flex; align-items: center; justify-content: center;';
                removeStringBtn.addEventListener('mouseenter', () => removeStringBtn.style.background = '#e0e0e0');
                removeStringBtn.addEventListener('mouseleave', () => removeStringBtn.style.background = '#f5f5f5');
                removeStringBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const currentNum = parseInt(numStringsInput.value) || 6;
                    if (currentNum > 1) {
                        updateNumStringsAndRebuild(currentNum - 1);
                    }
                });
                
                numStringsWrapper.appendChild(removeStringBtn);
                numStringsWrapper.appendChild(numStringsInput);
                
                // Add button (add string)
                const addStringBtn = document.createElement('button');
                addStringBtn.type = 'button';
                addStringBtn.textContent = '+';
                addStringBtn.title = 'Add String';
                addStringBtn.style.cssText = 'width: 28px; height: 28px; border: 1px solid #ccc; background: #f5f5f5; cursor: pointer; border-radius: 4px; font-size: 18px; line-height: 1; display: flex; align-items: center; justify-content: center;';
                addStringBtn.addEventListener('mouseenter', () => addStringBtn.style.background = '#e0e0e0');
                addStringBtn.addEventListener('mouseleave', () => addStringBtn.style.background = '#f5f5f5');
                addStringBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const currentNum = parseInt(numStringsInput.value) || 6;
                    if (currentNum < 20) {
                        updateNumStringsAndRebuild(currentNum + 1);
                    }
                });
                
                numStringsWrapper.appendChild(addStringBtn);
                
                stringsRow.appendChild(createControlGroup('Number of Strings', numStringsWrapper, 'numStrings'));
                
                content.appendChild(stringsRow);
                
                // Tuning inputs wrapper
                const tuningWrapper = document.createElement('div');
                tuningWrapper.className = 'tuning-inputs-wrapper';
                tuningWrapper.style.marginTop = '16px';
                
                // Get number of strings
                const state = getCurrentFretboardState(targetId);
                const numStrings = (state && state.settingsGroupA && state.settingsGroupA.numStrings) || 6;
                const tuning = (state && state.settingsGroupA && state.settingsGroupA.tuning) || {};
                
                // Default tuning values
                const defaultTuning = {
                    1: 'E', 2: 'A', 3: 'D', 4: 'G', 5: 'B', 6: 'E',
                    7: 'B', 8: 'F#', 9: 'C#', 10: 'G#',
                    11: 'D#', 12: 'A#', 13: 'F', 14: 'C', 15: 'G',
                    16: 'D', 17: 'A', 18: 'E', 19: 'B', 20: 'F#'
                };
                
                // Create tuning inputs grid
                const tuningGrid = document.createElement('div');
                tuningGrid.className = 'controls-grid';
                tuningGrid.style.display = 'grid';
                tuningGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(120px, 1fr))';
                tuningGrid.style.gap = '8px';
                
                for (let i = 1; i <= numStrings; i++) {
                    const tuningValue = (tuning && tuning[i]) || defaultTuning[i] || '';
                    const tuningInput = createInput('text', `tuning_${i}`, tuningValue,
                        (e) => {
                            const state = getCurrentFretboardState(targetId);
                            if (!state || !state.settingsGroupA) return;
                            
                            const currentTuning = (state.settingsGroupA.tuning) || {};
                            const newTuning = { ...currentTuning };
                            newTuning[i] = e.target.value.toUpperCase();
                            updateFretboardSetting(targetId, 'A', 'tuning', newTuning);
                        }
                    );
                    tuningInput.placeholder = '';
                    tuningInput.className = 'tuning-input';
                    tuningInput.maxLength = 4;
                    inputRefs.tuningInputs[i] = tuningInput;
                    tuningGrid.appendChild(createControlGroup(`String ${i}`, tuningInput, `tuning_${i}`));
                }
                
                tuningWrapper.appendChild(tuningGrid);
                content.appendChild(tuningWrapper);
            });
            groupAContent.appendChild(tuningStringsSection);
        }
        
        groupASection.appendChild(groupAContent);
        content.appendChild(groupASection);
        
        // Settings Group B - Fretboard Skin
        const groupBSection = document.createElement('div');
        groupBSection.className = 'settings-group-section';
        const groupBHeader = document.createElement('div');
        groupBHeader.className = 'settings-group-header';
        groupBHeader.textContent = 'Settings Group B - Fretboard Skin';
        groupBSection.appendChild(groupBHeader);
        const groupBContent = document.createElement('div');
        groupBContent.className = 'settings-group-content';
        
        const groupB = currentState.settingsGroupB || {};
        
        // Check if themes exist and add theme selector dropdown
        const themeInstance = window.Fretboard && window.Fretboard.getInstance 
            ? window.Fretboard.getInstance(targetId)
            : null;
        // Get themes from instance (check both instance.themes and instance.config.themes)
        const themes = (themeInstance && themeInstance.themes) 
            ? themeInstance.themes 
            : (themeInstance && themeInstance.config && themeInstance.config.themes)
                ? themeInstance.config.themes
                : null;
        
        if (themes && typeof themes === 'object' && Object.keys(themes).length > 0) {
            // Get active theme from themeInstance or use first theme key as default
            const firstThemeKey = Object.keys(themes)[0];
            const activeTheme = (themeInstance && themeInstance.activeTheme !== null && themeInstance.activeTheme !== undefined)
                ? themeInstance.activeTheme
                : firstThemeKey;
            
            // Create theme selector dropdown
            const themeOptions = Object.keys(themes).map(key => ({
                value: key,
                label: themes[key].themeLabel || key
            }));
            
            const themeSelector = createSelect('themeSelector', themeOptions, activeTheme,
                (e) => {
                    const selectedTheme = e.target.value;
                    if (window.Fretboard && window.Fretboard.applyTheme) {
                        window.Fretboard.applyTheme(selectedTheme, targetId);
                        // Sync panel after theme is applied
                        setTimeout(() => {
                            syncPanelFromFretboard(targetId);
                        }, 100);
                    }
                }
            );
            inputRefs.themeSelector = themeSelector;
            groupBContent.appendChild(createControlGroup('Theme', themeSelector, 'theme'));
        }
        
        if (groupB) {
            // Bindings & Markers Section (combined)
            const bindingsMarkersSection = createCollapsibleSection('Bindings & Markers', (content) => {
                const controlsGrid = document.createElement('div');
                controlsGrid.className = 'controls-grid';
                
                // Fretboard Binding Display
                const bindingCheckbox = createInput('checkbox', 'fretboardBindingDisplay', 
                    groupB.fretboardBindingDisplay !== false,
                    (e) => {
                        updateFretboardSetting(targetId, 'B', 'fretboardBindingDisplay', e.target.checked);
                    }
                );
                bindingCheckbox.checked = groupB.fretboardBindingDisplay !== false;
                inputRefs.fretboardBindingDisplay = bindingCheckbox;
                const bindingGroup = document.createElement('div');
                bindingGroup.className = 'control-group checkbox-group';
                bindingGroup.appendChild(bindingCheckbox);
                const bindingLabel = document.createElement('label');
                bindingLabel.textContent = 'Show Fretboard Bindings';
                bindingLabel.style.marginLeft = '5px';
                bindingGroup.appendChild(bindingLabel);
                const bindingVarName = document.createElement('div');
                bindingVarName.className = 'variable-name';
                bindingVarName.textContent = 'fretboardBindingDisplay';
                bindingGroup.appendChild(bindingVarName);
                controlsGrid.appendChild(bindingGroup);
                
                content.appendChild(controlsGrid);
                
                // Fret Position Markers
                const markersGroup = document.createElement('div');
                markersGroup.className = 'control-group';
                const markersLabel = document.createElement('label');
                markersLabel.textContent = 'Fret Position Markers';
                markersGroup.appendChild(markersLabel);
                const markersVarName = document.createElement('div');
                markersVarName.className = 'variable-name';
                markersVarName.textContent = 'fretMarkers';
                markersGroup.appendChild(markersVarName);
                const markersControlsDiv = document.createElement('div');
                markersControlsDiv.className = 'fret-marker-controls';
                markersGroup.appendChild(markersControlsDiv);
                const markersContainer = markersControlsDiv;
                const markerFrets = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];
                markerFrets.forEach(fret => {
                    const item = document.createElement('div');
                    item.className = 'fret-marker-item';
                    const select = createSelect(`fretMarker_${fret}`,
                        [
                            {value: '', label: 'None'},
                            {value: 'single', label: 'Single'},
                            {value: 'double', label: 'Double'}
                        ],
                        (groupB.fretMarkers && groupB.fretMarkers[fret]) || '',
                        (e) => {
                            const state = getCurrentFretboardState(targetId);
                            if (!state || !state.settingsGroupB) return;
                            
                            const currentMarkers = state.settingsGroupB.fretMarkers || {};
                            const newMarkers = { ...currentMarkers };
                            
                            if (e.target.value) {
                                newMarkers[fret] = e.target.value;
                            } else {
                                delete newMarkers[fret];
                            }
                            
                            updateFretboardSetting(targetId, 'B', 'fretMarkers', newMarkers);
                        }
                    );
                    item.appendChild(select);
                    const label = document.createElement('label');
                    label.textContent = `F${fret}`;
                    item.appendChild(label);
                    markersContainer.appendChild(item);
                    // Store reference for syncing
                    inputRefs[`fretMarker_${fret}`] = select;
                });
                content.appendChild(markersGroup);
            });
            groupBContent.appendChild(bindingsMarkersSection);
            
            // Colors Section (combined Text Colors and Background Colors)
            const colorsSection = createCollapsibleSection('Colors', (content) => {
                // Use single column layout for colors so they fit on their own rows
                const controlsContainer = document.createElement('div');
                controlsContainer.className = 'controls-container';
                
                // Text Colors
                const textColorVars = [
                    {key: '--tuning-label-color', label: 'Tuning Label Color'},
                    {key: '--fret-indicator-color', label: 'Fret Indicator Color'},
                    {key: '--fret-indicator-secondary', label: 'Fret Indicator Secondary'},
                    {key: '--fret-indicator-tertiary', label: 'Fret Indicator Tertiary'}
                ];
                
                textColorVars.forEach(v => {
                    // Get current value from state first (saved user changes)
                    // Only fall back to computed CSS if no saved value exists
                    let currentValue = '';
                    if (groupB.cssVariables && groupB.cssVariables[v.key]) {
                        currentValue = groupB.cssVariables[v.key];
                    } else {
                        // Only read from computed CSS if we don't have a saved value
                        currentValue = getCurrentCSSVariable(v.key);
                    }
                    
                    // Default fallback for color inputs
                    if (!currentValue && (v.key.includes('color') || v.key.includes('indicator'))) {
                        currentValue = '#333';
                    }
                    
                    // Create swatch for color input first (needed for opacity input)
                    const swatch = createColorSwatch(currentValue);
                    
                    const colorInputContainer = createColorInputWithOpacity(v.key, 
                        currentValue,
                        (e) => {
                            // Mark that user is actively editing this input
                            const instance = controlPanelInstances.get(targetId);
                            if (instance) {
                                instance.userEditing = true;
                                instance.editingKey = v.key;
                            }
                            
                            updateFretboardSetting(targetId, 'B', v.key, e.target.value);
                            
                            // Update swatch
                            if (swatch) swatch.updateSwatch(e.target.value);
                            
                            // Clear editing flag after a short delay to allow update to complete
                            if (instance) {
                                setTimeout(() => {
                                    instance.userEditing = false;
                                    instance.editingKey = null;
                                }, 300);
                            }
                        },
                        swatch
                    );
                    
                    const inputWrapper = document.createElement('div');
                    inputWrapper.style.display = 'flex';
                    inputWrapper.style.alignItems = 'center';
                    inputWrapper.style.gap = '8px';
                    inputWrapper.appendChild(colorInputContainer);
                    inputWrapper.appendChild(swatch);
                    
                    // Store reference for syncing - store the container so we can update it
                    if (!inputRefs.cssVarsB) inputRefs.cssVarsB = {};
                    inputRefs.cssVarsB[v.key] = colorInputContainer;
                    // Store swatch reference for updating
                    if (!inputRefs.swatchesB) inputRefs.swatchesB = {};
                    inputRefs.swatchesB[v.key] = swatch;
                    controlsContainer.appendChild(createControlGroup(v.label, inputWrapper, v.key));
                });
                
                // Dot Colors
                const dotColorVars = [
                    {key: '--dot-outer-circle-color', label: 'Dot Outer Circle Color'},
                    {key: '--dot-inner-circle-color', label: 'Dot Inner Circle Color'},
                    {key: '--dot-text-color', label: 'Dot Text Color'},
                    {key: '--hover-dot-outer-color', label: 'Hover Dot Outer Color'},
                    {key: '--hover-dot-outer-border-color', label: 'Hover Dot Outer Border Color'},
                    {key: '--hover-dot-inner-color', label: 'Hover Dot Inner Color'},
                    {key: '--hover-dot-text-color', label: 'Hover Dot Text Color'}
                ];
                
                dotColorVars.forEach(v => {
                    // Get current value from state first (saved user changes)
                    // Only fall back to computed CSS if no saved value exists
                    let currentValue = '';
                    if (groupB.cssVariables && groupB.cssVariables[v.key]) {
                        currentValue = groupB.cssVariables[v.key];
                    } else {
                        // Only read from computed CSS if we don't have a saved value
                        currentValue = getCurrentCSSVariable(v.key);
                    }
                    
                    // Default fallback for color inputs
                    if (!currentValue && (v.key.includes('color') || v.key.includes('indicator'))) {
                        currentValue = '#333';
                    }
                    
                    // Create swatch for color input first (needed for opacity input)
                    const swatch = createColorSwatch(currentValue);
                    
                    const colorInputContainer = createColorInputWithOpacity(v.key, 
                        currentValue,
                        (e) => {
                            // Mark that user is actively editing this input
                            const instance = controlPanelInstances.get(targetId);
                            if (instance) {
                                instance.userEditing = true;
                                instance.editingKey = v.key;
                            }
                            
                            updateFretboardSetting(targetId, 'B', v.key, e.target.value);
                            
                            // Update swatch
                            if (swatch) swatch.updateSwatch(e.target.value);
                            
                            // Clear editing flag after a short delay to allow update to complete
                            if (instance) {
                                setTimeout(() => {
                                    instance.userEditing = false;
                                    instance.editingKey = null;
                                }, 300);
                            }
                        },
                        swatch
                    );
                    
                    const inputWrapper = document.createElement('div');
                    inputWrapper.style.display = 'flex';
                    inputWrapper.style.alignItems = 'center';
                    inputWrapper.style.gap = '8px';
                    inputWrapper.appendChild(colorInputContainer);
                    inputWrapper.appendChild(swatch);
                    
                    // Store reference for syncing - store the container so we can update it
                    if (!inputRefs.cssVarsB) inputRefs.cssVarsB = {};
                    inputRefs.cssVarsB[v.key] = colorInputContainer;
                    // Store swatch reference for updating
                    if (!inputRefs.swatchesB) inputRefs.swatchesB = {};
                    inputRefs.swatchesB[v.key] = swatch;
                    controlsContainer.appendChild(createControlGroup(v.label, inputWrapper, v.key));
                });
                
                // Background Colors
                const bgVars = [
                    {key: '--fingerboard-row-0-color', label: 'Fingerboard Row 0 Color'},
                    {key: '--main-fret-area-bg-color', label: 'Main Fret Area BG Color'},
                    {key: '--fret-divider-color', label: 'Fret Divider Color'},
                    {key: '--nut-divider-color', label: 'Nut Divider Color'},
                    {key: '--fretbinding-background', label: 'Fretbinding Background'},
                    {key: '--marker-dot-color', label: 'Marker Dot Background'}
                ];
                
                bgVars.forEach(v => {
                    // Get current value from state first (saved user changes)
                    // For gradients, getComputedStyle might return empty, so prioritize saved state
                    let currentValue = '';
                    if (groupB.cssVariables && groupB.cssVariables[v.key]) {
                        currentValue = groupB.cssVariables[v.key];
                    } else {
                        // Try to read from computed CSS, but this might be empty for gradients
                        currentValue = getCurrentCSSVariable(v.key);
                        // If computed value is empty, try reading directly from the style attribute
                        if (!currentValue || currentValue.trim() === '') {
                            const computed = getComputedStyle(document.documentElement).getPropertyValue(v.key);
                            if (computed && computed.trim()) {
                                currentValue = computed.trim();
                            }
                        }
                    }
                    
                    // Check if this is a gradient input (these can accept gradients)
                    const canBeGradient = true; // All background vars can be gradients
                    
                    const input = createInput('text', v.key,
                        currentValue,
                        (e) => {
                            updateFretboardSetting(targetId, 'B', v.key, e.target.value);
                        },
                        'gradient or color'
                    );
                    
                    // Create swatch - use input value, fallback to currentValue
                    const swatch = createColorSwatch(input.value || currentValue || '', canBeGradient);
                    
                    // Immediately update swatch with the actual input value
                    if (input.value) {
                        swatch.updateSwatch(input.value);
                    }
                    
                    // Update swatch whenever input value changes - always use input.value
                    input.addEventListener('input', () => {
                        swatch.updateSwatch(input.value);
                    });
                    
                    input.addEventListener('change', () => {
                        swatch.updateSwatch(input.value);
                    });
                    
                    // Create wrapper - if it's a gradient, put swatch on its own row
                    const inputWrapper = document.createElement('div');
                    if (canBeGradient) {
                        // For gradient-capable inputs, use column layout
                        inputWrapper.style.display = 'flex';
                        inputWrapper.style.flexDirection = 'column';
                        inputWrapper.style.gap = '0';
                        
                        const inputRow = document.createElement('div');
                        inputRow.style.display = 'flex';
                        inputRow.style.alignItems = 'center';
                        inputRow.appendChild(input);
                        inputWrapper.appendChild(inputRow);
                        inputWrapper.appendChild(swatch);
                    } else {
                        // For solid colors only, inline layout
                        inputWrapper.style.display = 'flex';
                        inputWrapper.style.alignItems = 'center';
                        inputWrapper.appendChild(input);
                        inputWrapper.appendChild(swatch);
                    }
                    
                    // Store reference for syncing
                    if (!inputRefs.cssVarsB) inputRefs.cssVarsB = {};
                    inputRefs.cssVarsB[v.key] = input;
                    // Store swatch reference for updating
                    if (!inputRefs.swatchesB) inputRefs.swatchesB = {};
                    inputRefs.swatchesB[v.key] = swatch;
                    controlsContainer.appendChild(createControlGroup(v.label, inputWrapper, v.key));
                });
                
                // Main Fret Area Background Image
                const imageConfigValue = (groupB.cssVariables && groupB.cssVariables['--main-fret-area-bg-image']) || '';
                let imageCurrentValue = imageConfigValue || getCurrentCSSVariable('--main-fret-area-bg-image');
                // Extract URL from url("...") format if present
                if (imageCurrentValue && imageCurrentValue.startsWith('url(')) {
                    const match = imageCurrentValue.match(/url\(["']?([^"']+)["']?\)/);
                    if (match) {
                        imageCurrentValue = match[1];
                    }
                }
                
                const imageInput = createInput('text', '--main-fret-area-bg-image',
                    imageCurrentValue,
                    (e) => {
                        let value = e.target.value.trim();
                        // If empty or "no-image", set to empty string (will use color fallback)
                        if (value === '' || value.toLowerCase() === 'no-image') {
                            value = '';
                        } else if (value && !value.startsWith('url(')) {
                            // If it's a URL string, wrap it in url()
                            value = `url("${value}")`;
                        }
                        updateFretboardSetting(targetId, 'B', '--main-fret-area-bg-image', value);
                    },
                    'image URL or "no-image"'
                );
                // Store reference for syncing
                if (!inputRefs.cssVarsB) inputRefs.cssVarsB = {};
                inputRefs.cssVarsB['--main-fret-area-bg-image'] = imageInput;
                controlsContainer.appendChild(createControlGroup('Main Fret Area BG Image', imageInput, '--main-fret-area-bg-image'));
                
                // Marker Dot Background Image
                const markerImageConfigValue = (groupB.cssVariables && groupB.cssVariables['--marker-dot-background-image']) || '';
                let markerImageCurrentValue = markerImageConfigValue || getCurrentCSSVariable('--marker-dot-background-image');
                // Extract URL from url("...") format if present, or handle "none"/"no-dot-image"
                if (markerImageCurrentValue && markerImageCurrentValue.startsWith('url(')) {
                    const match = markerImageCurrentValue.match(/url\(["']?([^"']+)["']?\)/);
                    if (match) {
                        markerImageCurrentValue = match[1];
                    }
                } else if (markerImageCurrentValue === 'none' || markerImageCurrentValue === 'no-dot-image' || markerImageCurrentValue === 'no-image' || !markerImageCurrentValue) {
                    markerImageCurrentValue = '';
                }
                
                const markerImageInput = createInput('text', '--marker-dot-background-image',
                    markerImageCurrentValue,
                    (e) => {
                        let value = e.target.value.trim();
                        console.log('Marker dot image input changed:', value);
                        // If empty or "no-image"/"no-dot-image", set to "none" for CSS fallback
                        if (value === '' || value.toLowerCase() === 'no-image' || value.toLowerCase() === 'no-dot-image') {
                            value = 'none';
                        } else if (value && value !== 'none' && !value.startsWith('url(')) {
                            // If it's a URL string, wrap it in url()
                            value = `url("${value}")`;
                        }
                        console.log('Calling updateFretboardSetting with value:', value);
                        updateFretboardSetting(targetId, 'B', '--marker-dot-background-image', value);
                    },
                    'image URL or leave empty for color'
                );
                // Store reference for syncing
                if (!inputRefs.cssVarsB) inputRefs.cssVarsB = {};
                inputRefs.cssVarsB['--marker-dot-background-image'] = markerImageInput;
                controlsContainer.appendChild(createControlGroup('Marker Dot Background Image', markerImageInput, '--marker-dot-background-image'));
                
                content.appendChild(controlsContainer);
            });
            groupBContent.appendChild(colorsSection);
            
            // String Colors Section - store reference for rebuilding
            const stringColorsSectionElement = createCollapsibleSection('String Colors', (content) => {
                const controlsContainer = document.createElement('div');
                controlsContainer.className = 'controls-container';
                
                // Get current state to determine number of strings
                const state = getCurrentFretboardState(targetId);
                const numStrings = (state && state.settingsGroupA && state.settingsGroupA.numStrings) || 6;
                
                // Get CSS variables from Group B
                const groupB = (state && state.settingsGroupB) || {};
                const cssVarsForColors = (groupB.cssVariables) || {};
                
                // Helper function to create a color swatch for string colors
                function createStringColorSwatch(value) {
                    const swatch = document.createElement('div');
                    swatch.className = 'string-color-swatch';
                    swatch.style.width = '30px';
                    swatch.style.height = '30px';
                    swatch.style.border = '1px solid #ccc';
                    swatch.style.borderRadius = '4px';
                    swatch.style.display = 'inline-block';
                    swatch.style.verticalAlign = 'middle';
                    swatch.style.marginLeft = '8px';
                    swatch.title = 'Color preview';
                    
                    function updateSwatch(val) {
                        if (!val || !val.trim()) {
                            swatch.style.background = 'transparent';
                            swatch.style.backgroundImage = 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)';
                            swatch.style.backgroundSize = '8px 8px';
                            swatch.style.backgroundPosition = '0 0, 0 4px, 4px -4px, -4px 0px';
                        } else {
                            const bgValue = val.trim();
                            swatch.style.setProperty('background', bgValue, 'important');
                        }
                    }
                    
                    updateSwatch(value);
                    swatch.updateSwatch = updateSwatch;
                    return swatch;
                }
                
                // Create color input for each string
                for (let i = 1; i <= numStrings; i++) {
                    // Determine CSS variable name based on string number
                    // Strings 1-6 use --string-X-default-color, strings 7+ use --string-X-color
                    const cssVarName = i <= 6 ? `--string-${i}-default-color` : `--string-${i}-color`;
                    
                    // Get current value from CSS variable
                    let currentColorValue = '';
                    if (cssVarsForColors[cssVarName]) {
                        currentColorValue = cssVarsForColors[cssVarName];
                    } else {
                        currentColorValue = getCurrentCSSVariable(cssVarName);
                    }
                    
                    // Create text input for color/gradient
                    const colorInput = createInput('text', `string_color_${i}`, currentColorValue,
                        (e) => {
                            const instance = controlPanelInstances.get(targetId);
                            if (instance) {
                                instance.userEditing = true;
                                instance.editingKey = cssVarName;
                            }
                            
                            // Update CSS variable through Settings Group B
                            updateFretboardSetting(targetId, 'B', cssVarName, e.target.value);
                            
                            // Update swatch
                            if (swatch) swatch.updateSwatch(e.target.value);
                            
                            // Clear editing flag after a short delay
                            if (instance) {
                                setTimeout(() => {
                                    instance.userEditing = false;
                                    instance.editingKey = null;
                                }, 300);
                            }
                        }
                    );
                    colorInput.placeholder = 'Color/Gradient';
                    colorInput.className = 'string-color-input';
                    colorInput.style.width = '100%';
                    colorInput.style.fontSize = '11px';
                    colorInput.style.padding = '4px';
                    
                    // Create swatch
                    const swatch = createStringColorSwatch(currentColorValue);
                    
                    // Create wrapper for input and swatch
                    const colorInputWrapper = document.createElement('div');
                    colorInputWrapper.style.display = 'flex';
                    colorInputWrapper.style.alignItems = 'center';
                    colorInputWrapper.style.gap = '4px';
                    colorInputWrapper.appendChild(colorInput);
                    colorInputWrapper.appendChild(swatch);
                    
                    // Handle blur to ensure value is saved
                    colorInput.addEventListener('blur', (e) => {
                        const instance = controlPanelInstances.get(targetId);
                        if (instance) {
                            updateFretboardSetting(targetId, 'B', cssVarName, e.target.value);
                            if (swatch) swatch.updateSwatch(e.target.value);
                            setTimeout(() => {
                                instance.userEditing = false;
                                instance.editingKey = null;
                            }, 100);
                        }
                    });
                    
                    // Store reference for syncing
                    if (!inputRefs.stringColorInputs) inputRefs.stringColorInputs = {};
                    inputRefs.stringColorInputs[i] = colorInput;
                    if (!inputRefs.stringColorSwatches) inputRefs.stringColorSwatches = {};
                    inputRefs.stringColorSwatches[i] = swatch;
                    
                    controlsContainer.appendChild(createControlGroup(`String ${i} Color`, colorInputWrapper, cssVarName));
                }
                
                content.appendChild(controlsContainer);
            });
            groupBContent.appendChild(stringColorsSectionElement);
            
            // Store reference to string colors section for rebuilding
            const instance = controlPanelInstances.get(targetId);
            if (instance) {
                instance.stringColorsSection = stringColorsSectionElement;
            }
            
            // Interval Colors Section
            const intervalSection = createCollapsibleSection('Interval Colors', (content) => {
                const controlsGrid = document.createElement('div');
                controlsGrid.className = 'controls-grid color-grid';
            
            const intervalVars = [
                {key: '--interval-root-color', label: 'Root'},
                {key: '--interval-minor-2nd-color', label: 'Minor 2nd'},
                {key: '--interval-major-2nd-color', label: 'Major 2nd'},
                {key: '--interval-minor-3rd-color', label: 'Minor 3rd'},
                {key: '--interval-major-3rd-color', label: 'Major 3rd'},
                {key: '--interval-perfect-4th-color', label: 'Perfect 4th'},
                {key: '--interval-tritone-color', label: 'Tritone'},
                {key: '--interval-perfect-5th-color', label: 'Perfect 5th'},
                {key: '--interval-minor-6th-color', label: 'Minor 6th'},
                {key: '--interval-major-6th-color', label: 'Major 6th'},
                {key: '--interval-minor-7th-color', label: 'Minor 7th'},
                {key: '--interval-major-7th-color', label: 'Major 7th'},
                {key: '--interval-octave-color', label: 'Octave'},
                {key: '--interval-minor-9th-color', label: 'Minor 9th'},
                {key: '--interval-major-9th-color', label: 'Major 9th'},
                {key: '--interval-aug-9th-color', label: 'Augmented 9th'},
                {key: '--interval-perfect-11th-color', label: 'Perfect 11th'},
                {key: '--interval-aug-11th-color', label: 'Augmented 11th'}
            ];
            
            intervalVars.forEach(v => {
                // Get current value from state, or fall back to computed CSS variable value
                const configValue = (groupB.cssVariables && groupB.cssVariables[v.key]) || '';
                const currentValue = configValue || getCurrentCSSVariable(v.key);
                
                // Create swatch for color input first (needed for opacity input)
                const swatch = createColorSwatch(currentValue || '#000000');
                
                const colorInputContainer = createColorInputWithOpacity(v.key,
                    currentValue || '#000000',
                    (e) => {
                        updateFretboardSetting(targetId, 'B', v.key, e.target.value);
                        if (swatch) swatch.updateSwatch(e.target.value);
                    },
                    swatch
                );
                
                const inputWrapper = document.createElement('div');
                inputWrapper.style.display = 'flex';
                inputWrapper.style.alignItems = 'center';
                inputWrapper.style.gap = '8px';
                inputWrapper.appendChild(colorInputContainer);
                inputWrapper.appendChild(swatch);
                
                // Store reference for syncing
                if (!inputRefs.cssVarsB) inputRefs.cssVarsB = {};
                inputRefs.cssVarsB[v.key] = colorInputContainer;
                // Store swatch reference for updating
                if (!inputRefs.swatchesB) inputRefs.swatchesB = {};
                inputRefs.swatchesB[v.key] = swatch;
                controlsGrid.appendChild(createControlGroup(v.label, inputWrapper, v.key));
            });
            content.appendChild(controlsGrid);
            });
            groupBContent.appendChild(intervalSection);
            
            // Custom CSS Section
            const customCSSSection = createCollapsibleSection('Custom CSS', (content) => {
                const cssTextarea = document.createElement('textarea');
                cssTextarea.id = 'customCSS';
                cssTextarea.value = groupB.customCSS || '';
                cssTextarea.placeholder = 'Enter custom CSS rules here...\n\nExample:\n\n.chord_builder_fretboard_row {\n    backround: #ff0000;\n}';
                cssTextarea.style.width = '100%';
                cssTextarea.style.minHeight = '200px';
                cssTextarea.style.fontFamily = 'monospace';
                cssTextarea.style.fontSize = '11px';
                cssTextarea.style.padding = '8px';
                cssTextarea.style.border = '1px solid #aaa';
                cssTextarea.style.borderRadius = '3px';
                cssTextarea.style.resize = 'vertical';
                
                cssTextarea.addEventListener('input', (e) => {
                    updateFretboardSetting(targetId, 'B', 'customCSS', e.target.value);
                });
                
                inputRefs.customCSS = cssTextarea;
                content.appendChild(cssTextarea);
            });
            groupBContent.appendChild(customCSSSection);
        }
        
        groupBSection.appendChild(groupBContent);
        content.appendChild(groupBSection);
        console.log('Fretboard Control Panel: Control panel built successfully.');
        } catch (error) {
            console.error('Fretboard Control Panel: Error building control panel', error);
            const content = document.getElementById('controls-content');
            if (content) {
                content.innerHTML = '<p style="color: red;">Error building control panel. Check console for details.</p>';
            }
        }
    }
    
    // Generate export code from current state
    // Helper function to get all CSS variables from :root with their default values
    function getAllDefaultCSSVariables() {
        const allVars = {};
        const computedStyle = getComputedStyle(document.documentElement);
        
        // List of all CSS variables that can be configured
        // Settings Group A variables
        const groupAVars = [
            '--fretboard-width', '--fretboard-height', '--header-height',
            '--fret-0-height', '--string-thickest-width',
            '--string-thinnest-width', '--dot-size', '--interval-indicator-width',
            '--dot-text-font-size', '--interval-label-font-size',
            '--tuning-label-font-size', '--fret-indicator-font-size',
            '--fret-divider-height', '--fret-divider-width', '--nut-divider-height',
            '--string-1-default-color', '--string-2-default-color',
            '--string-3-default-color', '--string-4-default-color',
            '--string-5-default-color', '--string-6-default-color',
            '--string-7-color', '--string-8-color', '--string-9-color'
        ];
        
        // Settings Group B variables
        const groupBVars = [
            '--tuning-label-color', '--fret-indicator-color',
            '--fret-indicator-secondary', '--fret-indicator-tertiary',
            '--fingerboard-row-0-color', '--fingerboard-row-0-image',
            '--main-fret-area-bg-color', '--main-fret-area-bg-image',
            '--fret-divider-color', '--fret-divider-image',
            '--nut-divider-color', '--nut-divider-image',
            '--fretbinding-width', '--fretbinding-background',
            '--fretbinding-background-image', '--marker-dot-size',
            '--marker-dot-color', '--marker-dot-background-image',
            '--marker-dot-background', '--dot-outer-circle-color',
            '--dot-inner-circle-color', '--dot-text-color',
            '--hover-dot-outer-color', '--hover-dot-outer-border-color',
            '--hover-dot-inner-color', '--hover-dot-text-color',
            '--hover-interval-indicator-text-color',
            '--hover-interval-indicator-border-color', '--interval-root-color',
            '--interval-minor-2nd-color', '--interval-major-2nd-color',
            '--interval-minor-3rd-color', '--interval-major-3rd-color',
            '--interval-perfect-4th-color', '--interval-tritone-color',
            '--interval-perfect-5th-color', '--interval-minor-6th-color',
            '--interval-major-6th-color', '--interval-minor-7th-color',
            '--interval-major-7th-color', '--interval-octave-color',
            '--interval-minor-9th-color', '--interval-major-9th-color',
            '--interval-aug-9th-color', '--interval-perfect-11th-color',
            '--interval-aug-11th-color'
        ];
        
        // Combine all variables
        const allVarNames = [...groupAVars, ...groupBVars];
        
        allVarNames.forEach(varName => {
            const value = computedStyle.getPropertyValue(varName).trim();
            if (value) {
                allVars[varName] = value;
            }
        });
        
        return { groupA: groupAVars, groupB: groupBVars, allValues: allVars };
    }
    
    function generateExportCode(state, targetId, includeGroupA, includeGroupB, includeGroupC, includeAllVariables = false) {
        const config = state; // Use state directly (it has the same structure)
        // Find the target element to get containerId
        const targetElement = document.querySelector(`[data-fretboard-id="${targetId}"]`);
        const containerId = targetElement ? targetElement.id : 'my-fretboard';
        
        // Get all default CSS variables if includeAllVariables is true
        const defaultCSSVars = includeAllVariables ? getAllDefaultCSSVariables() : null;
        
        // Default values for merging
        const defaultGroupA = {
            dotTextMode: 'note',
            showFretIndicators: 'first-fret-cond',
            tuning: null,
            numStrings: 6,
            stringType: '1',
            cssVariables: {}
        };
        
        const defaultGroupB = {
            fretMarkers: {
                3: 'single', 5: 'single', 7: 'single', 9: 'single',
                12: 'double', 15: 'single', 17: 'single', 19: 'single',
                21: 'single', 24: 'double'
            },
            fretboardBindingDisplay: true,
            cssVariables: {}
        };
        
        const defaultGroupC = {
            name: null,
            root: null,
            startFret: 1,
            numFrets: 4,
            fingering: []
        };
        
        let code = 'Fretboard.init({\n';
        code += `    containerId: '${containerId}',\n`;
        code += `    fretboardId: '${targetId}',\n`;
        code += `    cssPath: 'fretboard.css',\n`;
        
        if (includeGroupA) {
            code += '\n    // Settings Group A - Fretboard Variables\n';
            code += '    settingsGroupA: {\n';
            
            const groupA = config.settingsGroupA || {};
            const mergedA = { ...defaultGroupA, ...groupA };
            if (groupA.cssVariables) {
                mergedA.cssVariables = { ...defaultGroupA.cssVariables, ...groupA.cssVariables };
            }
            
            const groupAProps = [];
            
            // Always include JavaScript variables
            groupAProps.push(`        dotTextMode: '${mergedA.dotTextMode || defaultGroupA.dotTextMode}'`);
            groupAProps.push(`        showFretIndicators: '${mergedA.showFretIndicators || defaultGroupA.showFretIndicators}'`);
            
            // numStrings and stringType - always include
            groupAProps.push(`        numStrings: ${mergedA.numStrings !== undefined ? mergedA.numStrings : defaultGroupA.numStrings}`);
            groupAProps.push(`        stringType: '${mergedA.stringType || defaultGroupA.stringType}'`);
            
            // Tuning - always include, even if null
            if (mergedA.tuning && Object.keys(mergedA.tuning).length > 0) {
                let tuningCode = '        tuning: {\n';
                const tuningKeys = Object.keys(mergedA.tuning).sort((a, b) => parseInt(a) - parseInt(b));
                tuningKeys.forEach((string, idx) => {
                    tuningCode += `            ${string}: '${mergedA.tuning[string]}'`;
                    if (idx < tuningKeys.length - 1) tuningCode += ',';
                    tuningCode += '\n';
                });
                tuningCode += '        }';
                groupAProps.push(tuningCode);
            } else {
                groupAProps.push('        tuning: null');
            }
            
            // CSS variables
            let cssVarsToInclude = { ...mergedA.cssVariables };
            
            // If includeAllVariables is true, merge with all default Group A CSS variables
            if (includeAllVariables && defaultCSSVars) {
                defaultCSSVars.groupA.forEach(varName => {
                    // Only add if not already in cssVarsToInclude (user changes take precedence)
                    if (!cssVarsToInclude.hasOwnProperty(varName)) {
                        const defaultValue = defaultCSSVars.allValues[varName];
                        if (defaultValue) {
                            cssVarsToInclude[varName] = defaultValue;
                        }
                    }
                });
            }
            
            // Include CSS variables if there are any (or if includeAllVariables is true)
            if (Object.keys(cssVarsToInclude).length > 0) {
                let cssVarsCode = '        cssVariables: {\n';
                const cssVarKeys = Object.keys(cssVarsToInclude).sort();
                cssVarKeys.forEach((key, idx) => {
                    const value = cssVarsToInclude[key];
                    // Escape single quotes in values
                    const escapedValue = value.replace(/'/g, "\\'");
                    cssVarsCode += `            '${key}': '${escapedValue}'`;
                    if (idx < cssVarKeys.length - 1) cssVarsCode += ',';
                    cssVarsCode += '\n';
                });
                cssVarsCode += '        }';
                groupAProps.push(cssVarsCode);
            }
            
            code += groupAProps.join(',\n');
            code += '\n    },\n';
        }
        
        if (includeGroupB) {
            const groupB = config.settingsGroupB || {};
            const mergedB = { ...defaultGroupB, ...groupB };
            const cssVars = mergedB.cssVariables || {};
            
            // Always include settingsGroupB
            code += '\n    // Settings Group B - Fretboard Skin\n';
            code += '    settingsGroupB: {\n';
            
            const groupBProps = [];
            
            // Always include fret markers (use merged or defaults)
            const markers = mergedB.fretMarkers || defaultGroupB.fretMarkers;
            let markersCode = '        fretMarkers: {\n';
            const markerKeys = Object.keys(markers).sort((a, b) => parseInt(a) - parseInt(b));
            markerKeys.forEach((fret, idx) => {
                markersCode += `            ${fret}: '${markers[fret]}'`;
                if (idx < markerKeys.length - 1) markersCode += ',';
                markersCode += '\n';
            });
            markersCode += '        }';
            groupBProps.push(markersCode);
            
            // Always include binding display
            groupBProps.push(`        fretboardBindingDisplay: ${mergedB.fretboardBindingDisplay !== undefined ? mergedB.fretboardBindingDisplay : defaultGroupB.fretboardBindingDisplay}`);
            
            // CSS variables
            let cssVarsToInclude = { ...cssVars };
            
            // If includeAllVariables is true, merge with all default Group B CSS variables
            if (includeAllVariables && defaultCSSVars) {
                defaultCSSVars.groupB.forEach(varName => {
                    // Only add if not already in cssVarsToInclude (user changes take precedence)
                    if (!cssVarsToInclude.hasOwnProperty(varName)) {
                        const defaultValue = defaultCSSVars.allValues[varName];
                        if (defaultValue) {
                            cssVarsToInclude[varName] = defaultValue;
                        }
                    }
                });
            }
            
            // Include CSS variables if there are any (or if includeAllVariables is true)
            if (Object.keys(cssVarsToInclude).length > 0) {
                let cssVarsCode = '        cssVariables: {\n';
                const cssVarKeys = Object.keys(cssVarsToInclude).sort();
                cssVarKeys.forEach((key, idx) => {
                    const value = cssVarsToInclude[key];
                    // Escape single quotes in values
                    const escapedValue = value.replace(/'/g, "\\'");
                    cssVarsCode += `            '${key}': '${escapedValue}'`;
                    if (idx < cssVarKeys.length - 1) cssVarsCode += ',';
                    cssVarsCode += '\n';
                });
                cssVarsCode += '        }';
                groupBProps.push(cssVarsCode);
            }
            
            // Include custom CSS if it exists and is not empty
            if (mergedB.customCSS && mergedB.customCSS.trim() !== '') {
                // Escape backticks, backslashes, and newlines for proper string formatting
                const escapedCSS = mergedB.customCSS
                    .replace(/\\/g, '\\\\')
                    .replace(/`/g, '\\`')
                    .replace(/\n/g, '\\n')
                    .replace(/'/g, "\\'");
                groupBProps.push(`        customCSS: '${escapedCSS}'`);
            }
            
            code += groupBProps.join(',\n');
            code += '\n    },\n';
        }
        
        if (includeGroupC) {
            const groupC = config.settingsGroupC || {};
            const mergedC = { ...defaultGroupC, ...groupC };
            
            // Check if there are any actual fingering dots (not empty or all invalid)
            const fingering = mergedC.fingering || [];
            const hasValidFingering = fingering.length > 0 && fingering.some(f => {
                // A valid fingering entry has a fret value that is a number >= 0 (not 'none', null, or -1)
                const fret = f.fret;
                return fret !== undefined && fret !== null && fret !== 'none' && fret !== -1 && typeof fret === 'number' && fret >= 0;
            });
            
            // Only include settingsGroupC if there are valid fingering dots
            if (hasValidFingering) {
                code += '\n    // Settings Group C - Chord Variables\n';
                code += '    settingsGroupC: {\n';
                
                const groupCProps = [];
                
                // Always include all properties
                groupCProps.push(`        name: ${mergedC.name !== null && mergedC.name !== undefined ? `"${mergedC.name}"` : 'null'}`);
                groupCProps.push(`        root: ${mergedC.root !== null && mergedC.root !== undefined ? `"${mergedC.root}"` : 'null'}`);
                groupCProps.push(`        startFret: ${mergedC.startFret !== undefined ? mergedC.startFret : defaultGroupC.startFret}`);
                groupCProps.push(`        numFrets: ${mergedC.numFrets !== undefined ? mergedC.numFrets : defaultGroupC.numFrets}`);
                
                // Fingering - only include valid entries
                // Sort by string number (primary) and fret number (secondary) for consistent export order
                let fingeringCode = '        fingering: [\n';
                const sortedFingering = fingering.slice().sort((a, b) => {
                    // Primary sort: by string number
                    const stringDiff = (a.string || 0) - (b.string || 0);
                    if (stringDiff !== 0) return stringDiff;
                    // Secondary sort: by fret number (if strings are equal)
                    const aFret = a.fret === 'none' || a.fret === null || a.fret === undefined ? -999 : (a.fret || 0);
                    const bFret = b.fret === 'none' || b.fret === null || b.fret === undefined ? -999 : (b.fret || 0);
                    return aFret - bFret;
                });
                
                // Filter to only include valid entries (fret is a number >= 0)
                const validFingering = sortedFingering.filter(f => {
                    const fret = f.fret;
                    return fret !== undefined && fret !== null && fret !== 'none' && fret !== -1 && typeof fret === 'number' && fret >= 0;
                });
                
                if (validFingering.length > 0) {
                    validFingering.forEach((f, idx) => {
                        const fretValue = f.fret || 0;
                        const fingerValue = f.finger !== undefined && f.finger !== null ? f.finger : 0;
                        const stringValue = f.string || 1;
                        
                        fingeringCode += `            { string: ${stringValue}, fret: ${fretValue}, finger: ${fingerValue} }`;
                        if (idx < validFingering.length - 1) fingeringCode += ',';
                        fingeringCode += '\n';
                    });
                }
                fingeringCode += '        ]';
                groupCProps.push(fingeringCode);
                
                code += groupCProps.join(',\n');
                code += '\n    }\n';
            }
        }
        
        code += '});';
        return code;
    }
    
    // Generate theme export code (only Settings Group B as theme format)
    function generateThemeExportCode(state, targetId, themeName = 'myTheme', themeLabel = null) {
        const config = state;
        const groupB = config.settingsGroupB || {};
        
        // Default values for merging
        const defaultGroupB = {
            fretMarkers: {
                3: 'single', 5: 'single', 7: 'single', 9: 'single',
                12: 'double', 15: 'single', 17: 'single', 19: 'single',
                21: 'single', 24: 'double'
            },
            fretboardBindingDisplay: true,
            cssVariables: {}
        };
        
        const mergedB = { ...defaultGroupB, ...groupB };
        const cssVars = mergedB.cssVariables || {};
        
        // Use provided themeLabel or generate from themeName
        const displayLabel = themeLabel || themeName.charAt(0).toUpperCase() + themeName.slice(1).replace(/([A-Z])/g, ' $1').trim();
        
        let code = 'themes: {\n';
        code += `        ${themeName}: {\n`;
        code += `            themeLabel: '${displayLabel}',\n`;
        
        // Fret markers
        const markers = mergedB.fretMarkers || defaultGroupB.fretMarkers;
        code += '            fretMarkers: {\n';
        const markerKeys = Object.keys(markers).sort((a, b) => parseInt(a) - parseInt(b));
        markerKeys.forEach((fret, idx) => {
            code += `                ${fret}: '${markers[fret]}'`;
            if (idx < markerKeys.length - 1) code += ',';
            code += '\n';
        });
        code += '            },\n';
        
        // Binding display
        code += `            fretboardBindingDisplay: ${mergedB.fretboardBindingDisplay !== undefined ? mergedB.fretboardBindingDisplay : defaultGroupB.fretboardBindingDisplay},\n`;
        
        // CSS variables
        code += '            cssVariables: {\n';
        const cssVarKeys = Object.keys(cssVars).sort();
        if (cssVarKeys.length > 0) {
            cssVarKeys.forEach((key, idx) => {
                const value = cssVars[key];
                // Escape single quotes in values
                const escapedValue = value.replace(/'/g, "\\'");
                code += `                '${key}': '${escapedValue}'`;
                if (idx < cssVarKeys.length - 1) code += ',';
                code += '\n';
            });
        }
        code += '            }';
        
        // Include custom CSS if it exists and is not empty
        if (mergedB.customCSS && mergedB.customCSS.trim() !== '') {
            // Escape backticks, backslashes, and newlines for proper string formatting
            const escapedCSS = mergedB.customCSS
                .replace(/\\/g, '\\\\')
                .replace(/`/g, '\\`')
                .replace(/\n/g, '\\n')
                .replace(/'/g, "\\'");
            code += ',\n';
            code += `            customCSS: '${escapedCSS}'`;
        }
        
        code += '\n            }\n';
        code += '        }\n';
        code += '    }';
        
        return code;
    }
    
    // Generate instrument export code (only Settings Group A as instrument format)
    function generateInstrumentExportCode(state, targetId, instrumentName = 'myInstrument', instrumentLabel = null) {
        const config = state;
        const groupA = config.settingsGroupA || {};
        
        // Default values for merging
        const defaultGroupA = {
            tuning: { 1: 'E', 2: 'A', 3: 'D', 4: 'G', 5: 'B', 6: 'E' },
            numStrings: 6,
            stringType: '1'
        };
        
        const mergedA = { ...defaultGroupA, ...groupA };
        
        // Use provided instrumentLabel or generate from instrumentName
        const displayLabel = instrumentLabel || instrumentName.charAt(0).toUpperCase() + instrumentName.slice(1).replace(/([A-Z])/g, ' $1').trim();
        
        let code = 'instruments: {\n';
        code += `        ${instrumentName}: {\n`;
        code += `            instrumentLabel: '${displayLabel}',\n`;
        
        // Tuning
        code += '            tuning: {\n';
        const tuningKeys = Object.keys(mergedA.tuning || {}).sort((a, b) => parseInt(a) - parseInt(b));
        tuningKeys.forEach((key, idx) => {
            const note = mergedA.tuning[key];
            code += `                ${key}: '${note}'`;
            if (idx < tuningKeys.length - 1) code += ',';
            code += '\n';
        });
        code += '            },\n';
        
        // Number of strings
        code += `            numStrings: ${mergedA.numStrings !== undefined ? mergedA.numStrings : defaultGroupA.numStrings},\n`;
        
        // String type
        code += `            stringType: '${mergedA.stringType !== undefined ? mergedA.stringType : defaultGroupA.stringType}'`;
        
        code += '\n        }\n';
        code += '    }';
        
        return code;
    }
    
    // Show export modal
    function showExportModal(config, targetId) {
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.className = 'export-modal-overlay';
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
            }
        });
        
        // Create modal
        const modal = document.createElement('div');
        modal.className = 'export-modal';
        
        // Modal header
        const header = document.createElement('div');
        header.className = 'export-modal-header';
        header.innerHTML = '<h3>Export Settings</h3><button class="export-modal-close">&times;</button>';
        header.querySelector('.export-modal-close').addEventListener('click', () => {
            overlay.remove();
        });
        
        // Group toggles
        const togglesDiv = document.createElement('div');
        togglesDiv.className = 'export-group-toggles';
        
        const groupAEnabled = document.createElement('label');
        groupAEnabled.className = 'export-toggle-label';
        const groupACheckbox = document.createElement('input');
        groupACheckbox.type = 'checkbox';
        groupACheckbox.checked = true;
        groupACheckbox.id = 'export-group-a';
        groupAEnabled.appendChild(groupACheckbox);
        groupAEnabled.appendChild(document.createTextNode(' Fretboard Variables'));
        
        const groupBEnabled = document.createElement('label');
        groupBEnabled.className = 'export-toggle-label';
        const groupBCheckbox = document.createElement('input');
        groupBCheckbox.type = 'checkbox';
        groupBCheckbox.checked = true;
        groupBCheckbox.id = 'export-group-b';
        groupBEnabled.appendChild(groupBCheckbox);
        groupBEnabled.appendChild(document.createTextNode(' Fretboard Skin'));
        
        const groupCEnabled = document.createElement('label');
        groupCEnabled.className = 'export-toggle-label';
        const groupCCheckbox = document.createElement('input');
        groupCCheckbox.type = 'checkbox';
        groupCCheckbox.checked = true;
        groupCCheckbox.id = 'export-group-c';
        groupCEnabled.appendChild(groupCCheckbox);
        groupCEnabled.appendChild(document.createTextNode(' Chord Variables'));
        
        togglesDiv.appendChild(groupAEnabled);
        togglesDiv.appendChild(groupBEnabled);
        togglesDiv.appendChild(groupCEnabled);
        
        // Add checkbox for including all variables with defaults
        const includeAllVarsLabel = document.createElement('label');
        includeAllVarsLabel.className = 'export-toggle-label';
        const includeAllVarsCheckbox = document.createElement('input');
        includeAllVarsCheckbox.type = 'checkbox';
        includeAllVarsCheckbox.checked = false;
        includeAllVarsCheckbox.id = 'export-include-all-vars';
        includeAllVarsLabel.appendChild(includeAllVarsCheckbox);
        includeAllVarsLabel.appendChild(document.createTextNode(' Include all variables (with defaults)'));
        togglesDiv.appendChild(includeAllVarsLabel);
        
        // Add checkbox for exporting as theme
        const exportAsThemeLabel = document.createElement('label');
        exportAsThemeLabel.className = 'export-toggle-label';
        const exportAsThemeCheckbox = document.createElement('input');
        exportAsThemeCheckbox.type = 'checkbox';
        exportAsThemeCheckbox.checked = false;
        exportAsThemeCheckbox.id = 'export-as-theme';
        exportAsThemeLabel.appendChild(exportAsThemeCheckbox);
        exportAsThemeLabel.appendChild(document.createTextNode(' Export as Theme (Settings Group B only)'));
        togglesDiv.appendChild(exportAsThemeLabel);
        
        // Add checkbox for exporting as instrument
        const exportAsInstrumentLabel = document.createElement('label');
        exportAsInstrumentLabel.className = 'export-toggle-label';
        const exportAsInstrumentCheckbox = document.createElement('input');
        exportAsInstrumentCheckbox.type = 'checkbox';
        exportAsInstrumentCheckbox.checked = false;
        exportAsInstrumentCheckbox.id = 'export-as-instrument';
        exportAsInstrumentLabel.appendChild(exportAsInstrumentCheckbox);
        exportAsInstrumentLabel.appendChild(document.createTextNode(' Export as Instrument (Settings Group A only)'));
        togglesDiv.appendChild(exportAsInstrumentLabel);
        
        // Theme name input (shown when export as theme is checked)
        const themeNameContainer = document.createElement('div');
        themeNameContainer.style.display = 'none';
        themeNameContainer.style.padding = '10px 20px';
        themeNameContainer.style.borderBottom = '1px solid #ddd';
        const themeNameLabel = document.createElement('label');
        themeNameLabel.textContent = 'Theme Name: ';
        themeNameLabel.style.marginRight = '10px';
        const themeNameInput = document.createElement('input');
        themeNameInput.type = 'text';
        themeNameInput.value = 'myTheme';
        themeNameInput.style.padding = '5px';
        themeNameInput.style.width = '150px';
        themeNameInput.id = 'export-theme-name';
        themeNameContainer.appendChild(themeNameLabel);
        themeNameContainer.appendChild(themeNameInput);
        
        // Instrument name input (shown when export as instrument is checked)
        const instrumentNameContainer = document.createElement('div');
        instrumentNameContainer.style.display = 'none';
        instrumentNameContainer.style.padding = '10px 20px';
        instrumentNameContainer.style.borderBottom = '1px solid #ddd';
        const instrumentNameLabel = document.createElement('label');
        instrumentNameLabel.textContent = 'Instrument Name: ';
        instrumentNameLabel.style.marginRight = '10px';
        const instrumentNameInput = document.createElement('input');
        instrumentNameInput.type = 'text';
        instrumentNameInput.value = 'myInstrument';
        instrumentNameInput.style.padding = '5px';
        instrumentNameInput.style.width = '150px';
        instrumentNameInput.id = 'export-instrument-name';
        instrumentNameContainer.appendChild(instrumentNameLabel);
        instrumentNameContainer.appendChild(instrumentNameInput);
        
        // Handle export as theme checkbox change
        exportAsThemeCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            if (isChecked) {
                // Disable other checkboxes and force Group B to be checked
                groupACheckbox.disabled = true;
                groupCCheckbox.disabled = true;
                includeAllVarsCheckbox.disabled = true;
                groupBCheckbox.checked = true;
                groupBCheckbox.disabled = true;
                exportAsInstrumentCheckbox.disabled = true;
                exportAsInstrumentCheckbox.checked = false;
                themeNameContainer.style.display = 'block';
                instrumentNameContainer.style.display = 'none';
            } else {
                // Re-enable all checkboxes
                groupACheckbox.disabled = false;
                groupCCheckbox.disabled = false;
                includeAllVarsCheckbox.disabled = false;
                groupBCheckbox.disabled = false;
                exportAsInstrumentCheckbox.disabled = false;
                themeNameContainer.style.display = 'none';
            }
            updateCode();
        });
        
        // Handle export as instrument checkbox change
        exportAsInstrumentCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            if (isChecked) {
                // Disable other checkboxes and force Group A to be checked
                groupBCheckbox.disabled = true;
                groupCCheckbox.disabled = true;
                includeAllVarsCheckbox.disabled = true;
                groupACheckbox.checked = true;
                groupACheckbox.disabled = true;
                exportAsThemeCheckbox.disabled = true;
                exportAsThemeCheckbox.checked = false;
                instrumentNameContainer.style.display = 'block';
                themeNameContainer.style.display = 'none';
            } else {
                // Re-enable all checkboxes
                groupACheckbox.disabled = false;
                groupBCheckbox.disabled = false;
                groupCCheckbox.disabled = false;
                includeAllVarsCheckbox.disabled = false;
                exportAsThemeCheckbox.disabled = false;
                instrumentNameContainer.style.display = 'none';
            }
            updateCode();
        });
        
        // Code textarea
        const codeTextarea = document.createElement('textarea');
        codeTextarea.className = 'export-code-textarea';
        codeTextarea.readOnly = true;
        
        // Update code when toggles change
        function updateCode() {
            const exportAsTheme = exportAsThemeCheckbox.checked;
            const exportAsInstrument = exportAsInstrumentCheckbox.checked;
            
            if (exportAsTheme) {
                // Export as theme format (only Settings Group B)
                const themeName = themeNameInput.value.trim() || 'myTheme';
                const themeLabel = themeName.charAt(0).toUpperCase() + themeName.slice(1).replace(/([A-Z])/g, ' $1').trim();
                codeTextarea.value = generateThemeExportCode(config, targetId, themeName, themeLabel);
            } else if (exportAsInstrument) {
                // Export as instrument format (only Settings Group A)
                const instrumentName = instrumentNameInput.value.trim() || 'myInstrument';
                const instrumentLabel = instrumentName.charAt(0).toUpperCase() + instrumentName.slice(1).replace(/([A-Z])/g, ' $1').trim();
                codeTextarea.value = generateInstrumentExportCode(config, targetId, instrumentName, instrumentLabel);
            } else {
                // Normal export format
                const includeA = groupACheckbox.checked;
                const includeB = groupBCheckbox.checked;
                const includeC = groupCCheckbox.checked;
                const includeAllVars = includeAllVarsCheckbox.checked;
                codeTextarea.value = generateExportCode(config, targetId, includeA, includeB, includeC, includeAllVars);
            }
        }
        
        groupACheckbox.addEventListener('change', updateCode);
        groupBCheckbox.addEventListener('change', updateCode);
        groupCCheckbox.addEventListener('change', updateCode);
        includeAllVarsCheckbox.addEventListener('change', updateCode);
        exportAsThemeCheckbox.addEventListener('change', updateCode);
        exportAsInstrumentCheckbox.addEventListener('change', updateCode);
        themeNameInput.addEventListener('input', updateCode);
        instrumentNameInput.addEventListener('input', updateCode);
        
        // Initial code generation
        updateCode();
        
        // Copy button
        const copyButton = document.createElement('button');
        copyButton.className = 'export-copy-btn';
        copyButton.textContent = 'Copy to Clipboard';
        copyButton.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(codeTextarea.value);
                copyButton.textContent = 'Copied!';
                setTimeout(() => {
                    copyButton.textContent = 'Copy to Clipboard';
                }, 2000);
            } catch (err) {
                // Fallback for older browsers
                codeTextarea.select();
                document.execCommand('copy');
                copyButton.textContent = 'Copied!';
                setTimeout(() => {
                    copyButton.textContent = 'Copy to Clipboard';
                }, 2000);
            }
        });
        
        // Assemble modal
        modal.appendChild(header);
        modal.appendChild(togglesDiv);
        modal.appendChild(themeNameContainer);
        modal.appendChild(instrumentNameContainer);
        modal.appendChild(codeTextarea);
        modal.appendChild(copyButton);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    }
    
    // Show import modal
    function showImportModal(targetId) {
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.className = 'export-modal-overlay';
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
            }
        });
        
        // Create modal
        const modal = document.createElement('div');
        modal.className = 'export-modal';
        
        // Modal header
        const header = document.createElement('div');
        header.className = 'export-modal-header';
        header.innerHTML = '<h3>Import Settings</h3><button class="export-modal-close">&times;</button>';
        header.querySelector('.export-modal-close').addEventListener('click', () => {
            overlay.remove();
        });
        
        // Instructions
        const instructions = document.createElement('div');
        instructions.style.padding = '15px 20px';
        instructions.style.borderBottom = '1px solid #ddd';
        instructions.style.fontSize = '14px';
        instructions.style.color = '#666';
        instructions.textContent = 'Paste the exported settings code below and click Import to apply:';
        
        // Code textarea (editable for import)
        const codeTextarea = document.createElement('textarea');
        codeTextarea.className = 'export-code-textarea';
        codeTextarea.placeholder = 'Paste exported code here...\n\nExample:\nFretboard.init({\n    containerId: \'my-fretboard\',\n    settingsGroupA: { ... },\n    ...\n});';
        codeTextarea.style.minHeight = '300px';
        codeTextarea.style.whiteSpace = 'pre';
        codeTextarea.style.overflowWrap = 'normal';
        // Ensure no maxlength restriction
        codeTextarea.removeAttribute('maxlength');
        
        // Error message area
        const errorDiv = document.createElement('div');
        errorDiv.style.padding = '10px 20px';
        errorDiv.style.color = '#d32f2f';
        errorDiv.style.fontSize = '14px';
        errorDiv.style.display = 'none';
        
        // Import button
        const importButton = document.createElement('button');
        importButton.className = 'export-copy-btn';
        importButton.textContent = 'Import Settings';
        importButton.style.background = '#2196F3';
        importButton.addEventListener('click', () => {
            const code = codeTextarea.value.trim();
            if (!code) {
                errorDiv.textContent = 'Please paste the exported code.';
                errorDiv.style.display = 'block';
                return;
            }
            
            errorDiv.style.display = 'none';
            
            (async () => {
                try {
                    console.log('Code length:', code.length);
                    console.log('Parsing code (first 500 chars):', code.substring(0, 500));
                    console.log('Code (last 500 chars):', code.substring(Math.max(0, code.length - 500)));
                    const settings = parseExportCode(code);
                    console.log('Parsed settings:', settings);
                    
                    if (settings && (settings.settingsGroupA || settings.settingsGroupB || settings.settingsGroupC)) {
                        console.log('Applying settings...');
                        await applyImportedSettings(settings, targetId);
                        console.log('Settings applied successfully');
                        errorDiv.style.display = 'none';
                        overlay.remove();
                    } else {
                        errorDiv.textContent = 'Could not parse the code or no settings found. Please check the format.';
                        errorDiv.style.display = 'block';
                        console.error('No settings found in parsed result:', settings);
                    }
                } catch (err) {
                    errorDiv.textContent = 'Error: ' + err.message + ' (Check console for details)';
                    errorDiv.style.display = 'block';
                    console.error('Import error:', err);
                    console.error('Error stack:', err.stack);
                }
            })();
        });
        
        // Assemble modal
        modal.appendChild(header);
        modal.appendChild(instructions);
        modal.appendChild(codeTextarea);
        modal.appendChild(errorDiv);
        modal.appendChild(importButton);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        // Focus textarea
        setTimeout(() => codeTextarea.focus(), 100);
    }
    
    // Parse exported code to extract settings
    function parseExportCode(code) {
        try {
            // Trim the code
            code = code.trim();
            
            // Log full code length for debugging
            console.log('Code length:', code.length);
            
            // Remove comments (single line and multi-line) but preserve the structure
            // We'll do this more carefully to not break string parsing
            const lines = code.split('\n');
            const cleanedLines = lines.map(line => {
                // Only remove comments that are not inside strings
                // Simple approach: remove // comments at end of line (but not in strings)
                const commentIdx = line.indexOf('//');
                if (commentIdx !== -1) {
                    // Check if // is inside a string
                    let inString = false;
                    let stringChar = null;
                    for (let i = 0; i < commentIdx; i++) {
                        const char = line[i];
                        const prevChar = i > 0 ? line[i - 1] : '';
                        if (!inString && (char === '"' || char === "'")) {
                            inString = true;
                            stringChar = char;
                        } else if (inString && char === stringChar && prevChar !== '\\') {
                            inString = false;
                            stringChar = null;
                        }
                    }
                    if (!inString) {
                        return line.substring(0, commentIdx).trimEnd();
                    }
                }
                return line;
            });
            code = cleanedLines.join('\n');
            
            // Remove multi-line comments
            code = code.replace(/\/\*[\s\S]*?\*\//g, '');
            
            // Extract the object passed to Fretboard.init()
            // Find the opening brace after Fretboard.init(
            let startIdx = code.indexOf('Fretboard.init(');
            if (startIdx === -1) {
                // Try without Fretboard.init wrapper
                startIdx = code.indexOf('{');
                if (startIdx === -1) {
                    throw new Error('Could not find object in code. Make sure the code includes Fretboard.init({...}) or {...}');
                }
            } else {
                // Find the opening brace
                startIdx = code.indexOf('{', startIdx);
                if (startIdx === -1) {
                    throw new Error('Could not find opening brace after Fretboard.init(');
                }
            }
            
            // Find the matching closing brace by counting braces
            // Improved string handling to account for escaped quotes
            let braceCount = 0;
            let inString = false;
            let stringChar = null;
            let endIdx = -1;
            
            for (let i = startIdx; i < code.length; i++) {
                const char = code[i];
                const prevChar = i > 0 ? code[i - 1] : '';
                const prevPrevChar = i > 1 ? code[i - 2] : '';
                
                // Handle string detection - account for escaped quotes
                if (!inString && (char === '"' || char === "'")) {
                    inString = true;
                    stringChar = char;
                } else if (inString) {
                    // Check if this is an escaped quote
                    if (char === stringChar && prevChar === '\\' && prevPrevChar !== '\\') {
                        // This is an escaped quote, still in string
                        continue;
                    } else if (char === stringChar && prevChar !== '\\') {
                        // This is the closing quote
                        inString = false;
                        stringChar = null;
                    } else if (char === '\\' && prevChar === '\\') {
                        // Double backslash, reset escape
                        continue;
                    }
                } else {
                    // Not in string, count braces
                    if (char === '{') {
                        braceCount++;
                    } else if (char === '}') {
                        braceCount--;
                        if (braceCount === 0) {
                            endIdx = i + 1;
                            break;
                        }
                    }
                }
            }
            
            if (endIdx === -1) {
                console.error('Brace counting failed. Start index:', startIdx, 'Code length:', code.length);
                console.error('Code snippet around start:', code.substring(Math.max(0, startIdx - 50), Math.min(code.length, startIdx + 200)));
                throw new Error('Could not find matching closing brace. The code may be incomplete. Brace count: ' + braceCount);
            }
            
            const objStr = code.substring(startIdx, endIdx);
            console.log('Extracted object string length:', objStr.length);
            console.log('Extracted object string (first 300 chars):', objStr.substring(0, 300) + '...');
            
            // Use Function constructor to safely evaluate the object
            // This is safer than eval and handles JavaScript objects properly
            let config;
            try {
                const func = new Function('return ' + objStr);
                config = func();
            } catch (evalErr) {
                console.error('Error evaluating object:', evalErr);
                console.error('Object string (last 300 chars):', objStr.substring(Math.max(0, objStr.length - 300)));
                throw new Error('Error parsing object: ' + evalErr.message + '. Please check the code syntax.');
            }
            
            if (!config || typeof config !== 'object') {
                throw new Error('Parsed result is not an object');
            }
            
            console.log('Parsed config:', config);
            
            // Extract settings groups
            // Use hasOwnProperty to check if they exist, even if they're empty objects
            const settings = {
                settingsGroupA: config.hasOwnProperty('settingsGroupA') ? config.settingsGroupA : null,
                settingsGroupB: config.hasOwnProperty('settingsGroupB') ? config.settingsGroupB : null,
                settingsGroupC: config.hasOwnProperty('settingsGroupC') ? config.settingsGroupC : null
            };
            
            console.log('Extracted settings:', settings);
            console.log('Settings Group A exists:', config.hasOwnProperty('settingsGroupA'), config.settingsGroupA);
            console.log('Settings Group B exists:', config.hasOwnProperty('settingsGroupB'), config.settingsGroupB);
            console.log('Settings Group C exists:', config.hasOwnProperty('settingsGroupC'), config.settingsGroupC);
            
            return settings;
        } catch (err) {
            console.error('Failed to parse export code:', err);
            console.error('Code length:', code ? code.length : 0);
            console.error('Code was (first 1000 chars):', code ? code.substring(0, 1000) : 'null');
            throw new Error('Invalid code format: ' + err.message);
        }
    }
    
    // Apply imported settings to fretboard
    async function applyImportedSettings(settings, targetId) {
        if (!window.Fretboard) {
            console.error('Fretboard API not available');
            throw new Error('Fretboard API not available');
        }
        
        if (!window.Fretboard.applyImportedConfig) {
            console.error('applyImportedConfig function not available');
            throw new Error('applyImportedConfig function not available');
        }
        
        console.log('Applying imported settings:', settings);
        
        try {
            // Use the dedicated applyImportedConfig function which reinitializes the fretboard
            await window.Fretboard.applyImportedConfig(settings, targetId);
            
            // Sync panel to reflect changes after a short delay
            setTimeout(() => {
                syncPanelFromFretboard(targetId);
                
                // After syncing, ensure string rows and string colors are rebuilt to match imported numStrings
                const instance = controlPanelInstances.get(targetId);
                if (instance && instance.inputRefs) {
                    const state = getCurrentFretboardState(targetId);
                    if (state && state.settingsGroupA && state.settingsGroupA.numStrings) {
                        const importedNumStrings = state.settingsGroupA.numStrings;
                        
                        // Rebuild string rows in Group C using the existing rebuildStringRows function
                        const panelElement = instance.element;
                        if (panelElement) {
                            // Find Group C section
                            const allSections = panelElement.querySelectorAll('.settings-group-section');
                            let groupCSection = null;
                            for (let section of allSections) {
                                const header = section.querySelector('.settings-group-header');
                                if (header && header.textContent.includes('Settings Group C')) {
                                    groupCSection = section;
                                    break;
                                }
                            }
                            if (groupCSection) {
                                const chordSection = groupCSection.querySelector('.collapsible-section');
                                if (chordSection) {
                                    const chordContent = chordSection.querySelector('.section-content');
                                    if (chordContent) {
                                        // Use the existing rebuildStringRows function
                                        rebuildStringRows(chordContent, targetId, instance.inputRefs, importedNumStrings);
                                    }
                                }
                            }
                            
                            // Rebuild string colors section in Group B using the existing function
                            rebuildStringColorsSection(targetId, instance.inputRefs, importedNumStrings);
                        }
                    }
                }
            }, 500); // Increased delay to ensure fretboard is fully updated
        } catch (err) {
            console.error('Error applying imported settings:', err);
            throw err;
        }
    }
    
    // Update control panel fingering inputs from fretboard dot state
    // This is now handled by syncPanelFromFretboard, but kept for backward compatibility
    function updatePanelFromFretboard(fretboardId) {
        syncPanelFromFretboard(fretboardId);
    }
    
    window.FretboardControlPanel = {
        init: initAllControlPanels,
        initForTarget: initControlPanelForTarget,
        toggle: togglePanel,
        updateFromFretboard: updatePanelFromFretboard
    };
    
    // Auto-initialize control panels when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => {
                initAllControlPanels();
            }, 500);
        });
    } else {
        setTimeout(() => {
            initAllControlPanels();
        }, 500);
    }
})();

