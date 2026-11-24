import unittest
from transcribe import audio_args


class PassageAudioTests(unittest.TestCase):
    def test_passage_is_seeked_before_input_with_a_duration(self):
        args = audio_args('ffmpeg', 'in.mp4', 'out.wav', 1, 2.5)
        self.assertEqual(args[args.index('-ss') + 1], '1.000')
        self.assertEqual(args[args.index('-t') + 1], '1.500')
        self.assertLess(args.index('-ss'), args.index('-i'))
        self.assertGreater(args.index('-t'), args.index('-i'))
        self.assertEqual(args[-1], 'out.wav')

    def test_whole_file_has_no_seek_or_duration(self):
        args = audio_args('ffmpeg', 'in.mp4', 'out.wav')
        self.assertNotIn('-ss', args)
        self.assertNotIn('-t', args)

    def test_invalid_selection_raises(self):
        with self.assertRaises(ValueError):
            audio_args('ffmpeg', 'in.mp4', 'out.wav', 2, 1)
        with self.assertRaises(ValueError):
            audio_args('ffmpeg', 'in.mp4', 'out.wav', -1)


if __name__ == '__main__':
    unittest.main()
