/**
 * js/audio-puck.js
 * Defines the AudioPuck class for managing individual audio sources.
 * Handles loading, playback, effects, drawing, and interaction (drag, delete, toggle).
 * Depends on global variables/objects: Tone, canvas, corners, isTransportRunning, hoveredPuckIndex, pucks (defined in main.js)
 */

class AudioPuck {
    constructor(index, audioUrl, filename, isRecorded = false) {
        // console.log(`Creating AudioPuck ${index + 1}: ${filename}`);
        this.index = index; // Store initial index
        this.url = audioUrl;
        this.filename = filename;
        this.isRecorded = isRecorded;

        // Position & Appearance
        const initialX = (canvas?.width / 2 || 300) + (Math.random() - 0.5) * 100;
        const initialY = (canvas?.height / 2 || 300) + (Math.random() - 0.5) * 100;
        this.x = initialX;
        this.y = initialY;
        this.radius = 20; // Initial radius, will be updated by setVolume
        this.volumeValue = 0; // Volume in dB
        this.deleteButtonRadius = 8; // Clickable radius for the delete button

        // Physics properties
        this.vx = 0; // Velocity in x direction
        this.vy = 0; // Velocity in y direction
        this.friction = 0.98; // Friction coefficient (0.98 means 2% velocity loss per frame)
        this.bounce = 0.7; // Bounce coefficient (0.7 means 30% energy loss on collision)
        this.mass = 1; // Mass of the puck (for collision calculations)

        // State Flags
        this.isPlaying = false; // Is this puck currently outputting audio (tied to Transport & mute)
        this.isLoaded = false;
        this.loadError = false;
        this.willPlay = true; // Should this puck play when Transport starts? (Toggled by dblclick when stopped)
        this.isMuted = false; // Is this puck actively muted? (Toggled by dblclick when running)

        try {
            // --- Initialize Tone.js Nodes ---
            this.delay = new Tone.FeedbackDelay({ delayTime: 0.25, feedback: 0.5, wet: 0 });
            this.reverb = new Tone.Reverb({ decay: 2, wet: 0 });
            this.distortion = new Tone.Distortion({ distortion: 0.6, wet: 0 });
            this.eq = new Tone.EQ3({ low: 0, mid: 0, high: 0 });
            // Initialize volume with mute state based on isMuted
            this.volume = new Tone.Volume(this.volumeValue).toDestination();
            this.volume.mute = this.isMuted; // Apply initial mute state

            // Generate reverb impulse response asynchronously
            this.reverb.generate().then(() => {
                // Optional: console.log(`Reverb generated for Puck ${pucks.indexOf(this) + 1}`);
            }).catch(err => {
                console.error(`Reverb generation failed for Puck ${pucks.indexOf(this) + 1}:`, err);
            });

            // --- Initialize Tone.Player ---
            this.player = new Tone.Player({
                url: this.url,
                autostart: false, // We control start via sync() and Transport
                loop: true,
                fadeIn: 0.1,
                fadeOut: 0.1,
                onload: () => {
                    const currentIdx = typeof pucks !== 'undefined' ? pucks.indexOf(this) : -1;
                    console.log(`Puck ${currentIdx + 1} (${this.filename}) loaded successfully.`);
                    this.isLoaded = true;
                    this.loadError = false;
                    this.setVolume(0); // Update radius based on initial volumeValue

                    // Check if transport is running *and* this puck should play according to its flags
                    const transportIsRunning = typeof isTransportRunning !== 'undefined' && isTransportRunning && Tone.Transport.state === 'started';
                    if (transportIsRunning && this.willPlay) {
                        console.log(`Puck ${currentIdx + 1}: Transport running, starting immediately.`);
                        this.player.sync().start(0);
                        this.isPlaying = true; // Mark as playing
                    } else {
                        this.isPlaying = false; // Mark as not playing initially
                    }
                    // Ensure mute state is correct after loading
                    if(this.volume) this.volume.mute = this.isMuted;

                },
                onerror: (error) => {
                    const currentIdx = typeof pucks !== 'undefined' ? pucks.indexOf(this) : -1;
                    console.error(`Error loading audio for Puck ${currentIdx + 1} (${this.filename}):`, error);
                    this.loadError = true;
                    this.isLoaded = false;
                    this.isPlaying = false; // Ensure not marked as playing on error
                    alert(`Error loading: ${this.filename}. Unsupported format or network issue? Check console.`);
                }
            }).chain(this.delay, this.reverb, this.distortion, this.eq, this.volume); // Chain effects

            this.updateEffects(); // Initialize effect levels based on initial position

        } catch (error) {
            const currentIdx = typeof pucks !== 'undefined' ? pucks.indexOf(this) : index;
            console.error(`FATAL: Error during AudioPuck ${currentIdx + 1} (${filename}) constructor:`, error);
            this.loadError = true;
            alert(`Failed to initialize audio components for ${filename}. See console.`);
        }
    }

    /**
     * Toggles the playback state of the puck based on the Transport's status.
     * If Transport is running, toggles mute.
     * If Transport is stopped, toggles the 'willPlay' flag for the next start.
     */
    togglePlayback() {
        const currentIdx = typeof pucks !== 'undefined' ? pucks.indexOf(this) : -1;
        if (!this.isLoaded || this.loadError) {
            console.log(`Puck ${currentIdx + 1}: Cannot toggle playback - not loaded or error.`);
            return; // Can't toggle if not ready
        }

        // Access global isTransportRunning (defined in main.js)
        const transportIsRunning = typeof isTransportRunning !== 'undefined' && isTransportRunning && Tone.Transport.state === 'started';

        if (transportIsRunning) {
            // --- Transport is RUNNING: Toggle Mute ---
            this.isMuted = !this.isMuted;
            if (this.volume) {
                this.volume.mute = this.isMuted; // Apply mute to Tone.Volume node
            }
            // Update isPlaying based on mute state IF transport is running
            this.isPlaying = !this.isMuted; // Puck is considered "playing" visually if transport is running and it's not muted.
            console.log(`Puck ${currentIdx + 1} (${this.filename}): Mute toggled to ${this.isMuted}. IsPlaying set to ${this.isPlaying}`);

        } else {
            // --- Transport is STOPPED: Toggle willPlay Flag ---
            this.willPlay = !this.willPlay;
            console.log(`Puck ${currentIdx + 1} (${this.filename}): WillPlay toggled to ${this.willPlay}`);
            // Ensure it's marked as not playing if transport is stopped
            this.isPlaying = false;
        }
    }

    /**
     * Calculates the delete button position.
     * It attempts to place it relative to the current radius but ensures a minimum
     * distance from the puck's center to prevent excessive overlap or becoming
     * unreachable when the puck is very small.
     */
    getDeleteButtonPosition() {
        const angle = -Math.PI / 4; // Top-right direction (-45 degrees)
        const cosAngle = Math.cos(angle); // Approx 0.707
        const sinAngle = Math.sin(angle); // Approx -0.707

        // Minimum distance from the puck's CENTER to the delete button's CENTER.
        const minCenterDistance = this.deleteButtonRadius + 6; // 8px + 6px padding = 14px

        // The 'ideal' distance for the offset is the puck's current radius.
        const idealDistance = this.radius;

        // Determine the actual distance to use for positioning the delete button's center.
        const actualDistance = Math.max(idealDistance, minCenterDistance);

        // Calculate the final offset components using the determined actualDistance.
        const offsetX = cosAngle * actualDistance;
        const offsetY = sinAngle * actualDistance;

        // Return the final calculated position for the delete button's center.
        return {
            x: this.x + offsetX,
            y: this.y + offsetY
        };
    }

    /** Draws the puck, its state indicators, and potentially the delete button */
    draw(ctx) {
        if (!ctx) return;
        ctx.save(); // Save default state

        const currentIdx = typeof pucks !== 'undefined' ? pucks.indexOf(this) : -1;
        const transportIsRunning = typeof isTransportRunning !== 'undefined' && isTransportRunning && Tone.Transport.state === 'started';

        // --- Visual Feedback for Muted/Paused State ---
        let puckOpacity = 1.0;
        // Dim if transport running & muted OR transport stopped & won't play
        if ((transportIsRunning && this.isMuted) || (!transportIsRunning && !this.willPlay)) {
            puckOpacity = 0.55; // Apply dimming effect
        }
        // --- --- --- --- --- --- --- --- --- --- --- ---

        // --- Glow Effect (Unaffected by Opacity Dimming) ---
        let glowColor = 'transparent', glowBlur = 0;
        if (this.loadError) { glowColor = 'rgba(255, 255, 0, 0.9)'; glowBlur = 15; }
        else if (!this.isLoaded) { glowColor = 'rgba(200, 200, 200, 0.5)'; glowBlur = 10; }
        else if (this.isRecorded) { glowColor = 'rgba(255, 80, 80, 0.8)'; glowBlur = 18; }
        else {
            // Base glow on *potential* play state (Transport running AND willPlay) OR actual playing state if !muted
            const shouldBePlaying = transportIsRunning && this.willPlay && !this.isMuted;
             glowColor = shouldBePlaying ? 'rgba(108, 99, 255, 0.9)' : 'rgba(108, 99, 255, 0.6)';
             glowBlur = 15;
        }
        ctx.shadowColor = glowColor; ctx.shadowBlur = glowBlur;
        // --- --- --- --- --- --- --- --- --- --- --- ---

        // Apply opacity *after* shadow calculation but *before* drawing the fill
        ctx.globalAlpha = puckOpacity;

        // --- Puck Fill Color ---
        const puckColorPlaying = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim() || '#6c63ff';
        const puckColorStopped = 'rgba(240, 240, 240, 0.85)';
        // Base fill on whether it *should* be playing if Transport was running and it's armed
        let currentFill = (this.willPlay || transportIsRunning) ? puckColorPlaying : puckColorStopped;
        // Override for special states
        if (this.loadError) { currentFill = 'rgba(255, 180, 0, 0.8)'; }
        else if (!this.isLoaded) { currentFill = 'rgba(150, 150, 150, 0.7)'; }
        // --- --- --- --- --- --- ---

        // --- Draw Puck Circle ---
        ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); ctx.fillStyle = currentFill; ctx.fill();
        // --- --- --- --- --- --- ---

        // --- Draw Text (Index) ---
        // Reset shadow for text drawing
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
        // Determine text color (adjust if dimmed)
        let textColor = (this.willPlay || transportIsRunning) ? 'white' : 'black'; // Default based on playing potential
        if(this.loadError || !this.isLoaded) textColor = 'white'; // Error/loading text is white
        if (puckOpacity < 1.0) { // If dimmed (muted/paused)
           textColor = (this.willPlay || transportIsRunning) ? 'rgba(220, 220, 220, 0.8)' : 'rgba(100, 100, 100, 0.8)';
           if(this.loadError || !this.isLoaded) textColor = 'rgba(220, 220, 220, 0.8)'; // Dimmed error/loading
        }
        ctx.fillStyle = textColor;
        ctx.font = `bold ${Math.max(10, this.radius * 0.6)}px Poppins`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const displayIndex = currentIdx + 1;
        if (displayIndex > 0) { ctx.fillText(displayIndex, this.x, this.y); }
        else { ctx.fillText('?', this.x, this.y); } // Fallback if index calculation failed
        // --- --- --- --- --- --- ---

        // --- Draw Hover Info & Delete Button (Reset alpha first) ---
        ctx.globalAlpha = 1.0; // Ensure hover text/delete button are full opacity
        const currentHoverIndex = typeof hoveredPuckIndex !== 'undefined' ? hoveredPuckIndex : null;
        if (currentHoverIndex === currentIdx) {
            // Style for hover text
            ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.font = '12px Poppins';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';

            // Determine state text for hover info
            let stateText = '';
            if (this.loadError) stateText = 'Load Error!';
            else if (!this.isLoaded) stateText = 'Loading...';
            else if (transportIsRunning) {
                stateText = this.willPlay ? (this.isMuted ? 'Playing (Muted)' : 'Playing') : 'Stopped';
            } else { // Transport is stopped
                stateText = this.willPlay ? 'Ready' : 'Paused';
            }

            const displayName = this.filename.length > 25 ? this.filename.substring(0, 22) + '...' : this.filename;
            const textX = this.x + this.radius + 8;
            const textY = this.y + this.radius + 4;

            // Draw Lines: Filename/State & Volume
            ctx.fillText(`${displayName} (${stateText})`, textX, textY);
            const volumeText = `Vol: ${this.volumeValue.toFixed(1)} dB`;
            ctx.fillText(volumeText, textX, textY + 14); // Draw volume below

            // Draw the delete button (only when puck is hovered)
            this.drawDeleteButton(ctx);
        }
        // --- --- --- --- --- --- --- --- --- --- --- ---

        ctx.restore(); // Restore canvas state (clears alpha, shadow, etc.)
    }

    /** Draws the delete 'X' button with styling that matches the application theme */
    drawDeleteButton(ctx) {
        const pos = this.getDeleteButtonPosition(); // Gets center position {x, y}
        const r = this.deleteButtonRadius;         // Radius, currently 8px
        const crossSize = r * 0.55; // Make cross slightly larger relative to radius (e.g., 55%)

        ctx.save(); // Save context state

        // Subtle shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.4)'; ctx.shadowBlur = 4; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1;

        // Background circle with theme gradient
        const gradient = ctx.createRadialGradient( pos.x - r * 0.1, pos.y - r * 0.1, 0, pos.x, pos.y, r * 1.5 );
        gradient.addColorStop(0, 'rgba(70, 70, 80, 0.85)'); gradient.addColorStop(1, 'rgba(30, 30, 40, 0.90)');
        ctx.fillStyle = gradient;
        ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2); ctx.fill();

        // Reset shadow for the 'X'
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;

        // Draw the 'X' cross (themed red, thicker, rounded)
        ctx.strokeStyle = 'rgba(255, 80, 80, 0.9)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(pos.x - crossSize, pos.y - crossSize); ctx.lineTo(pos.x + crossSize, pos.y + crossSize);
        ctx.moveTo(pos.x + crossSize, pos.y - crossSize); ctx.lineTo(pos.x - crossSize, pos.y + crossSize);
        ctx.stroke();

        ctx.restore(); // Restore context state
    }

    /** Checks if the given mouse coordinates hit the delete button area */
    isDeleteHit(mx, my) {
        const pos = this.getDeleteButtonPosition();
        const dx = mx - pos.x;
        const dy = my - pos.y;
        // Use radius squared for efficient distance check
        return (dx * dx + dy * dy) <= (this.deleteButtonRadius * this.deleteButtonRadius);
    }

    /** Checks if the given mouse coordinates are inside the main puck body */
    isHit(mx, my) {
        const dx = mx - this.x;
        const dy = my - this.y;
        // Use radius squared for efficient distance check
        return (dx * dx + dy * dy) <= (this.radius * this.radius);
    }

    /** Updates the wet levels of effects based on the puck's position */
    updateEffects() {
        if (!this.isLoaded || this.loadError) {
            // Ensure effects are silent if not loaded/error
             if(this.delay) this.delay.wet.value = 0; if(this.reverb) this.reverb.wet.value = 0;
             if(this.distortion) this.distortion.wet.value = 0; if(this.eq) this.eq.low.value = 0;
            return;
        }
        // Calculate proximity to corners
        const d = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const currentWidth = canvas?.width || window.innerWidth;
        const currentHeight = canvas?.height || window.innerHeight;
        const maxDist = Math.hypot(currentWidth, currentHeight);
        if (maxDist === 0) return; // Avoid division by zero

        // Proximity (0=far, 1=close)
        const delayProx = 1 - Math.min(d(this, corners.delay) / maxDist, 1);
        const reverbProx = 1 - Math.min(d(this, corners.reverb) / maxDist, 1);
        const distortionProx = 1 - Math.min(d(this, corners.distortion) / maxDist, 1);
        const eqProx = 1 - Math.min(d(this, corners.eq) / maxDist, 1);

        // Apply effects with smooth ramps
        const rampTime = Tone.now() + 0.05;
        if(this.delay) this.delay.wet.linearRampToValueAtTime(delayProx * 0.5, rampTime);
        if(this.reverb) this.reverb.wet.linearRampToValueAtTime(reverbProx, rampTime);
        if(this.distortion) this.distortion.wet.linearRampToValueAtTime(distortionProx * 0.5, rampTime);
        if(this.eq) { const eqDB = (eqProx - 0.5) * 24; this.eq.low.linearRampToValueAtTime(eqDB, rampTime); }
    }

    /** Adjusts volume (dB) and updates radius based on the new volume */
    setVolume(delta) {
        // Calculate dB change (invert delta direction if needed)
        const dbChange = delta > 0 ? -2 : 2; // Scroll down/away = quieter = negative dB change
        const currentVol = this.volumeValue;

        // Define limits
        const minVolDb = -48;
        const maxVolDb = 6;
        // Clamp the new volume
        this.volumeValue = Math.max(minVolDb, Math.min(maxVolDb, currentVol + dbChange));

        // Apply volume to Tone node
        if (this.volume?.volume) {
            if (this.isLoaded && Tone.context.state === 'running') {
                this.volume.volume.linearRampToValueAtTime(this.volumeValue, Tone.now() + 0.05);
            } else {
                 this.volume.volume.value = this.volumeValue; // Set directly if not running/ready
            }
        }

        // Update radius based on normalized volume
        const minRadius = 12;
        const maxRadius = 35;
        const norm = (this.volumeValue - minVolDb) / (maxVolDb - minVolDb); // Normalize 0-1
        this.radius = minRadius + Math.max(0, Math.min(1, norm)) * (maxRadius - minRadius);
    }

    /** Cleanly dispose of all Tone.js resources associated with this puck */
    dispose() {
        const currentIndex = typeof pucks !== 'undefined' ? pucks.indexOf(this) : -1;
        console.log(`Disposing Puck index ${currentIndex} (${this.filename})`);
        try {
            if (this.player) { this.player.stop(); this.player.unsync(); this.player.dispose(); }
            if (this.delay) this.delay.dispose();
            if (this.reverb) this.reverb.dispose();
            if (this.distortion) this.distortion.dispose();
            if (this.eq) this.eq.dispose();
            if (this.volume) this.volume.dispose();
             // Blob URL NOT revoked here for UNDO functionality
        } catch (e) {
             console.error(`Error during Tone node disposal for Puck index ${currentIndex}:`, e);
        } finally {
            // Nullify references to prevent memory leaks
            this.player = null; this.delay = null; this.reverb = null; this.distortion = null; this.eq = null; this.volume = null;
            this.isLoaded = false; this.isPlaying = false; // Reset state flags
            console.log(`Finished disposing Puck index ${currentIndex}`);
        }
    }

    /** Updates the puck's position based on velocity and handles collisions */
    update() {
        // Apply friction
        this.vx *= this.friction;
        this.vy *= this.friction;

        // Update position
        this.x += this.vx;
        this.y += this.vy;

        // Handle edge collisions
        this.handleEdgeCollisions();

        // Handle puck collisions with other pucks
        this.handlePuckCollisions();

        // Update audio effects based on new position
        if (typeof this.updateEffects === 'function') {
            this.updateEffects();
        }
    }

    /** Handles collisions with canvas edges */
    handleEdgeCollisions() {
        // Left edge
        if (this.x - this.radius < 0) {
            this.x = this.radius;
            this.vx = -this.vx * this.bounce;
        }
        // Right edge
        if (this.x + this.radius > canvas.width) {
            this.x = canvas.width - this.radius;
            this.vx = -this.vx * this.bounce;
        }
        // Top edge
        if (this.y - this.radius < 0) {
            this.y = this.radius;
            this.vy = -this.vy * this.bounce;
        }
        // Bottom edge
        if (this.y + this.radius > canvas.height) {
            this.y = canvas.height - this.radius;
            this.vy = -this.vy * this.bounce;
        }
    }

    /** Handles collisions with other pucks */
    handlePuckCollisions() {
        if (!pucks) return;

        for (const otherPuck of pucks) {
            if (otherPuck === this) continue;

            // Calculate distance between pucks
            const dx = otherPuck.x - this.x;
            const dy = otherPuck.y - this.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Check if pucks are colliding
            if (distance < this.radius + otherPuck.radius) {
                // Calculate collision normal
                const nx = dx / distance;
                const ny = dy / distance;

                // Calculate relative velocity
                const relativeVx = this.vx - otherPuck.vx;
                const relativeVy = this.vy - otherPuck.vy;

                // Calculate relative velocity in terms of the normal direction
                const velocityAlongNormal = relativeVx * nx + relativeVy * ny;

                // Do not resolve if velocities are separating
                if (velocityAlongNormal > 0) continue;

                // Calculate restitution
                const restitution = Math.min(this.bounce, otherPuck.bounce);

                // Calculate impulse scalar
                const j = -(1 + restitution) * velocityAlongNormal;
                const impulse = j / (1/this.mass + 1/otherPuck.mass);

                // Apply impulse
                this.vx -= (impulse * nx) / this.mass;
                this.vy -= (impulse * ny) / this.mass;
                otherPuck.vx += (impulse * nx) / otherPuck.mass;
                otherPuck.vy += (impulse * ny) / otherPuck.mass;

                // Move pucks apart to prevent sticking
                const overlap = (this.radius + otherPuck.radius - distance) / 2;
                this.x -= overlap * nx;
                this.y -= overlap * ny;
                otherPuck.x += overlap * nx;
                otherPuck.y += overlap * ny;
            }
        }
    }
} // End of AudioPuck Class