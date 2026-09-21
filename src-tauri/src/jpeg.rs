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

pub(crate) fn decode_image_moz(bytes: &[u8]) -> Result<image::DynamicImage, String> {
    if bytes.starts_with(&[0xFF, 0xD8]) {
        // Fast path for JPEG via mozjpeg. NOTE: `.rgb()` assumes a YCbCr/RGB
        // source; rare CMYK/YCCK JPEGs (typically Photoshop exports, not camera
        // output) can fail or mis-decode here. If those ever need supporting,
        // fall back to `image::load_from_memory` on a decode error.
        let decomp = mozjpeg::Decompress::new_mem(bytes).map_err(|e| e.to_string())?;
        let mut started = decomp.rgb().map_err(|e| e.to_string())?;
        let width = started.width() as u32;
        let height = started.height() as u32;
        let pixels = started.read_scanlines::<u8>().map_err(|e| e.to_string())?;
        image::RgbImage::from_raw(width, height, pixels)
            .map(image::DynamicImage::ImageRgb8)
            .ok_or_else(|| "Dimensjonijiet JPEG ħżiena".to_string())
    } else {
        image::load_from_memory(bytes).map_err(|e| e.to_string())
    }
}
