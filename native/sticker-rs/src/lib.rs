use napi::{bindgen_prelude::Buffer, Error, Result, Status};
use image::io::Reader as ImageReader;
use image::{DynamicImage, GenericImageView, FilterType};
use std::io::Cursor;
use webp::encoder::{WebPEncoder, WebPConfig};

#[napi(object)]
pub struct EncodeOptions {
  pub buffer: Buffer,
  pub width: Option<u32>,
  pub height: Option<u32>,
  pub quality: Option<u8>,
  pub lossless: Option<bool>,
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
    .map_err(|e| Error::new(Status::InvalidArg, format!("decode failed: {}", e)))?
    .decode()
    .map_err(|e| Error::new(Status::InvalidArg, format!("decode failed: {}", e)))
}

fn fit_size(w: u32, h: u32, max_w: u32, max_h: u32) -> (u32, u32) {
  if w <= max_w && h <= max_h {
    return (w, h);
  }
  let scale = (max_w as f64 / w as f64).min(max_h as f64 / h as f64);
  let nw = (w as f64 * scale).max(1.0) as u32;
  let nh = (h as f64 * scale).max(1.0) as u32;
  (nw, nh)
}

#[napi]
pub fn encode_webp(options: EncodeOptions) -> Result<EncodeResult> {
  let img = load_image(&options.buffer)?;
  let (iw, ih) = img.dimensions();
  let max_w = options.width.unwrap_or(iw);
  let max_h = options.height.unwrap_or(ih);
  let (nw, nh) = fit_size(iw, ih, max_w, max_h);
  let img = if (nw, nh) != (iw, ih) {
    img.resize(nw, nh, FilterType::Lanczos3)
  } else {
    img
  };
  let (w, h) = img.dimensions();
  let rgba = img.to_rgba8();
  let mut config = WebPConfig::new();
  config.set_quality(options.quality.unwrap_or(75) as f32);
  if options.lossless.unwrap_or(false) {
    config.set_lossless(true);
  }
  let encoder = WebPEncoder::from_config(&config);
  let encoded = encoder
    .encode(&rgba)
    .map_err(|e| Error::new(Status::GenericFailure, format!("webp encode failed: {}", e)))?;
  Ok(EncodeResult {
    buffer: Buffer::from(encoded),
    format: "webp".to_string(),
    width: w,
    height: h,
    size: encoded.len() as u64,
  })
}

#[napi]
pub fn encode_gif(options: EncodeOptions) -> Result<EncodeResult> {
  use image::codecs::gif::GifEncoder;
  let img = load_image(&options.buffer)?;
  let (iw, ih) = img.dimensions();
  let max_w = options.width.unwrap_or(iw);
  let max_h = options.height.unwrap_or(ih);
  let (nw, nh) = fit_size(iw, ih, max_w, max_h);
  let img = if (nw, nh) != (iw, ih) {
    img.resize(nw, nh, FilterType::Lanczos3)
  } else {
    img
  };
  let (w, h) = img.dimensions();
  let mut buf: Vec<u8> = Vec::new();
  let mut encoder = GifEncoder::new(&mut buf);
  encoder
    .write_image(&img, &image::codecs::gif::GifEncoderOptions::new())
    .map_err(|e| Error::new(Status::GenericFailure, format!("gif encode failed: {}", e)))?;
  Ok(EncodeResult {
    buffer: Buffer::from(buf),
    format: "gif".to_string(),
    width: w,
    height: h,
    size: buf.len() as u64,
  })
}

#[napi]
pub fn encode_sticker(options: EncodeOptions) -> Result<EncodeResult> {
  let mut opts = options;
  opts.lossless = Some(false);
  opts.quality = Some(options.quality.unwrap_or(65));
  encode_webp(opts)
}
