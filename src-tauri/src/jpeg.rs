pub(crate) fn encode_jpeg_moz(rgb: &image::RgbImage, quality: u8) -> Result<Vec<u8>, String> {
    let (width, height) = (rgb.width() as usize, rgb.height() as usize);
    let pixels = rgb.as_raw();

    let mut comp = mozjpeg::Compress::new(mozjpeg::ColorSpace::JCS_RGB);
    comp.set_size(width, height);
    comp.set_quality(quality as f32);
    // Deliberate speed/size trade-off: optimized Huffman coding shrinks output
    // ~5-10% but costs a second encode pass. This app processes large batches
    // where throughput matters more than the last few percent of file size.
    comp.set_optimize_coding(false);

    let mut started = comp.start_compress(Vec::new()).map_err(|e| e.to_string())?;
    started.write_scanlines(pixels).map_err(|e| e.to_string())?;
    started.finish().map_err(|e| e.to_string())
}

/// The smallest k (1..=8) such that scaling by k/8 leaves the longer side at least `want` pixels.
/// `want` 0 means full size. Never upscales: a photo smaller than `want` stays at 8/8.
pub(crate) fn scale_numerator(long_side: u32, want: u32) -> u8 {
    if want == 0 || long_side <= want {
        return 8;
    }
    (1..=8u8)
        .find(|k| (long_side as u64 * *k as u64).div_ceil(8) >= want as u64)
        .unwrap_or(8)
}

/// Decode at reduced size. JPEG can be decoded straight to 1/8–8/8 of its size, which is far cheaper than
/// decoding everything and shrinking afterwards. Other formats are decoded in full.
/// The result's longer side is at least `want` (or the photo's own size when that is smaller).
pub(crate) fn decode_image_scaled(bytes: &[u8], want: u32) -> Result<image::DynamicImage, String> {
    if bytes.starts_with(&[0xFF, 0xD8]) {
        let mut decomp = mozjpeg::Decompress::new_mem(bytes).map_err(|e| e.to_string())?;
        let (w, h) = (decomp.width() as u32, decomp.height() as u32);
        let k = scale_numerator(w.max(h), want);
        if k < 8 {
            decomp.scale(k);
        }
        let mut started = decomp.rgb().map_err(|e| e.to_string())?;
        let (width, height) = (started.width() as u32, started.height() as u32);
        let pixels = started.read_scanlines::<u8>().map_err(|e| e.to_string())?;
        image::RgbImage::from_raw(width, height, pixels)
            .map(image::DynamicImage::ImageRgb8)
            .ok_or_else(|| "Dimensjonijiet JPEG ħżiena".to_string())
    } else {
        image::load_from_memory(bytes).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod scale_tests {
    use super::*;

    #[test]
    fn picks_the_smallest_scale_that_keeps_enough_pixels() {
        assert_eq!(scale_numerator(6000, 0), 8);
        assert_eq!(scale_numerator(6000, 2048), 3); // 3/8 of 6000 = 2250 ≥ 2048, 2/8 = 1500 is not
        assert_eq!(scale_numerator(1500, 2048), 8); // never upscale
        assert_eq!(scale_numerator(6000, 256), 1); // 750 ≥ 256
    }

    #[test]
    fn scaled_decode_is_smaller_but_not_too_small() {
        let img = image::RgbImage::from_fn(1600, 1200, |x, y| image::Rgb([(x % 251) as u8, (y % 241) as u8, 90]));
        let bytes = encode_jpeg_moz(&img, 90).unwrap();
        let full = decode_image_scaled(&bytes, 0).unwrap();
        assert_eq!((full.width(), full.height()), (1600, 1200));
        let small = decode_image_scaled(&bytes, 500).unwrap();
        assert!(small.width().max(small.height()) >= 500 && small.width() < 1600, "{}x{}", small.width(), small.height());
        let eighth = decode_image_scaled(&bytes, 10).unwrap();
        assert_eq!((eighth.width(), eighth.height()), (200, 150));
    }
}
