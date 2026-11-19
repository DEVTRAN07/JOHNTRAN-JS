use napi::bindgen_prelude::{AsyncTask, Buffer, Env, Task};
use napi::{Error, Result, Status};
use napi_derive::napi;
use image::imageops::{self, FilterType};
use image::io::Reader as ImageReader;
use image::{DynamicImage, GenericImageView, ImageFormat, RgbaImage};
use std::io::{Cursor, Seek, Write};

#[napi(object)]
pub struct EncodeOptions {
    pub buffer: Buffer,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub quality: Option<u8>,
    pub lossless: Option<bool>,
}

#[napi(object)]
pub struct ComposeOptions {
    pub source: Buffer,
    pub overlay: Buffer,
    pub size: Option<u32>,
    pub avatar_size: Option<u32>,
    pub offset: Option<u32>,
    pub quality: Option<u8>,
}

#[napi(object)]
pub struct EncodeResult {
    pub buffer: Buffer,
    pub format: String,
    pub width: u32,
    pub height: u32,
    pub size: u64,
}

fn load_image(buf: &[u8]) -> Result<DynamicImage> {
    ImageReader::new(Cursor::new(buf))
        .with_guessed_format()
        .map_err(|e| Error::new(Status::InvalidArg, format!("image format detection failed: {e}")))?
        .decode()
        .map_err(|e| Error::new(Status::InvalidArg, format!("image decode failed: {e}")))
}

fn fit_size(width: u32, height: u32, max_width: u32, max_height: u32) -> (u32, u32) {
    if width <= max_width && height <= max_height {
        return (width.max(1), height.max(1));
    }
    let scale = (max_width as f64 / width.max(1) as f64)
        .min(max_height as f64 / height.max(1) as f64);
    (
        ((width as f64 * scale).round() as u32).max(1),
        ((height as f64 * scale).round() as u32).max(1),
    )
}

fn encode_webp_bytes(image: &RgbaImage, quality: u8, lossless: bool) -> Vec<u8> {
    let (width, height) = image.dimensions();
    let encoder = webp::Encoder::from_rgba(image.as_raw(), width, height);
    if lossless {
        encoder.encode_lossless().to_vec()
    } else {
        encoder.encode(quality.clamp(1, 100) as f32).to_vec()
    }
}

fn render_static_composition(
    source: &DynamicImage,
    overlay: &DynamicImage,
    size: u32,
    avatar_size: u32,
    requested_offset: u32,
) -> RgbaImage {
    let size = size.clamp(64, 512);
    let avatar_size = avatar_size.clamp(16, size);
    let max_offset = size.saturating_sub(avatar_size);
    let offset = requested_offset.min(max_offset);

    // Crop the user image to a square, then apply a one-pixel antialiased
    // circular alpha boundary. This mirrors the previous Canvas fast path.
    let avatar = imageops::resize_to_fill(
        &source.to_rgba8(),
        avatar_size,
        avatar_size,
        FilterType::Lanczos3,
    );
    let mut output = RgbaImage::new(size, size);
    let center = avatar_size as f32 / 2.0;
    let radius = center;

    for y in 0..avatar_size {
        for x in 0..avatar_size {
            let dx = x as f32 + 0.5 - center;
            let dy = y as f32 + 0.5 - center;
            let distance = (dx * dx + dy * dy).sqrt();
            let edge_alpha = (radius + 0.5 - distance).clamp(0.0, 1.0);
            if edge_alpha <= 0.0 {
                continue;
            }

            let mut pixel = *avatar.get_pixel(x, y);
            pixel[3] = (pixel[3] as f32 * edge_alpha).round() as u8;
            output.put_pixel(offset + x, offset + y, pixel);
        }
    }

    // Preserve the decoration's complete aspect ratio and transparent padding.
    let (overlay_width, overlay_height) = overlay.dimensions();
    let scale = (size as f64 / overlay_width.max(1) as f64)
        .min(size as f64 / overlay_height.max(1) as f64);
    let fitted_width = ((overlay_width as f64 * scale).round() as u32).clamp(1, size);
    let fitted_height = ((overlay_height as f64 * scale).round() as u32).clamp(1, size);
    let fitted_overlay = imageops::resize(
        &overlay.to_rgba8(),
        fitted_width,
        fitted_height,
        FilterType::Lanczos3,
    );
    let x = ((size - fitted_width) / 2) as i64;
    let y = ((size - fitted_height) / 2) as i64;
    imageops::overlay(&mut output, &fitted_overlay, x, y);
    output
}

fn compose_static_result(
    source_bytes: &[u8],
    overlay_bytes: &[u8],
    size: u32,
    avatar_size: u32,
    offset: u32,
    quality: u8,
) -> Result<EncodeResult> {
    let source = load_image(source_bytes)?;
    let overlay = load_image(overlay_bytes)?;
    let size = size.clamp(64, 512);
    let image = render_static_composition(&source, &overlay, size, avatar_size, offset);
    let encoded = encode_webp_bytes(&image, quality, false);
    let encoded_size = encoded.len() as u64;

    Ok(EncodeResult {
        buffer: Buffer::from(encoded),
        format: "webp".to_string(),
        width: size,
        height: size,
        size: encoded_size,
    })
}

#[napi]
pub fn encode_webp(options: EncodeOptions) -> Result<EncodeResult> {
    let image = load_image(&options.buffer)?;
    let (input_width, input_height) = image.dimensions();
    let max_width = options.width.unwrap_or(input_width).clamp(1, 4096);
    let max_height = options.height.unwrap_or(input_height).clamp(1, 4096);
    let (width, height) = fit_size(input_width, input_height, max_width, max_height);
    let resized = if (width, height) != (input_width, input_height) {
        image.resize(width, height, FilterType::Lanczos3)
    } else {
        image
    };
    let rgba = resized.to_rgba8();
    let encoded = encode_webp_bytes(
        &rgba,
        options.quality.unwrap_or(75),
        options.lossless.unwrap_or(false),
    );
    let size = encoded.len() as u64;

    Ok(EncodeResult {
        buffer: Buffer::from(encoded),
        format: "webp".to_string(),
        width,
        height,
        size,
    })
}

#[napi]
pub fn encode_sticker(options: EncodeOptions) -> Result<EncodeResult> {
    let mut options = options;
    options.lossless = Some(false);
    options.quality = Some(options.quality.unwrap_or(65).min(80));
    encode_webp(options)
}

#[napi]
pub fn encode_gif(options: EncodeOptions) -> Result<EncodeResult> {
    let image = load_image(&options.buffer)?;
    let (input_width, input_height) = image.dimensions();
    let max_width = options.width.unwrap_or(input_width).clamp(1, 4096);
    let max_height = options.height.unwrap_or(input_height).clamp(1, 4096);
    let (width, height) = fit_size(input_width, input_height, max_width, max_height);
    let resized = if (width, height) != (input_width, input_height) {
        image.resize(width, height, FilterType::Lanczos3)
    } else {
        image
    };

    let mut cursor = Cursor::new(Vec::new());
    resized
        .write_to(&mut cursor, ImageFormat::Gif)
        .map_err(|e| Error::new(Status::GenericFailure, format!("GIF encode failed: {e}")))?;
    let encoded = cursor.into_inner();
    let size = encoded.len() as u64;

    Ok(EncodeResult {
        buffer: Buffer::from(encoded),
        format: "gif".to_string(),
        width,
        height,
        size,
    })
}

pub struct ComposeStaticTask {
    source: Vec<u8>,
    overlay: Vec<u8>,
    size: u32,
    avatar_size: u32,
    offset: u32,
    quality: u8,
}

#[napi]
impl Task for ComposeStaticTask {
    type Output = EncodeResult;
    type JsValue = EncodeResult;

    fn compute(&mut self) -> Result<Self::Output> {
        compose_static_result(
            &self.source,
            &self.overlay,
            self.size,
            self.avatar_size,
            self.offset,
            self.quality,
        )
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Compose a static avatar + static Discord decoration off the Node.js event
/// loop, then return an optimized WebP buffer ready for the Zalo sticker API.
#[napi]
pub fn compose_static_sticker(options: ComposeOptions) -> AsyncTask<ComposeStaticTask> {
    AsyncTask::new(ComposeStaticTask {
        source: options.source.to_vec(),
        overlay: options.overlay.to_vec(),
        size: options.size.unwrap_or(288),
        avatar_size: options.avatar_size.unwrap_or(240),
        offset: options.offset.unwrap_or(24),
        quality: options.quality.unwrap_or(68).clamp(1, 100),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    #[test]
    fn static_composition_keeps_transparent_corners_and_center_avatar() {
        let mut avatar = RgbaImage::new(32, 32);
        for pixel in avatar.pixels_mut() {
            *pixel = Rgba([240, 30, 20, 255]);
        }

        let overlay = RgbaImage::new(32, 32);
        let result = render_static_composition(
            &DynamicImage::ImageRgba8(avatar),
            &DynamicImage::ImageRgba8(overlay),
            64,
            52,
            6,
        );

        assert_eq!(result.dimensions(), (64, 64));
        assert_eq!(result.get_pixel(0, 0)[3], 0);
        assert!(result.get_pixel(32, 32)[3] > 240);
        assert!(result.get_pixel(32, 32)[0] > 200);
    }

    #[test]
    fn compose_static_emits_a_valid_webp_signature() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_pixel(
            32, 32, Rgba([10, 200, 30, 255])
        ));
        let overlay = DynamicImage::ImageRgba8(RgbaImage::new(32, 32));
        let png = |image: &DynamicImage| {
            let mut cursor = Cursor::new(Vec::new());
            image.write_to(&mut cursor, ImageFormat::Png).unwrap();
            cursor.into_inner()
        };

        let result = compose_static_result(&png(&source), &png(&overlay), 64, 52, 6, 70)
            .expect("composition should encode");
        let bytes: Vec<u8> = result.buffer.into();
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WEBP");
        assert_eq!(result.width, 64);
        assert_eq!(result.height, 64);
    }
}
