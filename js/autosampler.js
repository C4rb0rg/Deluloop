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
        
        // Sample settings
        this.minSampleLength = 0.5; // Min sample length in seconds
        this.maxSampleLength = 2.0; // Max sample length in seconds
        this.sequencerInterval = null; // Tone.Transport interval ID
        
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
    start(puckGroup) {
        if (this.isActive) {
            this.stop(); // Stop any existing autosampling
        }
        
        if (!puckGroup || !puckGroup.length || puckGroup.length < 1) {
            console.log("No valid pucks to autosample");
            return;
        }
        
        console.log(`Starting autosampling for ${puckGroup.length} connected pucks`);
        
        // Find all connected groups
        this.targetPuckGroups = this.findConnectedPuckGroups(puckGroup);
        
        // Create and prepare the sequence
        this.prepareSequence();
        
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
    prepareSequence() {
        // Clear existing players and sequence
        this.disposePlayers();
        this.currentSequence = [];
        this.players = [];
        
        // Iterate through all puck groups and create samples
        this.targetPuckGroups.forEach(puckGroup => {
            puckGroup.forEach(puck => {
                // Skip pucks that aren't loaded or have errors
                if (!puck.isLoaded || puck.loadError || !puck.player || !puck.player.buffer) {
                    return;
                }
                
                // Create 2-4 samples from each puck based on its duration
                const buffer = puck.player.buffer;
                const duration = buffer.duration;
                const numSamples = Math.min(Math.floor(Math.random() * 3) + 2, Math.floor(duration / 0.5));
                
                for (let i = 0; i < numSamples; i++) {
                    // Create a sample of random length and position
                    const sampleLength = this.minSampleLength + Math.random() * (this.maxSampleLength - this.minSampleLength);
                    const maxStart = Math.max(0, duration - sampleLength);
                    const startTime = Math.random() * maxStart;
                    
                    // Create a new player for this sample
                    const player = new Tone.Player({
                        url: puck.url,
                        loop: false,
                        fadeIn: 0.01,
                        fadeOut: 0.05,
                        volume: 0,
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
                }
            });
        });
        
        // Randomize the sequence
        this.shuffleSequence();
        
        console.log(`Created sequence with ${this.currentSequence.length} samples`);
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
        
        // Create a callback function to play the next sample
        const playNextSample = () => {
            if (!this.isActive || this.currentSequence.length === 0) {
                this.stop();
                return;
            }
            
            const currentSample = this.currentSequence[this.currentIndex];
            const player = currentSample.player;
            
            // Make sure the player has loaded
            if (player.loaded) {
                try {
                    // Set the start offset and duration
                    const startTime = player.startOffset;
                    const endTime = player.endOffset;
                    
                    // Play the sample with correct timing offsets
                    player.start("+0.01", startTime, endTime - startTime);
                    
                    // Schedule the next sample
                    const nextTime = currentSample.duration + 0.05; // Small gap between samples
                    Tone.Transport.scheduleOnce(() => {
                        // Increment index with wrap-around
                        this.currentIndex = (this.currentIndex + 1) % this.currentSequence.length;
                        
                        // Schedule next sample
                        playNextSample();
                    }, `+${nextTime}`);
                    
                } catch (error) {
                    console.warn("Error playing sample:", error);
                    // Skip to next sample on error
                    this.currentIndex = (this.currentIndex + 1) % this.currentSequence.length;
                    Tone.Transport.scheduleOnce(playNextSample, "+0.1");
                }
            } else {
                // If player not loaded, wait for it or skip after timeout
                let loadAttempts = 0;
                const waitForLoad = setInterval(() => {
                    if (player.loaded) {
                        clearInterval(waitForLoad);
                        playNextSample();
                    } else if (loadAttempts > 10) {
                        clearInterval(waitForLoad);
                        this.currentIndex = (this.currentIndex + 1) % this.currentSequence.length;
                        playNextSample();
                    }
                    loadAttempts++;
                }, 100);
            }
        };
        
        // Start the sequencer immediately
        playNextSample();
    }
    
    /**
     * Stops the autosampler and cleans up resources
     */
    stop() {
        console.log("Stopping autosampler");
        
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