from fastapi import FastAPI, HTTPException, Form, UploadFile
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
import json
import os
import tempfile
from audiocraft.models import JASCO
from audiocraft.data.audio import audio_write
import torchaudio
import ffmpeg

# Initialize FastAPI app
app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize models
jasco_chords_drums = JASCO.get_pretrained('facebook/jasco-chords-drums-400M', 
                            chords_mapping_path='assets/chord_to_index_mapping.pkl')

# Set default prompt, chords, drums
DEFAULT_PROMPT = "Strings, woodwind, orchestral, symphony."
DEFAULT_CHORDS = [('Am7', 0.0), ('D7', 5.0), ('G', 8.0)]
DEFAULT_DRUMS_WAV, DEFAULT_DRUMS_SR = torchaudio.load("./assets/sample_0.wav")

# Set generation parameters
jasco_chords_drums.set_generation_params(
    cfg_coef_all=5.0,
    cfg_coef_txt=0.0
)

# Counter for output files
file_counter = 1

@app.post('/generate')
async def generate(
    prompt: str = Form(...),
    chords: Optional[str] = Form(None),
    drums: Optional[UploadFile] = Form(None)
):
    try:
        global file_counter
        
        # Create output directory if it doesn't exist
        os.makedirs("output", exist_ok=True)
        
        # Process chords
        if chords:
            try:
                chord_list = json.loads(chords)
                # Validate chord times don't exceed 10.0
                if any(float(time) > 10.0 for _, time in chord_list):
                    raise HTTPException(
                        status_code=400, 
                        detail="Chord times cannot exceed 10.0 seconds"
                    )
                chord_progression = [(str(chord), float(time)) for chord, time in chord_list]
            except json.JSONDecodeError:
                print("Invalid chord format provided, using default chords")
                chord_progression = DEFAULT_CHORDS
        else:
            print("No chords provided, using default chords")
            chord_progression = DEFAULT_CHORDS

        # Process drums from mic input
        if drums and drums.filename:
            print("1")
            try:
                # Save uploaded file to a temp file (original format)
                with tempfile.NamedTemporaryFile(suffix=os.path.splitext(drums.filename)[1], delete=False) as temp_audio:
                    content = await drums.read()
                    temp_audio.write(content)
                    temp_audio.flush()
                    temp_audio_path = temp_audio.name
                    print("2")

                # Convert to WAV using ffmpeg
                temp_wav = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
                temp_wav.close()
                temp_wav_path = temp_wav.name

                try:
                    (
                        ffmpeg
                        .input(temp_audio_path)
                        .output(temp_wav_path, format='wav', acodec='pcm_s16le', ac=1)
                        .run(quiet=True, overwrite_output=True)
                    )
                except ffmpeg.Error as e:
                    print("ffmpeg error:", e)
                    raise HTTPException(status_code=500, detail="Audio conversion failed")

                # Load and process the WAV file
                drums_wav, drums_sr = torchaudio.load(temp_wav_path, format="wav")
                print("3")

                # Verify audio format requirements
                if drums_wav.shape[0] != 1:
                    print("4")    
                    # Convert to mono if necessary
                    drums_wav = drums_wav.mean(dim=0, keepdim=True)
                    print("5")

                if drums_sr != jasco_chords_drums.sample_rate:
                    # Resample to match model's sample rate
                    resampler = torchaudio.transforms.Resample(drums_sr, jasco_chords_drums.sample_rate)
                    drums_wav = resampler(drums_wav)
                    print("6") 

                # Clean up temp files
                os.unlink(temp_audio_path)
                os.unlink(temp_wav_path)
                print("7")

            except Exception as e:
                print(f"Error processing drum audio: {str(e)}")
                raise HTTPException(status_code=500, detail=str(e))
        else:
            print("No custom drums provided, using only prompt and default chords")
            # drums_wav, drums_sr = DEFAULT_DRUMS_WAV, DEFAULT_DRUMS_SR

        # Find next available file number
        while os.path.exists(f"output/{file_counter}.wav"):
            file_counter = (file_counter % 999) + 1

        # Path to output
        output_path = f"output/{file_counter}"
        output_file = f"output/{file_counter}.wav"

        # Generate music using the custom drums
        if drums and drums.filename:
            output = jasco_chords_drums.generate_music(
                descriptions=[prompt or DEFAULT_PROMPT],
                chords=chord_progression,
                drums_wav=drums_wav,
                drums_sample_rate=jasco_chords_drums.sample_rate,
                progress=True
            )
        else:
            # Generate music without using custom drums
            output = jasco_chords_drums.generate_music(
                descriptions=[prompt or DEFAULT_PROMPT],
                chords=chord_progression,
                progress=True
            )

        # Save the generated audio
        audio_write(
            output_path, 
            output[0].cpu(), 
            jasco_chords_drums.sample_rate,
            strategy="loudness",
            loudness_compressor=True
        )

        # Increment counter for next generation
        file_counter = (file_counter % 999) + 1

        return FileResponse(
            output_file,
            media_type="audio/wav",
            headers={"X-File-Path": output_path}
        )

    except Exception as e:
        print(f"Error generating music: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)