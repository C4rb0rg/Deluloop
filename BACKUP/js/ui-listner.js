/**
 * js/ui-listeners.js
 * Attaches event listeners for UI elements (buttons, canvas, LLM controls).
 * Handles user interactions and triggers actions on AudioPucks or global state.
 * Handles basic interaction for LLM elements (placeholders for backend integration).
 * Depends on global variables/objects: Tone, AudioPuck, canvas, pucks, draggingPuckIndex,
 * hoveredPuckIndex, isTransportRunning, isRecording, mediaRecorder, recordedChunks (defined in main.js)
 * Depends on global functions: deletePuck, undoDeletePuck (defined in main.js or here)
 */

// Global physics toggle state and user slider values
let isPhysicsOn = true;
let storedFriction = 0.98;
let storedBounce = 0.7;
let storedMass = 1.0;

/**
 * Toggle physics on/off for all pucks.
 * When off, friction/bounce/mass = 0. When on, restore previous values.
 * Also update the button’s visual indicator.
 */
function togglePhysics() {
    isPhysicsOn = !isPhysicsOn;

    if (!pucks || pucks.length === 0) {
        console.log("No pucks to toggle physics on/off.");
        updatePhysicsButtonVisual();
        return;
    }

    if (!isPhysicsOn) {
        // Save current slider values so we can restore them
        storedFriction = parseFloat(frictionSlider.value);
        storedBounce = parseFloat(bounceSlider.value);
        storedMass = parseFloat(massSlider.value);

        // Set all pucks to zero
        pucks.forEach(p => {
            p.friction = 0;
            p.bounce = 0;
            p.mass = 0;
        });

        console.log("Physics OFF: friction=0, bounce=0, mass=0");
    } else {
        // Restore pucks to the stored values
        pucks.forEach(p => {
            p.friction = storedFriction;
            p.bounce = storedBounce;
            p.mass = storedMass;
        });

        // Also reflect the stored values in the slider UI
        frictionSlider.value = storedFriction.toString();
        bounceSlider.value = storedBounce.toString();
        massSlider.value = storedMass.toString();
        frictionValue.textContent = storedFriction.toFixed(2);
        bounceValue.textContent = storedBounce.toFixed(1);
        massValue.textContent = storedMass.toFixed(1);

        console.log(`Physics ON: friction=${storedFriction}, bounce=${storedBounce}, mass=${storedMass}`);
    }

    updatePhysicsButtonVisual();
}

/**
 * Applies or removes a greyed-out style to the physics settings button
 * based on whether physics is on or off.
 */
function updatePhysicsButtonVisual() {
    const btn = document.getElementById('physics-settings');
    if (!btn) return;

    if (isPhysicsOn) {
        btn.classList.remove('physics-off');
    } else {
        btn.classList.add('physics-off');
    }
}

/**
 * Get mouse coordinates relative to the canvas.
 */
function getMousePos(e) {
    if (!canvas) {
        console.error("getMousePos called but canvas element is missing.");
        return { x: 0, y: 0 };
    }
    try {
        const rect = canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    } catch (error) {
        console.error("Error getting canvas bounding rectangle in getMousePos:", error);
        return { x: 0, y: 0 };
    }
}

function attachUIListeners() {
    console.log("Attaching UI event listeners...");

    // Basic references
    const playToggleButton = document.getElementById('play-toggle');
    const fileInputElement = document.getElementById('file-input');
    const recordButton = document.getElementById('record-btn');
    const undoDeleteButton = document.getElementById('undo-delete-btn');

    // LLM references
    const llmPromptInput = document.getElementById('llm-prompt-input');
    const llmMicButton = document.getElementById('llm-mic-btn');
    const llmStartButton = document.getElementById('llm-start-btn');
    const llmDrumButton = document.getElementById('llm-drum-btn');
    const llmMelodyButton = document.getElementById('llm-melody-btn');
    const llmToggleBtn = document.getElementById('llm-toggle-btn');
    const llmHideBtn = document.getElementById('llm-hide-btn');
    const llmControlsContainer = document.getElementById('llm-controls-container');

    // Physics settings references
    const physicsSettingsPanel = document.getElementById('physics-settings-panel');
    const physicsSettingsButton = document.getElementById('physics-settings');
    const closeSettingsButton = document.getElementById('close-settings');
    window.frictionSlider = document.getElementById('friction-slider');
    window.bounceSlider = document.getElementById('bounce-slider');
    window.massSlider = document.getElementById('mass-slider');
    window.frictionValue = document.getElementById('friction-value');
    window.bounceValue = document.getElementById('bounce-value');
    window.massValue = document.getElementById('mass-value');

    // --- LLM CONTROLS ---
    if (llmToggleBtn && llmControlsContainer) {
        llmToggleBtn.addEventListener('click', () => {
            // Show the container
            llmControlsContainer.style.display = 'block'; 
            // Hide the toggle button, if you want
            llmToggleBtn.style.display = 'none';
        });
    }

    if (llmHideBtn && llmControlsContainer) {
        llmHideBtn.addEventListener('click', () => {
            // Hide the container
            llmControlsContainer.style.display = 'none';
            // Bring back the toggle button
            llmToggleBtn.style.display = 'block';
        });
    }

    // --- PLAY / PAUSE ---
    if (playToggleButton) {
        playToggleButton.addEventListener('click', async () => {
            console.log("Play/Toggle button clicked.");
            try {
                if (Tone.context.state !== 'running') {
                    console.log("Audio context suspended, attempting to resume via Tone.start()...");
                    await Tone.start();
                    console.log("Tone.start() resumed context. State:", Tone.context.state);
                }
            } catch (e) {
                console.error("Error starting/resuming Tone.context:", e);
                alert("An error occurred initializing the audio system. Please refresh.");
                return;
            }
            if (Tone.context.state !== 'running') {
                alert("Audio context could not be started. Please try again.");
                return;
            }

            const playToggleIcon = playToggleButton.querySelector('i');
            const operationalPucks = pucks.filter(p => p.isLoaded && !p.loadError);

            if (Tone.Transport.state !== 'started') {
                let startedCount = 0;
                operationalPucks.forEach((p, index) => {
                    if (p.willPlay && p.player) {
                        p.player.sync().start(0);
                        p.isPlaying = true;
                        if (p.volume) p.volume.mute = p.isMuted;
                        startedCount++;
                    } else {
                        p.isPlaying = false;
                    }
                });
                if (startedCount > 0) {
                    Tone.Transport.start(Tone.now() + 0.1);
                    console.log(`Tone.Transport started with ${startedCount} pucks.`);
                    isTransportRunning = true;
                    if (playToggleIcon) {
                        playToggleIcon.classList.remove('fa-play');
                        playToggleIcon.classList.add('fa-pause');
                    }
                } else {
                    let message = "No audio loaded or ready to play.";
                    if (pucks.length > 0) {
                        message = "No tracks armed (double-click a puck to arm), or they’re still loading/error.";
                    }
                    console.log(message);
                    alert(message);
                }
            } else {
                console.log("Stopping Tone.Transport...");
                Tone.Transport.stop();
                pucks.forEach(p => p.isPlaying = false);
                isTransportRunning = false;
                if (playToggleIcon) {
                    playToggleIcon.classList.remove('fa-pause');
                    playToggleIcon.classList.add('fa-play');
                }
            }
        });
    }

    // --- FILE INPUT ---
    if (fileInputElement) {
        fileInputElement.addEventListener('change', function (event) {
            const files = event.target.files;
            if (!files || files.length === 0) return;
            console.log(`Selected ${files.length} file(s).`);

            Array.from(files).forEach((file) => {
                const url = URL.createObjectURL(file);
                console.log(`Blob URL for ${file.name}: ${url}`);
                try {
                    const newPuck = new AudioPuck(pucks.length, url, file.name, false);
                    pucks.push(newPuck);
                    console.log(`Created Puck #${pucks.length} for ${file.name}.`);
                } catch (creationError) {
                    console.error(`Error creating AudioPuck for ${file.name}:`, creationError);
                    URL.revokeObjectURL(url);
                }
            });
            event.target.value = null; // reset input
        });
    }

    // --- RECORD BUTTON ---
    if (recordButton) {
        recordButton.addEventListener('click', async () => {
            console.log("Record (Puck) button clicked. Currently:", isRecording ? "Recording" : "Not recording");
            const icon = recordButton.querySelector('i');
            let stream = null;

            if (!isRecording) {
                // Start recording
                try {
                    if (Tone.context.state !== 'running') await Tone.start();
                    if (Tone.context.state !== 'running') {
                        alert("Audio context error, cannot record.");
                        return;
                    }
                    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    console.log("Mic stream ready for puck recording.");

                    const options = { mimeType: 'audio/webm' };
                    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                        options.mimeType = 'audio/ogg';
                    }
                    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                        delete options.mimeType;
                    }

                    mediaRecorder = new MediaRecorder(stream, options);
                    recordedChunks = [];
                    mediaRecorder.ondataavailable = e => {
                        if (e.data.size > 0) recordedChunks.push(e.data);
                    };

                    mediaRecorder.onstop = () => {
                        console.log("Puck recording stopped.");
                        const stopTracks = () => {
                            if (stream?.getTracks) {
                                stream.getTracks().forEach(track => track.stop());
                            }
                            console.log("Mic tracks stopped.");
                        };
                        if (recordedChunks.length === 0) {
                            console.error("No audio data was recorded.");
                            alert("Recording failed—no audio captured.");
                            stopTracks();
                            isRecording = false;
                            return;
                        }
                        const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
                        const url = URL.createObjectURL(blob);
                        try {
                            const newPuck = new AudioPuck(pucks.length, url, `Mic Recording ${pucks.length + 1}`, true);
                            pucks.push(newPuck);
                            console.log(`Created Puck #${pucks.length} from mic recording.`);
                        } catch (creationError) {
                            console.error("Error creating puck from recording:", creationError);
                            alert("Couldn’t create puck from recording.");
                            URL.revokeObjectURL(url);
                        } finally {
                            stopTracks();
                        }
                    };

                    mediaRecorder.onerror = (event) => {
                        console.error("MediaRecorder error (Puck):", event.error);
                        alert(`Recording error: ${event.error.name}`);
                        isRecording = false;
                        if (stream?.getTracks) stream.getTracks().forEach(track => track.stop());
                    };

                    mediaRecorder.start();
                    console.log("Recording started...");
                    isRecording = true;
                    recordButton.classList.add('recording');
                    recordButton.dataset.tooltip = "Stop Recording Puck";
                } catch (err) {
                    console.error("Mic error (Puck):", err);
                    let message = `Mic access error: ${err.message}`;
                    if (err.name === "NotAllowedError") message += " - Please allow mic permission.";
                    else if (err.name === "NotFoundError") message += " - No mic device found.";
                    else if (err.name === "NotReadableError") message += " - Mic already in use?";
                    alert(message);
                    isRecording = false;
                }
            } else {
                // Stop recording
                if (mediaRecorder && mediaRecorder.state === "recording") {
                    mediaRecorder.stop();
                } else {
                    console.log("Tried to stop, but not in 'recording' state.");
                }
                isRecording = false;
                recordButton.classList.remove('recording');
                recordButton.dataset.tooltip = "Record Mic (Puck)";
            }
        });
    }

    // --- UNDO DELETE ---
    if (undoDeleteButton) {
        undoDeleteButton.addEventListener('click', () => {
            if (typeof undoDeletePuck === 'function') {
                undoDeletePuck();
            }
        });
    }

    // === LLM CONTROLS ===
    if (llmPromptInput) {
        llmPromptInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (llmStartButton) llmStartButton.click();
            }
        });
    }

    if (llmMicButton) {
        llmMicButton.addEventListener('click', () => {
            alert("LLM Mic not implemented yet.");
        });
    }

    if (llmStartButton) {
        llmStartButton.addEventListener('click', () => {
            const promptValue = llmPromptInput.value.trim();
            if (!promptValue) {
                alert("Enter a prompt first.");
                return;
            }
            alert(`Would send prompt to LLM: "${promptValue}" (not implemented).`);
        });
    }

    if (llmDrumButton) {
        llmDrumButton.addEventListener('click', () => {
            const promptValue = llmPromptInput.value.trim();
            alert(`Requesting Drums from LLM (placeholder). Prompt: "${promptValue}"`);
        });
    }

    if (llmMelodyButton) {
        llmMelodyButton.addEventListener('click', () => {
            const promptValue = llmPromptInput.value.trim();
            alert(`Requesting Melody from LLM (placeholder). Prompt: "${promptValue}"`);
        });
    }

    // === CANVAS MOUSE LOGIC ===
    if (canvas) {
        canvas.addEventListener('dblclick', (e) => {
            if (!pucks || pucks.length === 0) return;
            const { x, y } = getMousePos(e);
            const reversedIndex = pucks.slice().reverse().findIndex(p => p.isHit(x, y));
            const actualIndex = reversedIndex !== -1 ? pucks.length - 1 - reversedIndex : -1;

            if (actualIndex !== -1 && pucks[actualIndex]) {
                if (typeof pucks[actualIndex].togglePlayback === 'function') {
                    pucks[actualIndex].togglePlayback();
                }
            }
        });

        canvas.addEventListener('mousedown', (e) => {
            if (!pucks || pucks.length === 0) return;
            const { x, y } = getMousePos(e);

            let deleteHit = false;
            if (hoveredPuckIndex !== null && pucks[hoveredPuckIndex]) {
                const hoveredPuck = pucks[hoveredPuckIndex];
                if (hoveredPuck.isDeleteHit && hoveredPuck.isDeleteHit(x, y)) {
                    if (typeof deletePuck === 'function') {
                        deletePuck(hoveredPuckIndex);
                    }
                    deleteHit = true;
                    draggingPuckIndex = null;
                    hoveredPuckIndex = null;
                    canvas.style.cursor = 'crosshair';
                }
            }

            if (!deleteHit) {
                const reversedIndex = pucks.slice().reverse().findIndex(p => p.isHit(x, y));
                if (reversedIndex !== -1) {
                    draggingPuckIndex = pucks.length - 1 - reversedIndex;
                    canvas.style.cursor = 'grabbing';
                } else {
                    draggingPuckIndex = null;
                }
            }
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!pucks) return;
            const { x, y } = getMousePos(e);
            const currentReversedHoveredIndex = pucks.slice().reverse().findIndex(p => p.isHit(x, y));
            hoveredPuckIndex = currentReversedHoveredIndex !== -1
                ? pucks.length - 1 - currentReversedHoveredIndex
                : null;

            let newCursor = 'crosshair';
            if (draggingPuckIndex !== null) {
                newCursor = 'grabbing';
            } else if (
                hoveredPuckIndex !== null &&
                pucks[hoveredPuckIndex]?.isDeleteHit(x, y)
            ) {
                newCursor = 'pointer';
            } else if (hoveredPuckIndex !== null) {
                newCursor = 'grab';
            }
            canvas.style.cursor = newCursor;

            if (draggingPuckIndex !== null && pucks[draggingPuckIndex]) {
                const puck = pucks[draggingPuckIndex];
                puck.vx = (x - puck.x) * 0.5;
                puck.vy = (y - puck.y) * 0.5;
                puck.x = x;
                puck.y = y;
                if (typeof puck.updateEffects === 'function') {
                    puck.updateEffects();
                }
            }
        });

        canvas.addEventListener('mouseup', () => {
            if (draggingPuckIndex !== null) {
                const puck = pucks[draggingPuckIndex];
                if (puck) {
                    puck.vx *= 2;
                    puck.vy *= 2;
                }
                draggingPuckIndex = null;
                canvas.style.cursor = 'crosshair';
            }
        });

        canvas.addEventListener('mouseleave', () => {
            if (draggingPuckIndex !== null) {
                const puck = pucks[draggingPuckIndex];
                if (puck) {
                    puck.vx *= 2;
                    puck.vy *= 2;
                }
                draggingPuckIndex = null;
                canvas.style.cursor = 'crosshair';
            }
        });

        canvas.addEventListener('wheel', (e) => {
            if (hoveredPuckIndex !== null && pucks[hoveredPuckIndex]) {
                e.preventDefault();
                if (typeof pucks[hoveredPuckIndex].setVolume === 'function') {
                    pucks[hoveredPuckIndex].setVolume(e.deltaY);
                }
            }
        }, { passive: false });
    }

    // === PHYSICS SETTINGS BUTTON SHORT vs. LONG PRESS ===
    let pressTimer = null;
    let longPressTriggered = false;
    const longPressDuration = 500; // ms

    physicsSettingsButton.addEventListener('mousedown', () => {
        // Start the timer to detect long press
        longPressTriggered = false;
        pressTimer = setTimeout(() => {
            // Long press recognized -> open the panel
            physicsSettingsPanel.style.display = 'block';
            longPressTriggered = true;
            // We only open the panel; do NOT toggle physics
        }, longPressDuration);
    });

    physicsSettingsButton.addEventListener('mouseup', () => {
        // If we still have a timer (not cleared), that’s a short press
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
            if (!longPressTriggered) {
                // If the user did not do a long press, toggle physics
                togglePhysics();
            }
        }
    });

    physicsSettingsButton.addEventListener('mouseleave', () => {
        // If mouse leaves the button before long press triggers, clear the timer
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    });

    // Close panel ONLY with the close button
    closeSettingsButton.addEventListener('click', () => {
        physicsSettingsPanel.style.display = 'none';
    });

    // Slider changes
    frictionSlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        frictionValue.textContent = value.toFixed(2);
        pucks.forEach(p => { p.friction = value; });
        if (isPhysicsOn) {
            storedFriction = value; // So toggling OFF->ON restores
        }
    });

    bounceSlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        bounceValue.textContent = value.toFixed(1);
        pucks.forEach(p => { p.bounce = value; });
        if (isPhysicsOn) {
            storedBounce = value;
        }
    });

    massSlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        massValue.textContent = value.toFixed(1);
        pucks.forEach(p => { p.mass = value; });
        if (isPhysicsOn) {
            storedMass = value;
        }
    });

    // Set initial button visual (physics starts on)
    updatePhysicsButtonVisual();

    console.log("All UI event listeners attached.");
}
