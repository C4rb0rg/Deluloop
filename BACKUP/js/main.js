/**
 * js/main.js
 * Main script file for the XY Pad Audio Effects application.
 * Initializes the application, manages global state, runs the animation loop,
 * and coordinates calls to other modules.
 */

// --- Global State Variables ---
// These variables are accessed and modified by functions in other modules.
let pucks = []; // Holds AudioPuck instances
let draggingPuckIndex = null; // Index of the puck being dragged
let hoveredPuckIndex = null; // Index of the puck being hovered over
let isTransportRunning = false; // Flag for Tone.Transport state
let isRecording = false; // Flag for microphone recording state
let mediaRecorder = null; // Holds the MediaRecorder instance
let recordedChunks = []; // Holds recorded audio data chunks
let deletedPucksHistory = []; // **NEW**: Store data for undo (only holds the last one)

// Canvas and Context References (needed by multiple modules)
const networkCanvas = document.getElementById('xy-pad'); // Assumes same canvas for both
const canvas = networkCanvas; // Alias for clarity if using one canvas
const networkCtx = networkCanvas ? networkCanvas.getContext('2d') : null;
const ctx = canvas ? canvas.getContext('2d') : null;

// Cached Canvas Dimensions (updated by resizeCanvas)
let can_w = window.innerWidth;
let can_h = window.innerHeight;

// Effect Corner Coordinates (updated by resizeCanvas)
const corners = {
    delay: { x: 0, y: 0 },
    reverb: { x: window.innerWidth, y: 0 },
    distortion: { x: 0, y: window.innerHeight },
    eq: { x: window.innerWidth, y: window.innerHeight }
};

// --- Initialization and Setup ---

// Check if Tone.js is available
if (typeof Tone === 'undefined') {
    console.error("Tone.js library not loaded! Aborting main script execution.");
    alert("Fatal Error: Audio library (Tone.js) failed to load.");
    throw new Error("Tone.js not loaded"); // Stop script execution
} else {
    console.log("main.js: Tone.js loaded successfully. Version:", Tone.version);
    // Check initial audio context state
    if (Tone.context && Tone.context.state !== 'running') {
        console.warn("main.js: Initial Tone.context state is:", Tone.context.state);
    } else if (!Tone.context) {
        console.error("main.js: Tone.context is not available.");
    }
}

// Check if essential canvas elements/contexts were found
if (!canvas || !ctx || !networkCtx) {
     console.error("main.js: Canvas element or contexts missing! Aborting initialization.");
     alert("Fatal Error: Failed to initialize canvas elements. Application cannot start.");
     throw new Error("Canvas initialization failed"); // Stop script execution
}

/**
 * Handles window resize events, updating canvas dimensions and corner coordinates.
 * This function needs to be defined here as it updates global state used by other modules.
 */
function resizeCanvas() {
    // console.log("main.js: Resizing canvas..."); // Less verbose
    const w = window.innerWidth;
    const h = window.innerHeight;

    if (networkCanvas) {
        networkCanvas.width = w;
        networkCanvas.height = h;
        // Update global cached dimensions
        can_w = w;
        can_h = h;
    }
    // If canvas is separate, resize it:
    // if (canvas && canvas !== networkCanvas) { canvas.width = w; canvas.height = h; }

    // Update global corner coordinates
    corners.reverb.x = w;
    corners.eq.x = w;
    corners.distortion.y = h;
    corners.eq.y = h;
    // console.log("main.js: Canvas resized to:", w, "x", h); // Less verbose
}

// --- Delete and Undo Logic ---

/** Updates the enabled/disabled state of the Undo button */
function updateUndoButtonState() {
    const undoButton = document.getElementById('undo-delete-btn');
    if (undoButton) {
        const isDisabled = deletedPucksHistory.length === 0;
        undoButton.disabled = isDisabled;
        console.log(`Undo button state updated. History length: ${deletedPucksHistory.length}, Button disabled: ${isDisabled}`); // Keep this log
    } else {
        console.error("Undo button not found in updateUndoButtonState!");
    }
}

/**
 * Deletes a puck at the specified index.
 * Stores its data for potential undo.
 * @param {number} indexToDelete - The index in the `pucks` array to remove.
 */
function deletePuck(indexToDelete) {
    console.log(`--- deletePuck called for index: ${indexToDelete} ---`);

    // Validate index
    if (indexToDelete < 0 || indexToDelete >= pucks.length || !pucks[indexToDelete]) {
        console.error(`Invalid index or puck not found at index: ${indexToDelete}`);
        return;
    }

    const puckToDelete = pucks[indexToDelete];
    console.log(`Attempting to delete Puck: ${puckToDelete.filename}`);

    // 1. Store necessary data for undo
    // We store enough info to recreate the puck's essential state.
    const undoData = {
        url: puckToDelete.url, // Store original URL (important for blob URLs)
        filename: puckToDelete.filename,
        isRecorded: puckToDelete.isRecorded,
        x: puckToDelete.x, // Store last position
        y: puckToDelete.y,
        volumeValue: puckToDelete.volumeValue, // Store last volume
        // Note: We don't store effect states or loop state, they reset on undo.
    };
    // Store only the *last* deleted puck's data for a single-level undo
    deletedPucksHistory = [undoData];
    console.log("Stored undo data:", JSON.stringify(undoData));

    // 2. Cleanly dispose of the puck's Tone.js resources
    console.log("Calling puck.dispose()...");
    // Check if dispose method exists before calling
    if (puckToDelete.dispose && typeof puckToDelete.dispose === 'function') {
        puckToDelete.dispose(); // This now correctly DOES NOT revoke the blob URL
    } else {
        console.warn(`Puck at index ${indexToDelete} missing dispose method! Manual cleanup attempted.`);
        // Manual cleanup fallback (less reliable)
        try {
            if (puckToDelete.player) { puckToDelete.player.stop(); puckToDelete.player.unsync(); puckToDelete.player.dispose(); }
            if (puckToDelete.repeatLoop) { puckToDelete.repeatLoop.dispose(); }
            if (puckToDelete.delay) puckToDelete.delay.dispose(); if (puckToDelete.reverb) puckToDelete.reverb.dispose();
            if (puckToDelete.distortion) puckToDelete.distortion.dispose(); if (puckToDelete.eq) puckToDelete.eq.dispose();
            if (puckToDelete.volume) puckToDelete.volume.dispose();
             // DO NOT REVOKE URL HERE EITHER IN FALLBACK
            // if (puckToDelete.url && puckToDelete.url.startsWith('blob:')) { URL.revokeObjectURL(puckToDelete.url); }
        } catch (disposeError) {
            console.error("Error during manual dispose fallback:", disposeError);
        }
    }
    console.log("Dispose finished (or attempted).");


    // 3. Remove the puck object from the main array
    console.log("Splicing pucks array...");
    console.log("Pucks array BEFORE splice:", pucks.map(p => p.filename)); // Log filenames before
    pucks.splice(indexToDelete, 1); // Removes 1 element starting at indexToDelete
    console.log("Pucks array AFTER splice:", pucks.map(p => p.filename)); // Log filenames after

    // 4. Clear hover/drag state if the deleted puck was involved
    if (hoveredPuckIndex === indexToDelete) hoveredPuckIndex = null;
    if (draggingPuckIndex === indexToDelete) draggingPuckIndex = null;
    // Adjust dragging index if a preceding puck was deleted
    else if (draggingPuckIndex !== null && draggingPuckIndex > indexToDelete) {
        console.log(`Adjusting dragging index from ${draggingPuckIndex} to ${draggingPuckIndex - 1}`);
        draggingPuckIndex--;
    }

    console.log(`Puck deleted. Pucks remaining: ${pucks.length}`);
    updateUndoButtonState(); // Update the Undo button (enable it)
    console.log(`--- deletePuck finished for index: ${indexToDelete} ---`);
}

/** Restores the last deleted puck from the history */
function undoDeletePuck() {
    console.log("--- undoDeletePuck called ---");
    console.log("Current undo history:", JSON.stringify(deletedPucksHistory));

    // Check if there's anything in the history to undo
    if (deletedPucksHistory.length === 0) {
        console.log("Undo history is empty. Nothing to undo.");
        return; // Nothing to undo
    }

    // Retrieve the data of the last deleted puck
    const dataToRestore = deletedPucksHistory.pop(); // Removes the item from history
    console.log(`Attempting to restore: ${dataToRestore.filename}`);
    console.log("Restoring data:", JSON.stringify(dataToRestore));

    try {
        // Recreate the AudioPuck instance using the stored data
        // The URL should now be valid as we didn't revoke it.
        console.log("Creating new AudioPuck instance for undo...");
        const newPuck = new AudioPuck(
            pucks.length, // New index will be the current end of the array
            dataToRestore.url,
            dataToRestore.filename,
            dataToRestore.isRecorded
        );
        console.log("New puck instance created.");

        // Restore saved state (position and volume)
        console.log(`Restoring position to (${dataToRestore.x}, ${dataToRestore.y}) and volume to ${dataToRestore.volumeValue}`);
        newPuck.x = dataToRestore.x;
        newPuck.y = dataToRestore.y;
        newPuck.volumeValue = dataToRestore.volumeValue;

        // Manually set the Tone.Volume node's value and update radius,
        // as setVolume performs a ramp which isn't needed for restoration.
        if (newPuck.volume) {
            newPuck.volume.volume.value = dataToRestore.volumeValue;
        }
        // Recalculate radius based on restored volume
        const minVol = -48; const maxVol = 6; const minRadius = 12; const maxRadius = 35;
        const norm = (newPuck.volumeValue - minVol) / (maxVol - minVol);
        newPuck.radius = minRadius + Math.max(0, Math.min(1, norm)) * (maxRadius - minRadius);
        console.log(`Restored radius to ${newPuck.radius}`);

        // Add the restored puck back to the main array
        pucks.push(newPuck); // Add to end
        console.log(`Puck restored. Total pucks: ${pucks.length}`);
        console.log("Pucks array after undo:", pucks.map(p => p.filename));

    } catch (error) {
        // Handle errors during puck recreation (e.g., Tone.js error)
        console.error("Error trying to restore puck during undo:", error);
        alert("Failed to undo the deletion. An error occurred during puck restoration.");
        // Clear history if undo failed, as the data might be unusable
        deletedPucksHistory = [];
    }

    updateUndoButtonState(); // Update button state (will likely disable it as history is now empty)
    console.log("--- undoDeletePuck finished ---");
}


// --- Animation Loop ---
let lastFrameTime = 0; // Timestamp of the last animation frame
/**
 * The main animation loop function. Clears canvases, renders the background
 * animation, and draws all audio pucks.
 * @param {DOMHighResTimeStamp} currentTime - Timestamp provided by requestAnimationFrame.
 */
function animate(currentTime) {
    lastFrameTime = currentTime; // Store timestamp

    // Ensure contexts are still valid before drawing
    if (networkCtx && ctx) {
        // --- Clear Canvases ---
        networkCtx.clearRect(0, 0, can_w, can_h); // Use cached dimensions
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // --- Render Background ---
        // Check if function exists before calling
        if (typeof renderNetworkAnimation === 'function') {
            renderNetworkAnimation();
        } else {
             // Log error only once to avoid flooding console
             if (!window.renderNetworkAnimationErrorLogged) {
                 console.error("renderNetworkAnimation function not found!");
                 window.renderNetworkAnimationErrorLogged = true;
             }
        }

        // --- Render Foreground (Pucks) ---
        // Iterate through the pucks array and draw each one
        pucks.forEach(p => {
            // Check if puck object and its draw method exist
            if (p && typeof p.draw === 'function') {
                // Update puck position and handle collisions
                if (typeof p.update === 'function') {
                    p.update();
                }
                p.draw(ctx); // Call the puck's draw method
            }
        });
    }

    // Request the next animation frame
    requestAnimationFrame(animate);
}

// --- Application Start ---
/** Initializes event listeners, network animation, and starts the main loop */
function startApplication() {
    console.log("main.js: Starting application initialization...");

    // Initial setup of canvas size and attach resize listener
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    console.log("main.js: Resize listener attached.");

    // Setup the network animation (calls function defined in network-animation.js)
    if (typeof setupNetworkAnimation === 'function') {
        setupNetworkAnimation();
    } else {
        console.error("setupNetworkAnimation function not found!");
    }

    // Attach all UI event listeners (calls function defined in ui-listeners.js)
     if (typeof attachUIListeners === 'function') {
        attachUIListeners();
    } else {
        console.error("attachUIListeners function not found!");
    }

    // Set the initial state for the undo button (should be disabled)
    updateUndoButtonState();

    // Start the main animation loop if contexts are valid
    if (ctx && networkCtx) {
        console.log("main.js: Starting animation loop.");
        requestAnimationFrame(animate); // Initiate the loop
    } else {
         console.error("main.js: Animation loop NOT started due to missing canvas contexts.");
         // Display user-facing error message on the page
         const errorDiv = document.createElement('div');
         errorDiv.textContent = "Error: Application failed to initialize graphics components. Please refresh or check console.";
         errorDiv.style.cssText = `color: red; background-color: rgba(0,0,0,0.7); padding: 20px; border-radius: 5px; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1000; text-align: center; font-family: sans-serif;`;
         if (document.body) { document.body.appendChild(errorDiv); }
         else { window.addEventListener('DOMContentLoaded', () => document.body.appendChild(errorDiv)); }
    }

     console.log("main.js: Application initialization complete.");
}

// Start the application initialization process
// Ensure Tone.js has loaded before starting (script order should handle this, but check is safe)
if (typeof Tone !== 'undefined') {
    startApplication();
} else {
     console.error("main.js: Tone.js not loaded when attempting to start application!");
     // Display critical error if Tone didn't load
}

console.log("--- End of main.js execution ---");