/**
 * js/audio-puck.js
 * Defines the AudioPuck class for managing individual audio sources.
 * Handles loading, playback, effects, drawing, and interaction (drag, delete, toggle).
 * Depends on global variables/objects: Tone, canvas, corners, isTransportRunning, hoveredPuckIndex, pucks (defined in main.js)
 */

// Convert a hex string to an RGB object.
function hexToRgb(hex) {
    // Remove # if present.
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) {
        // Expand shorthand form (e.g. "03F") to full form ("0033FF")
        hex = hex.split('').map(x => x + x).join('');
    }
    const bigint = parseInt(hex, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return { r, g, b };
}
  
// Inverts a color. Supports both hex and rgb/rgba strings.
function invertColor(color) {
    // If the color starts with a "#", convert to RGB first.
    if (color.startsWith('#')) {
        const { r, g, b } = hexToRgb(color);
        return `rgb(${255 - r}, ${255 - g}, ${255 - b})`;
    }
  
    // Otherwise, assume an rgb or rgba string.
    const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!rgbMatch) return color; // fallback
    const r = 255 - parseInt(rgbMatch[1], 10);
    const g = 255 - parseInt(rgbMatch[2], 10);
    const b = 255 - parseInt(rgbMatch[3], 10);
    if (rgbMatch[4] !== undefined) {
        return `rgba(${r}, ${g}, ${b}, ${rgbMatch[4]})`;
    }
    return `rgb(${r}, ${g}, ${b})`;
}
  
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
  
        // Physics properties - initialize based on current physics settings
        this.vx = 0;
        this.vy = 0;
        
        // Get physics settings from the UI or use defaults
        const frictionSlider = document.getElementById('friction-slider');
        const bounceSlider = document.getElementById('bounce-slider');
        const massSlider = document.getElementById('mass-slider');
        
        // Check if physics is enabled globally
        const physicsButton = document.getElementById('physics-settings');
        const isPhysicsEnabled = !physicsButton?.classList.contains('physics-off');
        
        if (isPhysicsEnabled) {
            this.friction = frictionSlider ? parseFloat(frictionSlider.value) : 0.98;
            this.bounce = bounceSlider ? parseFloat(bounceSlider.value) : 0.7;
            this.mass = massSlider ? parseFloat(massSlider.value) : 1;
        } else {
            // If physics is disabled, set all physics properties to 0
            this.friction = 0;
            this.bounce = 0;
            this.mass = 0;
            this.vx = 0;
            this.vy = 0;
        }
  
        // Path recording/playback properties
        this.isRecordingPath = false;     // True when user is recording a path
        this.recordedPath = [];           // Array to store { time, x, y } points
        this.recordingStartTime = 0;      // Timestamp when recording began
        this.isPlayingPath = false;       // True when the puck is replaying a recorded path
        this.playbackStartTime = 0;       // Timestamp when playback started
        this.recordingDuration = 0;       // Total duration of the recorded path (ms)
        this.isPrimaryDrawingPuck = false; // Indicates if this is the puck being actively drawn with
  
        // State Flags
        this.isPlaying = false; // Is the puck outputting audio (tied to Transport & mute)
        this.isLoaded = false;
        this.loadError = false;
        this.willPlay = true;   // Should the puck play when Transport starts?
        this.isMuted = false;   // Is the puck muted?
        this.reverseActive = false; // Is reverse playback active? (Toggled by right click)

        // Connection properties
        this.connectedPucks = []; // Array to store references to connected pucks
        this.isConnecting = false; // Flag to indicate if this puck is being used to create a connection
        this.connectionLine = null; // Stores the current connection line coordinates when dragging
        this.willFormTriangle = false; // Indicator for potential triangle formations
  
        // Add panning properties
        this.isPanning = false; // Whether the puck is in panning mode
        this.panAngle = 0; // Current pan angle in degrees (-180 to 180)
        this.panNode = null; // Will hold the Tone.Panner node
  
        try {
            // --- Initialize Tone.js Nodes ---
            this.delay = new Tone.FeedbackDelay({ delayTime: 0.25, feedback: 0.5, wet: 0 });
            this.reverb = new Tone.Reverb({ decay: 2, wet: 0 });
            this.distortion = new Tone.Distortion({ distortion: 0.6, wet: 0 });
            this.eq = new Tone.EQ3({ low: 0, mid: 0, high: 0 });
            this.panNode = new Tone.Panner(0).toDestination(); // Initialize panner with center position
            // Initialize volume with mute state based on isMuted
            this.volume = new Tone.Volume(this.volumeValue).toDestination();
            this.volume.mute = this.isMuted;
  
            // Generate reverb impulse response asynchronously
            this.reverb.generate().then(() => {
                // Optional log: console.log(`Reverb generated for Puck ${pucks.indexOf(this) + 1}`);
            }).catch(err => {
                console.error(`Reverb generation failed for Puck ${pucks.indexOf(this) + 1}:`, err);
            });
  
            // --- Initialize Tone.Player ---
            this.player = new Tone.Player({
                url: this.url,
                autostart: false, // Controlled manually via sync() and Transport
                loop: true,
                fadeIn: 0.1,
                fadeOut: 0.1,
                onload: () => {
                    const currentIdx = typeof pucks !== 'undefined' ? pucks.indexOf(this) : -1;
                    console.log(`Puck ${currentIdx + 1} (${this.filename}) loaded successfully.`);
                    this.isLoaded = true;
                    this.loadError = false;
                    this.setVolume(0); // Update radius based on initial volume
  
                    // If transport is running and the puck is armed, start immediately.
                    const transportIsRunning = typeof isTransportRunning !== 'undefined' && isTransportRunning && Tone.Transport.state === 'started';
                    if (transportIsRunning && this.willPlay) {
                        console.log(`Puck ${currentIdx + 1}: Transport running, starting immediately.`);
                        this.player.sync().start(0);
                        this.isPlaying = true;
                    } else {
                        this.isPlaying = false;
                    }
                    if (this.volume) this.volume.mute = this.isMuted;
  
                },
                onerror: (error) => {
                    const currentIdx = typeof pucks !== 'undefined' ? pucks.indexOf(this) : -1;
                    console.error(`Error loading audio for Puck ${currentIdx + 1} (${this.filename}):`, error);
                    this.loadError = true;
                    this.isLoaded = false;
                    this.isPlaying = false;
                    alert(`Error loading: ${this.filename}. Unsupported format or network issue? Check console.`);
                }
            }).chain(this.delay, this.reverb, this.distortion, this.eq, this.panNode, this.volume);
  
            this.updateEffects(); // Initialize effect levels based on initial position
  
        } catch (error) {
            const currentIdx = typeof pucks !== 'undefined' ? pucks.indexOf(this) : index;
            console.error(`FATAL: Error during AudioPuck ${currentIdx + 1} (${this.filename}) constructor:`, error);
            this.loadError = true;
            alert(`Failed to initialize audio components for ${this.filename}. See console.`);
        }
    }

    // Called when the user starts dragging with shift pressed
    startPathRecording() {
        this.isRecordingPath = true;
        this.recordedPath = [];
        this.recordingStartTime = performance.now();
        this.isPlayingPath = false; // Stop any existing playback
        console.log(`AudioPuck "${this.filename}" started path recording.`);
    }

    // Call this on each drag update while shift is held to record the current position.
    recordPathPoint() {
        if (!this.isRecordingPath) return;
        const timeStamp = performance.now() - this.recordingStartTime;
        this.recordedPath.push({ time: timeStamp, x: this.x, y: this.y });
    }

    // Called when the Shift key is released (or drag ends while Shift not active)
    stopPathRecording() {
        if (!this.isRecordingPath) return;
        this.isRecordingPath = false;
        if (this.recordedPath.length > 0) {
            this.recordingDuration = this.recordedPath[this.recordedPath.length - 1].time;
            this.isPlayingPath = true;
            this.playbackStartTime = performance.now();
            console.log(`AudioPuck "${this.filename}" stopped recording. Duration: ${this.recordingDuration} ms. Starting playback loop.`);
        }
    }

    // During each update, if playing back a recorded path, this method interpolates the position.
    updatePathPlayback() {
        if (!this.isPlayingPath || !this.recordedPath || this.recordedPath.length < 2 || this.recordingDuration <= 0) return;
        
        try {
            // Calculate elapsed time (looped)
            const elapsed = (performance.now() - this.playbackStartTime) % this.recordingDuration;
            
            // Find recorded points bracketing the elapsed time
            let startPoint = this.recordedPath[0];
            let endPoint = this.recordedPath[this.recordedPath.length - 1];
            for (let i = 0; i < this.recordedPath.length - 1; i++) {
                if (this.recordedPath[i].time <= elapsed && this.recordedPath[i+1].time >= elapsed) {
                    startPoint = this.recordedPath[i];
                    endPoint = this.recordedPath[i+1];
                    break;
                }
            }
            
            // Verify that startPoint and endPoint are valid
            if (!startPoint || !endPoint || 
                typeof startPoint.x !== 'number' || typeof startPoint.y !== 'number' ||
                typeof endPoint.x !== 'number' || typeof endPoint.y !== 'number') {
                console.warn("Invalid path points detected");
                return;
            }
            
            // Calculate the delta movement from current position
            const oldX = this.x;
            const oldY = this.y;
            
            // Compute ratio (avoid division by zero)
            const interval = (endPoint.time - startPoint.time) || 1;
            const ratio = (elapsed - startPoint.time) / interval;
            
            // Linearly interpolate between the two points
            this.x = startPoint.x + ratio * (endPoint.x - startPoint.x);
            this.y = startPoint.y + ratio * (endPoint.y - startPoint.y);
            
            // Calculate the movement delta
            const deltaX = this.x - oldX;
            const deltaY = this.y - oldY;
            
            // Move connected pucks along with this puck during playback
            if (this.connectedPucks && this.connectedPucks.length > 0) {
                // Skip if delta is very small to avoid unnecessary calculations
                if (Math.abs(deltaX) > 0.01 || Math.abs(deltaY) > 0.01) {
                    const movedPucks = new Set([this]); // Track which pucks we've moved to avoid loops
                    
                    // Function to recursively move connected pucks
                    const moveConnectedPucks = (currentPuck, dx, dy) => {
                        if (!currentPuck || !currentPuck.connectedPucks) return;
                        
                        for (const connectedPuck of currentPuck.connectedPucks) {
                            // Skip if already moved this puck, if it's null, or if it's in its own path playback
                            if (!connectedPuck || movedPucks.has(connectedPuck) || connectedPuck.isPlayingPath) continue;
                            
                            // Move the connected puck by the same delta
                            connectedPuck.x += dx;
                            connectedPuck.y += dy;
                            
                            // Mark as moved and update effects
                            movedPucks.add(connectedPuck);
                            if (typeof connectedPuck.updateEffects === 'function') {
                                try {
                                    connectedPuck.updateEffects();
                                } catch (error) {
                                    console.warn("Error updating effects for connected puck:", error);
                                }
                            }
                            
                            // Recursively move pucks connected to this one
                            moveConnectedPucks(connectedPuck, dx, dy);
                        }
                    };
                    
                    // Start moving connected pucks
                    moveConnectedPucks(this, deltaX, deltaY);
                }
            }
            
            // Safe update of effects
            if (typeof this.updateEffects === 'function') {
                try {
                    this.updateEffects();
                } catch (error) {
                    console.warn("Error updating effects during path playback:", error);
                }
            }
        } catch (error) {
            console.warn("Error in path playback:", error);
            // Reset playback state on error to prevent endless errors
            this.isPlayingPath = false;
        }
    }
  
    /**
     * Toggles the playback state (mute or willPlay) based on Tone.Transport's state.
     */
    togglePlayback() {
        try {
            // Ensure audio context is running
            if (Tone.context.state !== 'running') {
                Tone.start();
            }
            
            console.log(`Toggle playback for puck ${pucks.indexOf(this) + 1}, currently playing: ${this.isPlaying}`);
            
            // Handle toggling based on the current state
            if (!isTransportRunning) {
                // Transport not running - toggle willPlay flag
                this.willPlay = !this.willPlay;
                console.log(`Set willPlay to ${this.willPlay} (transport not running)`);
                
                // Visual feedback only - transport isn't running
                this.isPlaying = this.willPlay;
            } else {
                // Transport is running - immediate toggle
                if (this.isPlaying) {
                    // Currently playing - stop this puck immediately
                    console.log(`Stopping playback for puck ${pucks.indexOf(this) + 1}`);
                    
                    if (this.player) {
                        // Stop and set volume to 0 for immediate effect
                        this.player.stop();
                        if (this.volume) this.volume.mute = true;
                        
                        // Update flags
                        this.isPlaying = false;
                        this.isMuted = true;
                        this.willPlay = false;
                    }
                } else {
                    // Currently stopped - start this puck immediately
                    console.log(`Starting playback for puck ${pucks.indexOf(this) + 1}`);
                    
                    if (this.player) {
                        // Sync to transport, unmute, and start immediately
                        this.player.unsync().sync().start(0);
                        if (this.volume) this.volume.mute = false;
                        
                        // Update flags
                        this.isPlaying = true;
                        this.isMuted = false;
                        this.willPlay = true;
                    }
                }
            }
        } catch (err) {
            console.error(`Error in togglePlayback for puck ${pucks.indexOf(this) + 1}:`, err);
        }
    }
  
    /**
     * Calculates the position for the delete button.
     */
    getDeleteButtonPosition() {
        const angle = -Math.PI / 4; // Top-right direction (-45 degrees)
        const cosAngle = Math.cos(angle);
        const sinAngle = Math.sin(angle);
        const minCenterDistance = this.deleteButtonRadius + 6; // Minimum distance (8px + 6px padding)
        const idealDistance = this.radius;
        const actualDistance = Math.max(idealDistance, minCenterDistance);
        const offsetX = cosAngle * actualDistance;
        const offsetY = sinAngle * actualDistance;
        return { x: this.x + offsetX, y: this.y + offsetY };
    }
  
    /**
     * Draws the puck, including its audio state, number label, and (if hovered) delete button.
     * When reverse playback is active, the puck's fill color is inverted.
     */
    draw(ctx) {
        if (!ctx) return;
        ctx.save();
  
        const currentIdx = pucks.indexOf(this);
        const transportIsRunning = isTransportRunning && Tone.Transport.state === 'started';
  
        // Draw connection lines to connected pucks first (so they appear behind the puck)
        this.connectedPucks.forEach(connectedPuck => {
            ctx.shadowColor = 'rgba(108, 99, 255, 0.5)'; // Accent color with transparency
            ctx.shadowBlur = 5;
            ctx.strokeStyle = 'rgba(108, 99, 255, 0.4)'; // Accent color
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(connectedPuck.x, connectedPuck.y);
            ctx.stroke();
            // Reset shadow
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
        });
  
        // Draw active connection line if this puck is being used to create a connection
        if (this.isConnecting && this.connectionStartPoint && this.connectionEndPoint) {
            // Use grey for non-snapping state, accent color for snapping
            const lineColor = this.isSnapping ? 'rgba(108, 99, 255, 0.8)' : 'rgba(150, 150, 150, 0.4)';
            const shadowColor = this.isSnapping ? 'rgba(108, 99, 255, 0.5)' : 'rgba(150, 150, 150, 0.3)';
            
            ctx.shadowColor = shadowColor;
            ctx.shadowBlur = this.isSnapping ? 5 : 3;
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]); // Dashed line for active connection
            
            ctx.beginPath();
            ctx.moveTo(this.connectionStartPoint.x, this.connectionStartPoint.y);
            ctx.lineTo(this.connectionEndPoint.x, this.connectionEndPoint.y);
            ctx.stroke();
            
            // Draw a circle at the end of the line when snapping
            if (this.isSnapping) {
                ctx.beginPath();
                ctx.arc(this.connectionEndPoint.x, this.connectionEndPoint.y, 5, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(108, 99, 255, 0.8)';
                ctx.fill();
            }
            
            // Reset line style and shadow
            ctx.setLineDash([]);
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
        }
  
        // Determine overall opacity (dimmed if muted or not armed)
        let puckOpacity = 1.0;
        if ((transportIsRunning && this.isMuted) || (!transportIsRunning && !this.willPlay)) {
            puckOpacity = 0.55;
        }
  
        // Determine base fill color.
        const puckColorPlaying = getComputedStyle(document.documentElement)
            .getPropertyValue('--accent-color').trim() || '#6c63ff';
        const puckColorStopped = 'rgba(240, 240, 240, 0.85)';
        let currentFill = (this.willPlay || transportIsRunning) ? puckColorPlaying : puckColorStopped;
        if (this.loadError) {
            currentFill = 'rgba(255, 180, 0, 0.8)';
        } else if (!this.isLoaded) {
            currentFill = 'rgba(150, 150, 150, 0.7)';
        }
  
        // Invert the fill color if reverse mode is active.
        if (this.reverseActive) {
            currentFill = invertColor(currentFill);
        }
  
        // Draw the puck circle with a shadow.
        ctx.shadowColor = currentFill;
        ctx.shadowBlur = 15;
        ctx.globalAlpha = puckOpacity;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = currentFill;
        ctx.fill();
  
        // Draw panning bar if in panning mode
        if (this.isPanning) {
            ctx.save();
            
            // Draw the panning bar background
            const barWidth = this.radius * 2.5;
            const barHeight = 6;
            const barX = this.x - barWidth/2;
            const barY = this.y + this.radius + 10;
            
            // Draw bar background
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.fillRect(barX, barY, barWidth, barHeight);
            
            // Draw center line
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(this.x, barY);
            ctx.lineTo(this.x, barY + barHeight);
            ctx.stroke();
            
            // Draw pan indicator
            const panX = this.x + (this.panAngle / 180) * (barWidth/2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.beginPath();
            ctx.arc(panX, barY + barHeight/2, 4, 0, Math.PI * 2);
            ctx.fill();
            
            // Draw pan value
            ctx.fillStyle = 'white';
            ctx.font = '12px Poppins';
            ctx.textAlign = 'center';
            ctx.fillText(`${this.panAngle.toFixed(0)}°`, this.x, barY + barHeight + 15);
            
            ctx.restore();
        }
  
        // Reset shadow and opacity for text.
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1.0;
        
        // Draw autosampling indicator if active
        if (this.isAutosampling) {
            // Draw a pulsing ring around the puck when autosampling
            const now = performance.now();
            const pulseSize = 1 + 0.2 * Math.sin(now / 200); // Subtle pulse effect
            
            // Draw ring with accent color and animation
            ctx.globalAlpha = 0.7 + 0.3 * Math.sin(now / 300);
            ctx.strokeStyle = '#ff5d8f'; // Hot pink for autosampling
            ctx.lineWidth = 3 * pulseSize;
            ctx.setLineDash([5, 3]);
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius + 6, 0, Math.PI * 2);
            ctx.stroke();
            
            // Add some smaller circles around the puck for a "sampling" effect
            const numCircles = 3;
            ctx.fillStyle = '#ff5d8f';
            ctx.setLineDash([]);
            
            for (let i = 0; i < numCircles; i++) {
                const angle = (now / 500) + (i * (Math.PI * 2 / numCircles));
                const dist = this.radius + 12;
                const size = 2 + Math.sin(now / 200 + i) * 1.5;
                
                const cx = this.x + Math.cos(angle) * dist;
                const cy = this.y + Math.sin(angle) * dist;
                
                ctx.beginPath();
                ctx.arc(cx, cy, size, 0, Math.PI * 2);
                ctx.fill();
            }
            
            // Reset opacity and line style
            ctx.globalAlpha = 1.0;
            ctx.setLineDash([]);
        }
  
        // Determine text color based on state.
        let textColor = (this.willPlay || transportIsRunning) ? 'white' : 'black';
        if (this.loadError || !this.isLoaded) textColor = 'white';
        if (puckOpacity < 1.0) {
            textColor = (this.willPlay || transportIsRunning) ? 'rgba(220, 220, 220, 0.8)' : 'rgba(100, 100, 100, 0.8)';
            if (this.loadError || !this.isLoaded) textColor = 'rgba(220, 220, 220, 0.8)';
        }
  
        ctx.fillStyle = textColor;
        ctx.font = `bold ${Math.max(10, this.radius * 0.6)}px Poppins`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
  
        const displayIndex = currentIdx + 1;
        ctx.fillText(displayIndex > 0 ? displayIndex : '?', this.x, this.y);
  
        // Draw hover info and delete button if this puck is hovered.
        const currentHoverIndex = typeof hoveredPuckIndex !== 'undefined' ? hoveredPuckIndex : null;
        if (currentHoverIndex === currentIdx) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.font = '12px Poppins';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
  
            let stateText = '';
            if (this.loadError) stateText = 'Load Error!';
            else if (!this.isLoaded) stateText = 'Loading...';
            else if (transportIsRunning) {
                stateText = this.willPlay ? (this.isMuted ? 'Playing (Muted)' : 'Playing') : 'Stopped';
            } else {
                stateText = this.willPlay ? 'Ready' : 'Paused';
            }
            
            // Add autosampling status to hover text
            if (this.isAutosampling) {
                stateText += ' [Autosampling]';
            }
  
            const displayName = this.filename.length > 25 ? this.filename.substring(0, 22) + '...' : this.filename;
            const textX = this.x + this.radius + 8;
            const textY = this.y + this.radius + 4;
            ctx.fillText(`${displayName} (${stateText})`, textX, textY);
            const volumeText = `Vol: ${this.volumeValue.toFixed(1)} dB`;
            ctx.fillText(volumeText, textX, textY + 14);
            
            this.drawDeleteButton(ctx);
        }
        
        // Draw the path indicator if a recorded path exists AND
        // this is either the primary drawing puck or in playback mode
        if (this.recordedPath.length > 0 && (this.isPrimaryDrawingPuck || this.isPlayingPath)) {
            ctx.save();
            
            // Get the accent color from CSS or use default purple
            const accentColor = getComputedStyle(document.documentElement)
                .getPropertyValue('--accent-color').trim() || '#6c63ff';
            
            // Different style for primary drawing puck vs playback
            if (this.isPrimaryDrawingPuck) {
                // Active drawing path style
                ctx.strokeStyle = accentColor;
                ctx.lineWidth = 3;
                ctx.shadowColor = `rgba(108, 99, 255, 0.6)`;
                ctx.shadowBlur = 8;
                // Use dotted line for active drawing for better visibility
                ctx.setLineDash([5, 3]);
            } else {
                // Playback path style
                ctx.strokeStyle = `rgba(108, 99, 255, 0.7)`;
                ctx.lineWidth = 2.5;
                ctx.shadowColor = `rgba(108, 99, 255, 0.4)`;
                ctx.shadowBlur = 5;
                // Dashed line for playback
                ctx.setLineDash([8, 4]);
            }
            
            // Set line cap to round for smoother dashed lines
            ctx.lineCap = 'round';
            
            ctx.beginPath();
            // Start at the first recorded point
            ctx.moveTo(this.recordedPath[0].x, this.recordedPath[0].y);
            // Draw a line through all recorded points
            for (let i = 1; i < this.recordedPath.length; i++) {
                ctx.lineTo(this.recordedPath[i].x, this.recordedPath[i].y);
            }
            ctx.stroke();
            
            // Draw small circles at the start and end points for added visual appeal
            ctx.setLineDash([]); // Reset line dash
            ctx.shadowBlur = 3;
            ctx.fillStyle = accentColor;
            
            // Start point circle
            ctx.beginPath();
            ctx.arc(this.recordedPath[0].x, this.recordedPath[0].y, 3, 0, Math.PI * 2);
            ctx.fill();
            
            // End point circle
            const lastPoint = this.recordedPath[this.recordedPath.length - 1];
            ctx.beginPath();
            ctx.arc(lastPoint.x, lastPoint.y, 3, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.restore();
        }

        ctx.restore();
    }
  
    /** Draws the delete 'X' button with a themed gradient and shadow. */
    drawDeleteButton(ctx) {
        const pos = this.getDeleteButtonPosition();
        const r = this.deleteButtonRadius;
        const crossSize = r * 0.55;
  
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;
  
        const gradient = ctx.createRadialGradient(pos.x - r * 0.1, pos.y - r * 0.1, 0, pos.x, pos.y, r * 1.5);
        gradient.addColorStop(0, 'rgba(70, 70, 80, 0.85)');
        gradient.addColorStop(1, 'rgba(30, 30, 40, 0.90)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
        ctx.fill();
  
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
  
        ctx.strokeStyle = 'rgba(255, 80, 80, 0.9)';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(pos.x - crossSize, pos.y - crossSize);
        ctx.lineTo(pos.x + crossSize, pos.y + crossSize);
        ctx.moveTo(pos.x + crossSize, pos.y - crossSize);
        ctx.lineTo(pos.x - crossSize, pos.y + crossSize);
        ctx.stroke();
  
        ctx.restore();
    }
  
    /** Checks if the provided mouse coordinates hit the delete button area. */
    isDeleteHit(mx, my) {
        const pos = this.getDeleteButtonPosition();
        const dx = mx - pos.x;
        const dy = my - pos.y;
        return (dx * dx + dy * dy) <= (this.deleteButtonRadius * this.deleteButtonRadius);
    }
  
    /** Checks if the provided mouse coordinates are inside the puck's main body. */
    isHit(mx, my, inDrawingMode = false) {
        const dx = mx - this.x;
        const dy = my - this.y;
        // Use a larger hit radius when in drawing mode for more forgiveness
        const hitRadius = inDrawingMode ? this.radius * 1.75 : this.radius;
        return (dx * dx + dy * dy) <= (hitRadius * hitRadius);
    }
  
    /** Updates the wet levels of effects based on the puck's proximity to canvas corners. */
    updateEffects() {
        // Check if audio nodes are available
        if (!this.isLoaded || this.loadError || !Tone || !Tone.context) {
            // Safely set values to 0 if nodes exist
            if (this.delay && this.delay.wet && this.delay.wet.value !== undefined) this.delay.wet.value = 0;
            if (this.reverb && this.reverb.wet && this.reverb.wet.value !== undefined) this.reverb.wet.value = 0;
            if (this.distortion && this.distortion.wet && this.distortion.wet.value !== undefined) this.distortion.wet.value = 0;
            if (this.eq && this.eq.low && this.eq.low.value !== undefined) this.eq.low.value = 0;
            return;
        }
        
        try {
            // Make sure corners is defined and has the expected properties
            if (!corners || !corners.delay || !corners.reverb || !corners.distortion || !corners.eq) {
                console.warn("Missing corners definition for audio effects");
                return;
            }
            
            const d = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
            const currentWidth = canvas?.width || window.innerWidth;
            const currentHeight = canvas?.height || window.innerHeight;
            const maxDist = Math.hypot(currentWidth, currentHeight);
            if (maxDist === 0) return;
      
            const delayProx = 1 - Math.min(d(this, corners.delay) / maxDist, 1);
            const reverbProx = 1 - Math.min(d(this, corners.reverb) / maxDist, 1);
            const distortionProx = 1 - Math.min(d(this, corners.distortion) / maxDist, 1);
            const eqProx = 1 - Math.min(d(this, corners.eq) / maxDist, 1);
      
            // Make sure Tone.now() is available
            const now = Tone && typeof Tone.now === 'function' ? Tone.now() : 0;
            if (now === 0) return;
            
            const rampTime = now + 0.05;
            
            // Check each audio node before calling methods
            if (this.delay && this.delay.wet && typeof this.delay.wet.linearRampToValueAtTime === 'function') {
                this.delay.wet.linearRampToValueAtTime(delayProx * 0.5, rampTime);
            }
            
            if (this.reverb && this.reverb.wet && typeof this.reverb.wet.linearRampToValueAtTime === 'function') {
                this.reverb.wet.linearRampToValueAtTime(reverbProx, rampTime);
            }
            
            if (this.distortion && this.distortion.wet && typeof this.distortion.wet.linearRampToValueAtTime === 'function') {
                this.distortion.wet.linearRampToValueAtTime(distortionProx * 0.5, rampTime);
            }
            
            if (this.eq && this.eq.low && typeof this.eq.low.linearRampToValueAtTime === 'function') {
                const eqDB = (eqProx - 0.5) * 24;
                this.eq.low.linearRampToValueAtTime(eqDB, rampTime);
            }
        } catch (error) {
            console.warn("Error updating audio effects:", error);
        }
    }
  
    /** Adjusts the volume in dB and updates the puck's radius accordingly. */
    setVolume(delta) {
        const dbChange = delta > 0 ? -2 : 2; // Scrolling: down/away decreases volume
        const currentVol = this.volumeValue;
        const minVolDb = -48;
        const maxVolDb = 6;
        this.volumeValue = Math.max(minVolDb, Math.min(maxVolDb, currentVol + dbChange));
        if (this.volume?.volume) {
            if (this.isLoaded && Tone.context.state === 'running') {
                this.volume.volume.linearRampToValueAtTime(this.volumeValue, Tone.now() + 0.05);
            } else {
                this.volume.volume.value = this.volumeValue;
            }
        }
        const minRadius = 12;
        const maxRadius = 35;
        const norm = (this.volumeValue - minVolDb) / (maxVolDb - minVolDb);
        this.radius = minRadius + Math.max(0, Math.min(1, norm)) * (maxRadius - minRadius);
    }
  
    /** Cleanly disposes of all Tone.js resources associated with this puck. */
    dispose() {
        const currentIndex = typeof pucks !== 'undefined' ? pucks.indexOf(this) : -1;
        console.log(`Disposing Puck index ${currentIndex} (${this.filename})`);
        try {
            if (this.player) {
                this.player.stop();
                this.player.unsync();
                this.player.dispose();
            }
            if (this.delay) this.delay.dispose();
            if (this.reverb) this.reverb.dispose();
            if (this.distortion) this.distortion.dispose();
            if (this.eq) this.eq.dispose();
            if (this.panNode) this.panNode.dispose();
            if (this.volume) this.volume.dispose();
        } catch (e) {
            console.error(`Error during Tone node disposal for Puck index ${currentIndex}:`, e);
        } finally {
            this.player = null;
            this.delay = null;
            this.reverb = null;
            this.distortion = null;
            this.eq = null;
            this.panNode = null;
            this.volume = null;
            this.isLoaded = false;
            this.isPlaying = false;
            console.log(`Finished disposing Puck index ${currentIndex}`);
        }
    }
  
    /** Updates the puck's position based on its velocity and handles collisions. */
    update() {
        if (this.isPlayingPath) {
            // When playing back the recorded path, update the position accordingly.
            this.updatePathPlayback();
            this.updateEffects();
            return;
        }
        if (!this.isRecordingPath && !this.isConnecting) { // Don't update physics during connection
            // Normal physics update if not recording.
            this.vx *= this.friction;
            this.vy *= this.friction;
            this.x += this.vx;
            this.y += this.vy;
            this.handleEdgeCollisions();
            this.handlePuckCollisions();
            if (typeof this.updateEffects === 'function') {
                this.updateEffects();
            }
        }
    }
  
    /** Handles collisions with the canvas edges. */
    handleEdgeCollisions() {
        if (this.x - this.radius < 0) {
            this.x = this.radius;
            this.vx = -this.vx * this.bounce;
        }
        if (this.x + this.radius > canvas.width) {
            this.x = canvas.width - this.radius;
            this.vx = -this.vx * this.bounce;
        }
        if (this.y - this.radius < 0) {
            this.y = this.radius;
            this.vy = -this.vy * this.bounce;
        }
        if (this.y + this.radius > canvas.height) {
            this.y = canvas.height - this.radius;
            this.vy = -this.vy * this.bounce;
        }
    }
  
    /** Handles collisions with other pucks. */
    handlePuckCollisions() {
        if (!pucks || this.mass === 0) return; // Skip if physics is disabled (mass = 0)
        
        for (const otherPuck of pucks) {
            if (otherPuck === this || otherPuck.mass === 0) continue; // Skip if other puck has physics disabled
            
            const dx = otherPuck.x - this.x;
            const dy = otherPuck.y - this.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < this.radius + otherPuck.radius) {
                const nx = dx / distance;
                const ny = dy / distance;
                const relativeVx = this.vx - otherPuck.vx;
                const relativeVy = this.vy - otherPuck.vy;
                const velocityAlongNormal = relativeVx * nx + relativeVy * ny;
                
                if (velocityAlongNormal > 0) continue;
                
                const restitution = Math.min(this.bounce, otherPuck.bounce);
                const j = -(1 + restitution) * velocityAlongNormal;
                const impulse = j / (1 / this.mass + 1 / otherPuck.mass);
                
                this.vx -= (impulse * nx) / this.mass;
                this.vy -= (impulse * ny) / this.mass;
                otherPuck.vx += (impulse * nx) / otherPuck.mass;
                otherPuck.vy += (impulse * ny) / otherPuck.mass;
                
                const overlap = (this.radius + otherPuck.radius - distance) / 2;
                this.x -= overlap * nx;
                this.y -= overlap * ny;
                otherPuck.x += overlap * nx;
                otherPuck.y += overlap * ny;
            }
        }
    }
  
    /**
     * Toggles reverse playback for the puck.
     * This sets the Tone.Player's reverse property and updates the local flag.
     */
    toggleReversePlayback() {
        if (this.player) {
            this.player.reverse = !this.player.reverse;
            this.reverseActive = this.player.reverse;
            console.log(`AudioPuck "${this.filename}" reverse playback: ${this.player.reverse}`);
        }
    }

    // Add connection methods
    startConnection(mouseX, mouseY) {
        this.isConnecting = true;
        // Initialize connection points - start point is fixed at puck's center
        this.connectionStartPoint = { x: this.x, y: this.y };
        this.connectionEndPoint = { x: mouseX, y: mouseY };
        // Store the initial path state
        this.wasPlayingPath = this.isPlayingPath;
        this.wasRecordingPath = this.isRecordingPath;
        // Pause any path movement
        this.isPlayingPath = false;
        this.isRecordingPath = false;
        // Store initial velocities
        this.storedVx = this.vx;
        this.storedVy = this.vy;
        // Initialize snap state
        this.isSnapping = false;
        this.snapTarget = null;
    }

    updateConnection(mouseX, mouseY) {
        if (this.isConnecting) {
            // Update the end point of the connection line
            this.connectionEndPoint = { x: mouseX, y: mouseY };
            
            // Check for nearby pucks to snap to
            let closestPuck = null;
            let minDistance = 40; // Snap radius in pixels - reduced to make it easier to target specific pucks
            
            for (const puck of pucks) {
                if (puck === this) continue;
                
                const dx = mouseX - puck.x;
                const dy = mouseY - puck.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < minDistance) {
                    minDistance = distance;
                    closestPuck = puck;
                }
            }
            
            // Check if this connection would form a triangle
            this.willFormTriangle = false;
            if (closestPuck) {
                // Check if the potential target connects to any puck that this puck is already connected to
                for (const myConnectedPuck of this.connectedPucks) {
                    if (closestPuck.connectedPucks.includes(myConnectedPuck)) {
                        this.willFormTriangle = true;
                        break;
                    }
                }
                
                // Also check the other direction - if this puck is connected to any of target's connections
                if (!this.willFormTriangle) {
                    for (const theirConnectedPuck of closestPuck.connectedPucks) {
                        if (this.connectedPucks.includes(theirConnectedPuck)) {
                            this.willFormTriangle = true;
                            break;
                        }
                    }
                }
            }
            
            // If we found a puck to snap to, smoothly transition to its position
            if (closestPuck) {
                // Smooth transition to the target position
                const transitionSpeed = 0.3; // Slightly faster transition
                this.connectionEndPoint.x += (closestPuck.x - this.connectionEndPoint.x) * transitionSpeed;
                this.connectionEndPoint.y += (closestPuck.y - this.connectionEndPoint.y) * transitionSpeed;
                this.isSnapping = true;
                this.snapTarget = closestPuck;
            } else {
                this.isSnapping = false;
                this.snapTarget = null;
            }
        }
    }

    endConnection(targetPuck) {
        if (!targetPuck || targetPuck === this) {
            this.cancelConnection();
            return;
        }

        // Check if we already have a connection with this puck
        if (this.connectedPucks.includes(targetPuck)) {
            console.log("Already connected to this puck");
            this.cancelConnection();
            return;
        }

        // Create the initial connection
        this.connectedPucks.push(targetPuck);
        targetPuck.connectedPucks.push(this);
        
        console.log(`Connected puck ${pucks.indexOf(this) + 1} to puck ${pucks.indexOf(targetPuck) + 1}`);
        
        // Handle triangle formations
        this.createTriangleConnections(targetPuck);
        
        this.isConnecting = false;
        this.connectionLine = null;
        this.snapTarget = null;
    }
    
    // Creates triangle connections between pucks
    createTriangleConnections(targetPuck) {
        // Case 1: If targetPuck has connections and we don't have many, auto-form a triangle
        if (targetPuck.connectedPucks.length > 1 && this.connectedPucks.length === 1) {
            // Find another puck connected to targetPuck that isn't us
            const otherPuck = targetPuck.connectedPucks.find(puck => puck !== this);
            if (otherPuck && !this.connectedPucks.includes(otherPuck)) {
                // Connect to form a triangle
                this.connectedPucks.push(otherPuck);
                otherPuck.connectedPucks.push(this);
                console.log(`Auto-formed triangle with puck ${pucks.indexOf(otherPuck) + 1}`);
                return;
            }
        }
        
        // Case 2: If we have connections and targetPuck is new, auto-form a triangle
        if (this.connectedPucks.length > 1 && targetPuck.connectedPucks.length === 1) {
            // Find another puck we're connected to that isn't targetPuck
            const otherPuck = this.connectedPucks.find(puck => puck !== targetPuck);
            if (otherPuck && !targetPuck.connectedPucks.includes(otherPuck)) {
                // Connect to form a triangle
                targetPuck.connectedPucks.push(otherPuck);
                otherPuck.connectedPucks.push(targetPuck);
                console.log(`Auto-formed triangle with puck ${pucks.indexOf(otherPuck) + 1}`);
                return;
            }
        }
        
        // Find all pucks that are connected to both this puck and the target puck
        const commonConnections = this.connectedPucks.filter(puck => 
            targetPuck.connectedPucks.includes(puck) && 
            puck !== targetPuck
        );

        // If we have exactly one common connection, we're adding to an existing triangle
        if (commonConnections.length === 1) {
            const existingPuck = commonConnections[0];
            
            // Check if this would form a complete triangle
            if (!this.connectedPucks.includes(existingPuck)) {
                // Connect to form the new triangle
                this.connectedPucks.push(existingPuck);
                existingPuck.connectedPucks.push(this);
                console.log(`Formed new triangle with puck ${pucks.indexOf(existingPuck) + 1}`);
            }
        } else if (commonConnections.length === 0) {
            // If no common connections, look for other possibilities
            
            // If we're adding a 4th+ puck to an existing network
            const potentialTrianglePuck = targetPuck.connectedPucks.find(puck => 
                !this.connectedPucks.includes(puck) && 
                puck !== this
            );
            
            if (potentialTrianglePuck) {
                // Connect to form a new triangle
                this.connectedPucks.push(potentialTrianglePuck);
                potentialTrianglePuck.connectedPucks.push(this);
                console.log(`Formed new triangle with puck ${pucks.indexOf(potentialTrianglePuck) + 1}`);
            }
        }
    }

    cancelConnection() {
        this.isConnecting = false;
        this.connectionStartPoint = null;
        this.connectionEndPoint = null;
        this.isSnapping = false;
        this.snapTarget = null;
        this.willFormTriangle = false;
        // Restore path state
        this.isPlayingPath = this.wasPlayingPath;
        this.isRecordingPath = this.wasRecordingPath;
        // Restore velocities
        this.vx = this.storedVx;
        this.vy = this.storedVy;
    }

    disconnectFrom(puck) {
        const index = this.connectedPucks.indexOf(puck);
        if (index !== -1) {
            this.connectedPucks.splice(index, 1);
            // Also remove this puck from the other puck's connections
            const otherIndex = puck.connectedPucks.indexOf(this);
            if (otherIndex !== -1) {
                puck.connectedPucks.splice(otherIndex, 1);
            }
        }
    }

    disconnectAll() {
        // Create a copy of the array to avoid modification during iteration
        const connectedPucksCopy = [...this.connectedPucks];
        for (const puck of connectedPucksCopy) {
            this.disconnectFrom(puck);
        }
    }

    /**
     * Stops path playback for this puck and optionally for all connected pucks.
     * @param {boolean} includeConnected - Whether to also stop playback for connected pucks.
     */
    stopPathPlayback(includeConnected = false) {
        if (this.isPlayingPath) {
            this.isPlayingPath = false;
            console.log(`Stopped path playback for puck ${this.filename}`);
        }
        
        // Also stop playback for all connected pucks if requested
        if (includeConnected && this.connectedPucks && this.connectedPucks.length > 0) {
            const processedPucks = new Set([this]); // Track which pucks we've processed to avoid loops
            
            // Function to recursively stop path playback for connected pucks
            const stopConnectedPucksPaths = (currentPuck) => {
                for (const connectedPuck of currentPuck.connectedPucks) {
                    // Skip if already processed
                    if (processedPucks.has(connectedPuck)) continue;
                    
                    // Stop path playback for this connected puck
                    if (connectedPuck.isPlayingPath) {
                        connectedPuck.isPlayingPath = false;
                        console.log(`Stopped path playback for connected puck ${connectedPuck.filename}`);
                    }
                    
                    // Mark as processed
                    processedPucks.add(connectedPuck);
                    
                    // Recursively process pucks connected to this one
                    stopConnectedPucksPaths(connectedPuck);
                }
            };
            
            // Start stopping connected pucks' path playback
            stopConnectedPucksPaths(this);
        }
    }

    /**
     * Toggles panning mode for the puck.
     * @param {boolean} enable - Whether to enable or disable panning mode.
     */
    togglePanning(enable) {
        this.isPanning = enable;
        // Don't reset pan when disabling - keep the last pan value
    }

    /**
     * Sets the pan position based on the angle.
     * @param {number} angle - The pan angle in degrees (-180 to 180).
     */
    setPan(angle) {
        // Clamp angle between -180 and 180 degrees
        this.panAngle = Math.max(-180, Math.min(180, angle));
        
        // Convert angle to pan value (-1 to 1)
        const panValue = this.panAngle / 180;
        
        // Update the pan node
        if (this.panNode && this.panNode.pan) {
            this.panNode.pan.value = panValue;
        }
    }

    /**
     * Resets the pan to center (0 degrees).
     */
    resetPan() {
        this.setPan(0);
    }
} // End of AudioPuck Class
