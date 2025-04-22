/**
 * js/autosampler.js
 * Handles automatic sampling and sequenced playback of audio clips from connected pucks.
 * Creates chopped samples in the style of hip-hop producers.
 * Depends on global variables/objects: Tone, pucks (defined in main.js)
 */

class AutoSampler {
    constructor() {
        // AutoSampler state
        this.isActive = false;
        this.targetPuckGroups = []; // Groups of connected pucks for autosampling
        this.currentSequence = []; // Current playback sequence
        this.players = []; // Array of Tone.Players for sample playback
        this.currentIndex = 0; // Current position in the sequence
        this.nextPlaybackTime = null; // Next scheduled playback time
        this.scheduledEvents = []; // Scheduled event IDs to cancel when stopping
        
        // Sample settings
        this.minSampleLength = 0.5; // Min sample length in seconds
        this.maxSampleLength = 2.0; // Max sample length in seconds
        
        // Volume and FX settings
        this.outputGain = new Tone.Gain(0.9).toDestination();
        
        // Create some subtle effects for the sampler output
        this.filter = new Tone.Filter({
            type: "lowpass",
            frequency: 8000,
            Q: 1
        }).connect(this.outputGain);
        
        this.compressor = new Tone.Compressor({
            threshold: -20,
            ratio: 4,
            attack: 0.005,
            release: 0.1
        }).connect(this.filter);
    }
    
    /**
     * Starts autosampling for a group of connected pucks
     * @param {Array} puckGroup - Array of connected AudioPuck objects
     */
    async start(puckGroup) {
        if (this.isActive) {
            this.stop(); // Stop any existing autosampling
        }
        
        if (!puckGroup || !puckGroup.length || puckGroup.length < 1) {
            console.log("No valid pucks to autosample");
            return;
        }
        
        console.log(`Starting autosampling for ${puckGroup.length} connected pucks`);
        
        // Ensure audio context is running
        if (Tone.context.state !== "running") {
            try {
                console.log("Starting audio context for autosampling");
                await Tone.start();
                console.log("Audio context started successfully");
            } catch (err) {
                console.error("Could not start audio context for autosampling:", err);
                return;
            }
        }
        
        // Make sure Tone.Transport is running
        if (Tone.Transport.state !== "started") {
            console.log("Starting Tone.Transport for autosampling");
            Tone.Transport.start();
        }
        
        // Find all connected groups
        this.targetPuckGroups = this.findConnectedPuckGroups(puckGroup);
        
        // Create and prepare the sequence
        await this.prepareSequence();
        
        // Start the sequencer
        this.startSequencer();
        
        this.isActive = true;
    }
    
    /**
     * Finds all connected puck groups starting from the provided puck group
     */
    findConnectedPuckGroups(initialPucks) {
        // For now, we'll just use the provided puck group
        // In a more complex implementation, we could recursively find all connected groups
        return [Array.from(initialPucks)];
    }
    
    /**
     * Prepares the chopped sample sequence from all target puck groups
     */
    async prepareSequence() {
        // Clear existing players and sequence
        this.disposePlayers();
        this.currentSequence = [];
        this.players = [];
        
        const sequencePromises = [];
        
        // Iterate through all puck groups and create samples
        this.targetPuckGroups.forEach(puckGroup => {
            puckGroup.forEach(puck => {
                // Skip pucks that aren't loaded or have errors
                if (!puck.isLoaded || puck.loadError || !puck.player || !puck.player.buffer) {
                    console.log(`Skipping puck ${puck.filename} - not loaded or has errors`);
                    return;
                }
                
                // Create 2-4 samples from each puck based on its duration
                const buffer = puck.player.buffer;
                const duration = buffer.duration;
                const numSamples = Math.min(Math.floor(Math.random() * 3) + 2, Math.floor(duration / 0.5));
                
                console.log(`Creating ${numSamples} samples from ${puck.filename} (duration: ${duration}s)`);
                
                for (let i = 0; i < numSamples; i++) {
                    // Create a sample of random length and position
                    const sampleLength = this.minSampleLength + Math.random() * (this.maxSampleLength - this.minSampleLength);
                    const maxStart = Math.max(0, duration - sampleLength);
                    const startTime = Math.random() * maxStart;
                    
                    // Create a new buffer source for this sample
                    const player = new Tone.Player({
                        url: puck.url,
                        loop: false,
                        fadeIn: 0.01,
                        fadeOut: 0.05,
                        volume: 0,
                        onload: () => {
                            console.log(`Sample ${i+1} from ${puck.filename} loaded successfully`);
                        },
                        onerror: (err) => {
                            console.error(`Error loading sample ${i+1} from ${puck.filename}:`, err);
                        }
                    }).connect(this.compressor);
                    
                    // Configure player and add to sequence
                    player.puckRef = puck; // Keep reference to original puck
                    player.startOffset = startTime;
                    player.endOffset = startTime + sampleLength;
                    player.reverse = puck.reverseActive; // Match puck's reverse setting
                    
                    // Store the player
                    this.players.push(player);
                    
                    // Add this player to the sequence
                    this.currentSequence.push({
                        player,
                        puck,
                        startTime,
                        duration: sampleLength
                    });
                    
                    // Add a promise that resolves when this player loads
                    sequencePromises.push(new Promise(resolve => {
                        player.onstop = resolve;
                        // Safety timeout in case onstop doesn't fire
                        setTimeout(resolve, 5000);
                    }));
                }
            });
        });
        
        // Randomize the sequence
        this.shuffleSequence();
        
        console.log(`Created sequence with ${this.currentSequence.length} samples`);
        
        // Return a promise that resolves when all players are ready
        return Promise.allSettled(sequencePromises).then(() => {
            console.log("All sample players initialized");
        });
    }
    
    /**
     * Shuffles the current sequence for random playback
     */
    shuffleSequence() {
        // Fisher-Yates shuffle
        for (let i = this.currentSequence.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.currentSequence[i], this.currentSequence[j]] = 
            [this.currentSequence[j], this.currentSequence[i]];
        }
    }
    
    /**
     * Starts the sequencer to play samples in sequence
     */
    startSequencer() {
        if (this.currentSequence.length === 0) {
            console.warn("Cannot start sequencer: no samples in sequence");
            return;
        }
        
        // Reset index
        this.currentIndex = 0;
        this.nextPlaybackTime = Tone.now();
        
        // Initial play
        this.playNextSample();
    }
    
    /**
     * Plays the next sample in the sequence
     */
    playNextSample() {
        if (!this.isActive || this.currentSequence.length === 0) {
            this.stop();
            return;
        }
        
        const currentSample = this.currentSequence[this.currentIndex];
        const player = currentSample.player;
        
        // Make sure the player is ready
        if (player && player.loaded) {
            try {
                console.log(`Playing sample ${this.currentIndex + 1}/${this.currentSequence.length} from ${currentSample.puck.filename} at ${currentSample.startTime.toFixed(2)}s, duration ${currentSample.duration.toFixed(2)}s`);
                
                // Set the start offset and duration
                const startTime = currentSample.startTime;
                const duration = currentSample.duration;
                
                // Actually play the sample
                player.start(this.nextPlaybackTime, startTime, duration);
                
                // Calculate the time for the next sample
                this.nextPlaybackTime += duration + 0.05; // small gap between samples
                
                // Schedule the next sample
                const eventId = Tone.Transport.schedule(() => {
                    // Move to the next sample
                    this.currentIndex = (this.currentIndex + 1) % this.currentSequence.length;
                    this.playNextSample();
                }, Tone.now() + duration + 0.05); // Schedule relative to now
                
                // Store the event ID for cleanup
                this.scheduledEvents.push(eventId);
                
            } catch (error) {
                console.warn("Error playing sample:", error);
                // Skip to next sample on error
                this.currentIndex = (this.currentIndex + 1) % this.currentSequence.length;
                this.playNextSample();
            }
        } else {
            console.log("Player not loaded yet, waiting...");
            // If player not loaded, wait for it or skip after timeout
            setTimeout(() => {
                if (player && player.loaded) {
                    this.playNextSample();
                } else {
                    console.warn(`Skipping unloaded sample ${this.currentIndex + 1}`);
                    this.currentIndex = (this.currentIndex + 1) % this.currentSequence.length;
                    this.playNextSample();
                }
            }, 500);
        }
    }
    
    /**
     * Stops the autosampler and cleans up resources
     */
    stop() {
        console.log("Stopping autosampler");
        
        // Cancel all scheduled events
        this.scheduledEvents.forEach(id => {
            Tone.Transport.clear(id);
        });
        this.scheduledEvents = [];
        
        // Stop all players
        this.players.forEach(player => {
            try {
                if (player.state === "started") {
                    player.stop();
                }
            } catch (error) {
                console.warn("Error stopping player:", error);
            }
        });
        
        // Clean up
        this.isActive = false;
        this.targetPuckGroups = [];
        this.nextPlaybackTime = null;
        
        // Dispose players to free up resources
        this.disposePlayers();
    }
    
    /**
     * Disposes of all player instances to free up resources
     */
    disposePlayers() {
        if (this.players && this.players.length > 0) {
            this.players.forEach(player => {
                try {
                    player.stop();
                    player.disconnect();
                    player.dispose();
                } catch (error) {
                    console.warn("Error disposing player:", error);
                }
            });
        }
        this.players = [];
        this.currentSequence = [];
    }
    
    /**
     * Toggles autosampling for the provided pucks
     * @param {Array} pucks - Array of pucks to autosample
     * @returns {boolean} - New active state
     */
    toggle(pucks) {
        if (this.isActive) {
            this.stop();
            return false;
        } else {
            this.start(pucks);
            return true;
        }
    }
    
    /**
     * Checks if autosampling is active
     * @returns {boolean}
     */
    isAutosampling() {
        return this.isActive;
    }
}

// Create a global instance of the AutoSampler
const autoSampler = new AutoSampler(); 