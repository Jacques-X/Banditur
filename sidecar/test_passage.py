import pathlib
import tempfile
import unittest
import wave
from transcribe import slice_audio

class PassageAudioTests(unittest.TestCase):
    def test_only_selected_pcm_is_sent_to_inference(self):
        with tempfile.TemporaryDirectory() as folder:
            path = str(pathlib.Path(folder) / 'audio.wav')
            with wave.open(path, 'wb') as f:
                f.setnchannels(1)
                f.setsampwidth(2)
                f.setframerate(16000)
                f.writeframes(bytes(2 * 16000 * 4))
            slice_audio(path, 1, 2.5)
            with wave.open(path, 'rb') as f:
                self.assertEqual(f.getnframes(), 24000)
                self.assertEqual(f.getframerate(), 16000)
    def test_invalid_selection_preserves_the_source(self):
        with self.assertRaises(ValueError):
            slice_audio('must-not-be-opened.wav', 2, 1)

if __name__ == '__main__':
    unittest.main()
