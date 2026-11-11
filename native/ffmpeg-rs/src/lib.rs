use napi::{bindgen_prelude::Buffer, Error, Result, Status};
use ffmpeg_next as ffmpeg;

#[napi(object)]
pub struct ProbeResult {
    pub duration: f64,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub codec: Option<String>,
    pub bitrate: i64,
}

#[napi(object)]
pub struct DecodeResult {
    pub buffer: Buffer,
    pub width: i32,
    pub height: i32,
    pub format: String,
    pub size: u64,
}

#[napi(object)]
pub struct EncodeResult {
    pub output: String,
    pub size: u64,
    pub duration: f64,
}

fn init() -> Result<()> {
    ffmpeg::init().map_err(|e| Error::new(Status::GenericFailure, format!("ffmpeg init: {}", e)))
}

#[napi]
pub fn probe(input: String) -> Result<ProbeResult> {
    init()?;
    let ictx = ffmpeg::format::input(&input)
        .map_err(|e| Error::new(Status::InvalidArg, format!("open input failed: {}", e)))?;
    let video_stream = ictx.streams().best(ffmpeg::media::Type::Video);
    let (width, height, codec) = match video_stream {
        Some(s) => {
            let par = s.parameters();
            let c = match par.codec_id() {
                ffmpeg::codec::id::CodecId::None => String::new(),
                other => format!("{:?}", other),
            };
            (Some(par.width()), Some(par.height()), c)
        }
        None => (None, None, String::new()),
    };
    let duration = ictx.duration() as f64 / 1_000_000.0;
    let bitrate = ictx.bitrate();
    Ok(ProbeResult {
        duration,
        width,
        height,
        codec: if codec.is_empty() { None } else { Some(codec) },
        bitrate,
    })
}

#[napi]
pub fn decode_frame(input: String, time_seconds: Option<f64>) -> Result<DecodeResult> {
    init()?;
    let mut ictx = ffmpeg::format::input(&input)
        .map_err(|e| Error::new(Status::InvalidArg, format!("open input failed: {}", e)))?;
    let video_stream = ictx.streams().best(ffmpeg::media::Type::Video)
        .ok_or_else(|| Error::new(Status::InvalidArg, "no video stream"))?;
    let stream_index = video_stream.index();
    let mut decoder = ffmpeg::codec::context::Context::from_parameters(video_stream.parameters())?
        .decoder();
    let dst_w = decoder.width();
    let dst_h = decoder.height();
    let mut scaler = ffmpeg::software::scaling::context::Context::get(
        decoder.format(),
        dst_w,
        dst_h,
        ffmpeg::format::Pixel::RGBA,
        dst_w,
        dst_h,
        ffmpeg::software::scaling::flags::Flags::BILINEAR,
    ).ok_or_else(|| Error::new(Status::GenericFailure, "could not create scaler"))?;
    if let Some(ts) = time_seconds {
        let target = (ts * 1_000_000.0) as i64;
        ictx.seek_stream(target, stream_index, ffmpeg::format::SeekFlags::empty())
            .map_err(|e| Error::new(Status::GenericFailure, format!("seek failed: {}", e)))?;
    }
    let mut frame = ffmpeg::util::frame::Frame::empty();
    let mut rgb_frame = ffmpeg::util::frame::Frame::empty();
    rgb_frame.set_format(ffmpeg::format::Pixel::RGBA);
    rgb_frame.set_width(dst_w);
    rgb_frame.set_height(dst_h);
    rgb_frame.allocate().map_err(|e| Error::new(Status::GenericFailure, format!("allocate frame: {}", e)))?;
    for (_stream, packet) in ictx.packets() {
        decoder.send_packet(&packet).ok();
        while decoder.receive_frame(&mut frame).is_ok() {
            scaler.run(&frame, &mut rgb_frame).map_err(|e| Error::new(Status::GenericFailure, format!("scale failed: {}", e)))?;
            let plane = rgb_frame.data(0);
            let stride = rgb_frame.stride(0) as usize;
            let height = rgb_frame.height() as usize;
            let mut buf = Vec::with_capacity(stride * height);
            for row in plane.chunks(stride) {
                buf.extend_from_slice(row);
            }
            return Ok(DecodeResult {
                buffer: Buffer::from(buf),
                width: rgb_frame.width(),
                height: rgb_frame.height(),
                format: "rgba".to_string(),
                size: buf.len() as u64,
            });
        }
    }
    Err(Error::new(Status::InvalidArg, "no decodable frame found"))
}

#[napi]
pub fn encode(input: String, output: String) -> Result<EncodeResult> {
    init()?;
    let ictx = ffmpeg::format::input(&input)
        .map_err(|e| Error::new(Status::InvalidArg, format!("open input failed: {}", e)))?;
    let video_stream = ictx.streams().best(ffmpeg::media::Type::Video)
        .ok_or_else(|| Error::new(Status::InvalidArg, "no video stream"))?;
    let mut octx = ffmpeg::format::output(&output)
        .map_err(|e| Error::new(Status::GenericFailure, format!("open output failed: {}", e)))?;
    let mut encoder = ffmpeg::codec::encoder::VideoEncoder::new(ffmpeg::codec::id::CodecId::H264)
        .map_err(|e| Error::new(Status::GenericFailure, format!("create encoder: {}", e)))?;
    encoder.set_width(video_stream.parameters().width());
    encoder.set_height(video_stream.parameters().height());
    encoder.set_time_base(ffmpeg::Rational { num: 1, den: 30 });
    let mut encoder_ctx = encoder.open(None).map_err(|e| Error::new(Status::GenericFailure, format!("open encoder: {}", e)))?;
    let mut ostream = octx.add_stream(encoder_ctx);
    octx.set_metadata(ictx.metadata());
    octx.write_header().map_err(|e| Error::new(Status::GenericFailure, format!("write header: {}", e)))?;
    let mut frame = ffmpeg::util::frame::Frame::empty();
    let mut packet = ffmpeg::Packet::empty();
    for (_istream, ipacket) in ictx.packets() {
        if ipacket.stream_index() != video_stream.index() {
            continue;
        }
        encoder_ctx.send_packet(&ipacket).ok();
        while encoder_ctx.receive_packet(&mut packet).is_ok() {
            octx.write_interleaved_packet(&mut packet).ok();
        }
    }
    octx.write_trailer().ok();
    let size = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
    let duration = ictx.duration() as f64 / 1_000_000.0;
    Ok(EncodeResult { output, size, duration })
}
