# Deluloop
An improvisational looper, powered by [JASCO](https://github.com/facebookresearch/audiocraft/blob/main/docs/JASCO.md).

## Usage
- Request access to [JASCO Chords Drums](https://huggingface.co/facebook/jasco-chords-drums-400M) on Hugging Face.
- Add Hugging Face API key as an environment variable named HF_KEY
- Install requirements with ``pip install -r requirements.txt``
- Run server with ``python app.py``
- Run client with ``index.html``

## License
The license for JASCO weights can be found [here](https://github.com/facebookresearch/audiocraft/blob/896ec7c47f5e5d1e5aa1e4b260c4405328bf009d/LICENSE_weights).