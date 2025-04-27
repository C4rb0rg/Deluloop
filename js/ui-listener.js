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

// Add panning state tracking
let isPanningMode = false;
let panningPuck = null;
let lastMouseX = 0;
let isPanningDragging = false;

// Add selection state tracking
let isDragSelecting = false;
let selectionStartX = 0;
let selectionStartY = 0;
let selectionEndX = 0;
let selectionEndY = 0;

/**
 * Toggle physics on/off for all pucks.
 * When off, friction/bounce/mass = 0. When on, restore previous values.
 * Also update the button's visual indicator.
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

            // Check current state based on our isTransportRunning flag
            if (!isTransportRunning) {
                // STARTING PLAYBACK
                console.log("Starting master playback");
                
                // First, unsync all players to ensure clean state
                operationalPucks.forEach(p => {
                    if (p.player) {
                        try {
                            p.player.unsync();
                        } catch (e) {
                            console.warn(`Error unsyncing player for puck ${pucks.indexOf(p)}:`, e);
                        }
                    }
                });
                
                // Start transport first
                try {
                    Tone.Transport.start(Tone.now() + 0.1);
                } catch (e) {
                    console.warn("Error starting Tone.Transport:", e);
                }
                
                // Then start each player that should play
                let startedCount = 0;
                operationalPucks.forEach((p, index) => {
                    if (p.willPlay) {
                        try {
                            if (p.player) {
                                // Sync and start the player
                                p.player.sync().start(0);
                                p.isPlaying = true;
                                p.isMuted = false;
                                if (p.volume) p.volume.mute = false;
                                startedCount++;
                            }
                        } catch (e) {
                            console.warn(`Error starting player for puck ${index}:`, e);
                        }
                    } else {
                        p.isPlaying = false;
                    }
                });
                
                if (startedCount > 0) {
                    console.log(`Transport started with ${startedCount} pucks.`);
                    isTransportRunning = true;
                    if (playToggleIcon) {
                        playToggleIcon.classList.remove('fa-play');
                        playToggleIcon.classList.add('fa-pause');
                    }
                } else {
                    // No pucks to play - stop transport and show message
                    try {
                        Tone.Transport.stop();
                    } catch (e) {
                        console.warn("Error stopping Tone.Transport:", e);
                    }
                    
                    let message = "No audio loaded or ready to play.";
                    if (pucks.length > 0) {
                        message = "No tracks armed (double-click a puck to arm), or they're still loading/error.";
                    }
                    console.log(message);
                    alert(message);
                }
            } else {
                // STOPPING PLAYBACK
                console.log("Stopping master playback");
                
                // Stop the Transport first
                try {
                    Tone.Transport.stop();
                } catch (e) {
                    console.warn("Error stopping Tone.Transport:", e);
                }
                
                // Then stop all individual players
                operationalPucks.forEach(p => {
                    if (p.player) {
                        try {
                            // Unsync from transport
                            p.player.unsync();
                            // Stop the player
                            p.player.stop();
                            p.isPlaying = false;
                        } catch (e) {
                            console.warn(`Error stopping player for puck ${pucks.indexOf(p)}:`, e);
                        }
                    }
                });
                
                isTransportRunning = false;
                
                if (playToggleIcon) {
                    playToggleIcon.classList.remove('fa-pause');
                    playToggleIcon.classList.add('fa-play');
                }
                
                console.log("All audio playback stopped");
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
                            alert("Couldn't create puck from recording.");
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
        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const { x, y } = getMousePos(e);
            // Check if we're in drawing mode
            const isDrawingMode = e.shiftKey || pucks.some(p => p.isRecordingPath);
            
            const reversedIndex = pucks.slice().reverse().findIndex(p => p.isHit(x, y, isDrawingMode));
            const actualIndex = reversedIndex !== -1 ? pucks.length - 1 - reversedIndex : -1;
            
            if (actualIndex !== -1 && pucks[actualIndex]) {
                const puck = pucks[actualIndex];
                if (isCtrlPressed) {
                    // If Ctrl is pressed, disconnect all connections
                    puck.disconnectAll();
                    return;
                }
                if (e.shiftKey) {
                    // Stop any path playback immediately and clear the recorded trail.
                    puck.isPlayingPath = false;
                    puck.isRecordingPath = false; // Ensure recording state is off.
                    puck.recordedPath = []; // Clear the recorded path so the trail goes.
                    puck.vx = 0;
                    puck.vy = 0;
                    console.log(`Shift + right-click: Stopped path playback for puck ${actualIndex + 1} and cleared trail.`);
                } else {
                    puck.toggleReversePlayback();
                    console.log(`Right-clicked puck ${actualIndex + 1}: reverseActive = ${puck.reverseActive}`);
                }
            }
        });

        canvas.addEventListener('dblclick', (e) => {
            if (!pucks || pucks.length === 0) return;
            const { x, y } = getMousePos(e);
            
            // Check if we're in panning mode and double-clicking on the panning bar
            if (isPanningMode && panningPuck) {
                const barWidth = panningPuck.radius * 2.5;
                const barHeight = 6;
                const barX = panningPuck.x - barWidth/2;
                const barY = panningPuck.y + panningPuck.radius + 10;
                
                if (x >= barX && x <= barX + barWidth && 
                    y >= barY && y <= barY + barHeight) {
                    panningPuck.resetPan();
                    return;
                }
            }
            
            // Prevent default browser behavior to avoid issues
            e.preventDefault();
            
            // Check if we're in drawing mode
            const isDrawingMode = e.shiftKey || pucks.some(p => p.isRecordingPath);
            
            const reversedIndex = pucks.slice().reverse().findIndex(p => p.isHit(x, y, isDrawingMode));
            const actualIndex = reversedIndex !== -1 ? pucks.length - 1 - reversedIndex : -1;

            if (actualIndex !== -1 && pucks[actualIndex]) {
                console.log(`Double-clicked puck ${actualIndex + 1}, toggling playback`);
                try {
                    pucks[actualIndex].togglePlayback();
                } catch (err) {
                    console.error(`Error toggling playback for puck ${actualIndex + 1}:`, err);
                }
            }
        }, { passive: false });

        canvas.addEventListener('mousedown', (e) => {
            if (!pucks || pucks.length === 0) return;
            const { x, y } = getMousePos(e);
            
            // Check if we're in panning mode and clicking on the panning bar
            if (isPanningMode && panningPuck) {
                const barWidth = panningPuck.radius * 2.5;
                const barHeight = 6;
                const barX = panningPuck.x - barWidth/2;
                const barY = panningPuck.y + panningPuck.radius + 10;
                
                if (x >= barX && x <= barX + barWidth && 
                    y >= barY && y <= barY + barHeight) {
                    isPanningDragging = true;
                    lastMouseX = x;
                    return;
                }
            }
            
            // Check if we're in drawing mode to pass to isHit
            const isDrawingMode = e.shiftKey || pucks.some(p => p.isRecordingPath);

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
                const reversedIndex = pucks.slice().reverse().findIndex(p => p.isHit(x, y, isDrawingMode));
                if (reversedIndex !== -1) {
                    draggingPuckIndex = pucks.length - 1 - reversedIndex;
                    
                    // If Ctrl key is pressed, start a connection
                    if (e.ctrlKey) {
                        pucks[draggingPuckIndex].startConnection(x, y);
                        canvas.style.cursor = 'crosshair';
                    } else {
                        canvas.style.cursor = 'grabbing';
                        
                        // If Shift is pressed, mark this as the primary drawing puck
                        if (e.shiftKey) {
                            // Clear the flag on all pucks first
                            pucks.forEach(p => p.isPrimaryDrawingPuck = false);
                            // Set the flag on the dragged puck
                            pucks[draggingPuckIndex].isPrimaryDrawingPuck = true;
                        }
                        
                        // Clear selection from all pucks first
                        pucks.forEach(p => p.isSelected = false);
                        
                        // Toggle selection state for the clicked puck
                        const clickedPuck = pucks[draggingPuckIndex];
                        if (!e.ctrlKey && !e.shiftKey) {
                            // If not in connection or drawing mode, toggle selection
                            clickedPuck.isSelected = !clickedPuck.isSelected;
                        }
                    }
                } else {
                    // Clicked away from any puck - clear all selections
                    pucks.forEach(p => p.isSelected = false);
                    draggingPuckIndex = null;
                }
            }
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!pucks) return;
            const { x, y } = getMousePos(e);
            
            // Handle panning if in panning mode and dragging
            if (isPanningMode && panningPuck && isPanningDragging) {
                const barWidth = panningPuck.radius * 2.5;
                const deltaX = x - lastMouseX;
                const sensitivity = 180 / (barWidth/2);
                const newAngle = panningPuck.panAngle + deltaX * sensitivity;
                panningPuck.setPan(newAngle);
                lastMouseX = x;
                return;
            }
            
            // Check if we're in drawing mode to pass to isHit
            const isDrawingMode = e.shiftKey || pucks.some(p => p.isRecordingPath);
            
            const currentReversedHoveredIndex = pucks.slice().reverse().findIndex(p => p.isHit(x, y, isDrawingMode));
            hoveredPuckIndex = currentReversedHoveredIndex !== -1
                ? pucks.length - 1 - currentReversedHoveredIndex
                : null;

            let newCursor = 'crosshair';
            if (draggingPuckIndex !== null) {
                // Update cursor based on whether we're connecting or dragging
                const puck = pucks[draggingPuckIndex];
                if (puck.isConnecting) {
                    newCursor = 'crosshair';
                } else {
                    newCursor = 'grabbing';
                }
            } else if (
                hoveredPuckIndex !== null &&
                pucks[hoveredPuckIndex]?.isDeleteHit(x, y)
            ) {
                newCursor = 'pointer';
            } else if (hoveredPuckIndex !== null) {
                newCursor = e.ctrlKey ? 'alias' : 'grab';
            }
            canvas.style.cursor = newCursor;

            if (draggingPuckIndex !== null) {
                const puck = pucks[draggingPuckIndex];
                
                // Handle connection mode
                if (puck.isConnecting) {
                    puck.updateConnection(x, y);
                    return;
                }
                
                // Store previous position for calculating velocity
                const prevX = puck.x;
                const prevY = puck.y;
                
                // Calculate movement delta
                const deltaX = x - puck.x;
                const deltaY = y - puck.y;
                
                // If Shift is pressed, record the path and move connected pucks together
                if (e.shiftKey) {
                    // If not already recording or in playback, start a new recording.
                    if (puck.isPlayingPath || !puck.isRecordingPath) {
                        puck.startPathRecording();
                        
                        // Ensure this puck is marked as the primary drawing puck
                        pucks.forEach(p => p.isPrimaryDrawingPuck = false);
                        puck.isPrimaryDrawingPuck = true;
                    }
                    puck.recordPathPoint();
                    
                    // Update position directly to mouse position
                    puck.x = x;
                    puck.y = y;
                    
                    // Calculate velocity based on actual movement (more consistent)
                    // Use lower multiplier for smoother movement
                    puck.vx = (x - prevX) * 0.3;
                    puck.vy = (y - prevY) * 0.3;
                    
                    // Update effects immediately
                    if (typeof puck.updateEffects === 'function') {
                        puck.updateEffects();
                    }
                    
                    // Move connected pucks
                    if (puck.connectedPucks && puck.connectedPucks.length > 0) {
                        const movedPucks = new Set([puck]);
                        const moveConnectedPucks = (currentPuck, dx, dy) => {
                            for (const connectedPuck of currentPuck.connectedPucks) {
                                if (movedPucks.has(connectedPuck) || connectedPuck.isPlayingPath) continue;
                                
                                connectedPuck.x += dx;
                                connectedPuck.y += dy;
                                
                                // Apply same velocity calculation with a damping factor
                                connectedPuck.vx = (x - prevX) * 0.3;
                                connectedPuck.vy = (y - prevY) * 0.3;
                                
                                if (connectedPuck.isPlayingPath) {
                                    connectedPuck.isPlayingPath = false;
                                }
                                connectedPuck.isRecordingPath = false;
                                connectedPuck.isPrimaryDrawingPuck = false;
                                
                                movedPucks.add(connectedPuck);
                                if (typeof connectedPuck.updateEffects === 'function') {
                                    connectedPuck.updateEffects();
                                }
                                
                                moveConnectedPucks(connectedPuck, dx, dy);
                            }
                        };
                        
                        moveConnectedPucks(puck, deltaX, deltaY);
                    }
                } else {
                    // Single puck movement
                    // Update position directly to mouse position
                    puck.x = x;
                    puck.y = y;
                    
                    // Calculate velocity based on actual movement (more consistent)
                    // Use lower multiplier for smoother movement
                    puck.vx = (x - prevX) * 0.3;
                    puck.vy = (y - prevY) * 0.3;
                    
                    if (typeof puck.updateEffects === 'function') {
                        puck.updateEffects();
                    }
                }
            }
        });

        canvas.addEventListener('mouseup', (e) => {
            if (isPanningDragging) {
                isPanningDragging = false;
                return;
            }
            
            if (draggingPuckIndex !== null) {
                const puck = pucks[draggingPuckIndex];
                
                // If we're in connection mode, check if we're over another puck to connect to
                if (puck.isConnecting) {
                    let targetPuckIndex = null;
                    const isDrawingMode = e.shiftKey || pucks.some(p => p.isRecordingPath);
                    
                    for (let i = 0; i < pucks.length; i++) {
                        if (i !== draggingPuckIndex) {
                            const targetPuck = pucks[i];
                            const { x, y } = getMousePos(e);
                            if (targetPuck.isHit(x, y, isDrawingMode)) {
                                targetPuckIndex = i;
                                break;
                            }
                        }
                    }
                    
                    if (targetPuckIndex !== null) {
                        puck.endConnection(pucks[targetPuckIndex]);
                    } else {
                        puck.cancelConnection();
                    }
                } else {
                    const wasDrawing = puck.isRecordingPath;
                    
                    // Apply a consistent, moderate boost to velocity when releasing the puck
                    // This gives a more predictable "throw" feeling
                    const velocityBoost = 1.5; // Reduced from 2.0 for more control
                    
                    // Boost velocities for all selected pucks
                    const selectedPucks = pucks.filter(p => p.isSelected);
                    if (selectedPucks.length > 0) {
                        selectedPucks.forEach(selectedPuck => {
                            // Apply maximum velocity cap for more predictable movement
                            const maxVelocity = 15;
                            selectedPuck.vx = Math.min(Math.max(selectedPuck.vx * velocityBoost, -maxVelocity), maxVelocity);
                            selectedPuck.vy = Math.min(Math.max(selectedPuck.vy * velocityBoost, -maxVelocity), maxVelocity);
                        });
                    } else {
                        // Apply maximum velocity cap for more predictable movement
                        const maxVelocity = 15;
                        puck.vx = Math.min(Math.max(puck.vx * velocityBoost, -maxVelocity), maxVelocity);
                        puck.vy = Math.min(Math.max(puck.vy * velocityBoost, -maxVelocity), maxVelocity);
                    }
                    
                    if (wasDrawing && puck.connectedPucks && puck.connectedPucks.length > 0) {
                        const processedPucks = new Set([puck]);
                        const applyVelocityToConnected = (currentPuck) => {
                            for (const connectedPuck of currentPuck.connectedPucks) {
                                if (processedPucks.has(connectedPuck) || connectedPuck.isPlayingPath) continue;
                                
                                // Apply maximum velocity cap for more predictable movement
                                const maxVelocity = 15;
                                connectedPuck.vx = Math.min(Math.max(connectedPuck.vx * velocityBoost, -maxVelocity), maxVelocity);
                                connectedPuck.vy = Math.min(Math.max(connectedPuck.vy * velocityBoost, -maxVelocity), maxVelocity);
                                
                                processedPucks.add(connectedPuck);
                                applyVelocityToConnected(connectedPuck);
                            }
                        };
                        
                        applyVelocityToConnected(puck);
                    }
                }
                
                draggingPuckIndex = null;
                canvas.style.cursor = 'crosshair';
            }
        });

        canvas.addEventListener('mouseleave', () => {
            if (draggingPuckIndex !== null) {
                const puck = pucks[draggingPuckIndex];
                
                // Cancel any active connection
                if (puck.isConnecting) {
                    puck.cancelConnection();
                } else {
                    // Check if we were in drawing mode
                    const wasDrawing = puck.isRecordingPath;
                    
                    // Normal behavior - boost velocities for physics simulation
                    puck.vx *= 2;
                    puck.vy *= 2;
                    
                    // If we were in drawing mode, also handle connected pucks
                    if (wasDrawing && puck.connectedPucks && puck.connectedPucks.length > 0) {
                        const processedPucks = new Set([puck]); // Track which pucks we've processed to avoid loops
                        
                        // Function to recursively apply velocity boost to connected pucks
                        const applyVelocityToConnected = (currentPuck) => {
                            for (const connectedPuck of currentPuck.connectedPucks) {
                                // Skip if already processed or in path playback mode
                                if (processedPucks.has(connectedPuck) || connectedPuck.isPlayingPath) continue;
                                
                                // Apply the velocity boost
                                connectedPuck.vx *= 2;
                                connectedPuck.vy *= 2;
                                
                                // Mark as processed
                                processedPucks.add(connectedPuck);
                                
                                // Recursively process pucks connected to this one
                                applyVelocityToConnected(connectedPuck);
                            }
                        };
                        
                        // Start applying velocity to connected pucks
                        applyVelocityToConnected(puck);
                    }
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

        // Add handler for ctrl+right-click to stop path playback
        canvas.addEventListener('contextmenu', function(e) {
            // Check if the Ctrl key is pressed during right click
            if (e.ctrlKey) {
                e.preventDefault();
                
                // Get mouse position
                const rect = canvas.getBoundingClientRect();
                const mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
                const mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
                
                // Find pucks near the click location
                const detectionRadius = 50; // Adjust radius as needed
                let clickedAnyPuck = false;
                
                // Loop through all pucks to find ones within detection radius
                for (const puck of pucks) {
                    const distance = Math.sqrt(
                        Math.pow(mouseX - puck.x, 2) + 
                        Math.pow(mouseY - puck.y, 2)
                    );
                    
                    if (distance <= detectionRadius) {
                        // Stop path playback for this puck and all connected pucks
                        puck.stopPathPlayback(true);
                        clickedAnyPuck = true;
                    }
                }
                
                if (clickedAnyPuck) {
                    console.log('Stopped path playback for pucks near click and their connected pucks');
                }
            }
        });

        // Add selection rectangle drawing to the animation loop
        function animate() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Draw all pucks
            pucks.forEach(puck => {
                puck.update();
                puck.draw(ctx);
            });
            
            // Draw selection rectangle
            drawSelectionRectangle(ctx);
            
            requestAnimationFrame(animate);
        }
        
        animate();
    }

    // Global listener: when the Shift key is released, end any ongoing path recordings.
    document.addEventListener('keyup', (e) => {
        if (e.key === 'Shift') {
            // First identify all pucks that were recording paths
            const recordingPucks = pucks.filter(p => p.isRecordingPath);
            
            // Process each recording puck and its connections
            const processedPucks = new Set();
            
            // For each recording puck, stop recording and track connected pucks
            recordingPucks.forEach(puck => {
                if (processedPucks.has(puck)) return; // Skip if already processed
                
                // Create a set of all pucks in this connected group
                const connectedGroup = new Set([puck]);
                const findConnectedPucks = (currentPuck) => {
                    currentPuck.connectedPucks.forEach(connectedPuck => {
                        if (!connectedGroup.has(connectedPuck)) {
                            connectedGroup.add(connectedPuck);
                            findConnectedPucks(connectedPuck);
                        }
                    });
                };
                
                // Find all pucks in this connected group
                findConnectedPucks(puck);
                
                // Stop path recording for all pucks in the group and reset primary drawing flag
                connectedGroup.forEach(groupPuck => {
                    groupPuck.isPrimaryDrawingPuck = false;
                    if (groupPuck.isRecordingPath) {
                        groupPuck.stopPathRecording();
                    }
                    processedPucks.add(groupPuck);
                });
            });
        }
        
        // Update cursor when Ctrl key is released
        if (e.key === 'Control') {
            // Reset cursor to default if over a puck
            if (hoveredPuckIndex !== null && !draggingPuckIndex) {
                canvas.style.cursor = 'grab';
            } else if (!draggingPuckIndex) {
                canvas.style.cursor = 'crosshair';
            }
        }
    });

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
        // If we still have a timer (not cleared), that's a short press
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

// Add keyboard event listener for 'P' key
document.addEventListener('keydown', (e) => {
    // Panning mode toggle with 'p' key
    if (e.key.toLowerCase() === 'p' && hoveredPuckIndex !== null) {
        const puck = pucks[hoveredPuckIndex];
        if (puck) {
            isPanningMode = !isPanningMode;
            puck.togglePanning(isPanningMode);
            panningPuck = isPanningMode ? puck : null;
            if (isPanningMode) {
                canvas.style.cursor = 'ew-resize';
            } else {
                canvas.style.cursor = 'crosshair';
            }
        }
    }
    
    // Ctrl+Z for undo
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (typeof undoDeletePuck === 'function') {
            console.log('Ctrl+Z pressed: Triggering undo');
            undoDeletePuck();
        }
    }
    
    // Spacebar for play/pause toggle
    if (e.key === ' ' || e.code === 'Space') {
        // Don't trigger if user is typing in an input field
        if (document.activeElement.tagName !== 'INPUT' && 
            document.activeElement.tagName !== 'TEXTAREA') {
            e.preventDefault();
            const playToggleButton = document.getElementById('play-toggle');
            if (playToggleButton) {
                console.log('Spacebar pressed: Triggering play/pause');
                playToggleButton.click();
            }
        }
    }
});

// Add function to draw selection rectangle
function drawSelectionRectangle(ctx) {
    if (!isDragSelecting) return;
    
    ctx.save();
    ctx.strokeStyle = 'rgba(108, 99, 255, 0.8)';
    ctx.fillStyle = 'rgba(108, 99, 255, 0.1)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    
    const x = Math.min(selectionStartX, selectionEndX);
    const y = Math.min(selectionStartY, selectionEndY);
    const width = Math.abs(selectionEndX - selectionStartX);
    const height = Math.abs(selectionEndY - selectionStartY);
    
    ctx.strokeRect(x, y, width, height);
    ctx.fillRect(x, y, width, height);
    ctx.restore();
}

// Add function to check if a point is within selection rectangle
function isPointInSelection(x, y) {
    const left = Math.min(selectionStartX, selectionEndX);
    const right = Math.max(selectionStartX, selectionEndX);
    const top = Math.min(selectionStartY, selectionEndY);
    const bottom = Math.max(selectionStartY, selectionEndY);
    
    return x >= left && x <= right && y >= top && y <= bottom;
}
