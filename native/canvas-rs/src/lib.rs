use napi::{bindgen_prelude::Buffer, Error, Result, Status};
use skia_safe::{
    AlphaType, Canvas, Color, ColorType, EncodedImageFormat, Font, FontMgr, FontStyle,
    ImageInfo, Paint, Point, Rect, Shader, Surface, TileMode,
};
use skia_safe::surfaces;

#[napi(object)]
pub struct Section {
    pub title: Option<String>,
    pub lines: Option<Vec<String>>,
}

#[napi(object)]
pub struct CardOptions {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub theme: Option<String>,
    pub title: Option<String>,
    pub subtitle: Option<String>,
    pub chip: Option<String>,
    pub brand: Option<String>,
    pub sections: Option<Vec<Section>>,
    pub footer: Option<String>,
}

#[napi(object)]
pub struct RenderResult {
    pub buffer: Buffer,
    pub width: u32,
    pub height: u32,
    pub format: String,
    pub size: u64,
}

const THEMES: &[(&str, &str, &str, &str, &str)] = &[
    ("brand", "#0b0e14", "#131a26", "#00d9ff", "#eef2f8"),
    ("success", "#08130d", "#0e2015", "#22c55e", "#eafff2"),
    ("error", "#160a0c", "#231016", "#f43f5e", "#fff0f3"),
    ("warn", "#161206", "#221a0c", "#f59e0b", "#fff8ea"),
    ("music", "#0a0f1e", "#101a33", "#00d9ff", "#eaf2ff"),
    ("ai", "#0d0a18", "#18112b", "#a78bfa", "#f3efff"),
];

fn parse_hex(s: &str) -> Color {
    let s = s.trim_start_matches(#);
    let v = u32::from_str_radix(s, 16).unwrap_or(0x0b0e14);
    Color::from_argb(255, ((v >> 16) & 0xff) as u8, ((v >> 8) & 0xff) as u8, (v & 0xff) as u8)
}

fn theme_colors(theme: &str) -> (Color, Color, Color, Color) {
    for (name, bg, bg2, accent, text) in THEMES.iter() {
        if *name == theme {
            return (parse_hex(bg), parse_hex(bg2), parse_hex(accent), parse_hex(text));
        }
    }
    (parse_hex("#0b0e14"), parse_hex("#131a26"), parse_hex("#00d9ff"), parse_hex("#eef2f8"))
}

fn load_font(size: f32, bold: bool) -> Option<Font> {
    let mgr = FontMgr::new();
    let candidates = if bold {
        ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "C:\\\\Windows\\\\Fonts\\\\arialbd.ttf"]
    } else {
        ["/System/Library/Fonts/Supplemental/Arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "C:\\\\Windows\\\\Fonts\\\\arial.ttf"]
    };
    for path in candidates.iter() {
        if let Some(tf) = mgr.new_from_file(path) {
            return Some(Font::new(tf, size));
        }
    }
    mgr.load_family_name("Arial", None).map(|tf| Font::new(tf, size))
}

fn measure_text(font: &Font, text: &str) -> f32 {
    font.measure_text(text, None).unwrap_or(0.0)
}

#[napi]
pub fn render_card(options: CardOptions) -> Result<RenderResult> {
    let width = options.width.unwrap_or(1000);
    let height = options.height.unwrap_or(800);
    let theme = options.theme.as_deref().unwrap_or("brand");
    let (bg, bg2, accent, text) = theme_colors(theme);
    let brand = options.brand.as_deref().unwrap_or("JOHN TRAN");
    let padding = 56.0;

    let mut info = ImageInfo::new((width, height), ColorType::RGBA8888, AlphaType::Premultiplied, None);
    let surface = surfaces::raster(&info).ok_or_else(|| Error::new(Status::GenericFailure, "failed to create surface"))?;
    let canvas = surface.canvas();
    canvas.clear(Color::WHITE);

    let shader = Shader::new_linear_gradient(
        (Point::from((0.0, 0.0)), Point::from((0.0, height as f32))),
        &[bg, bg2],
        None,
        TileMode::Clamp,
        None,
    ).ok_or_else(|| Error::new(Status::GenericFailure, "failed to create gradient shader"))?;
    let mut paint = Paint::default();
    paint.set_shader(shader);
    paint.set_anti_alias(true);
    canvas.draw_rect(Rect::from_wh(width as f32, height as f32), &paint);

    paint.set_color(Color::from_argb(60, 255, 255, 255));
    paint.set_style(skia_safe::PaintStyle::Stroke);
    paint.set_stroke_width(2.0);
    canvas.draw_rect(Rect::from_wh(width as f32, height as f32), &paint);

    let mut y = 84.0;
    let title_font = load_font(52.0, true).ok_or_else(|| Error::new(Status::GenericFailure, "failed to load title font"))?;
    let body_font = load_font(26.0, false).ok_or_else(|| Error::new(Status::GenericFailure, "failed to load body font"))?;

    paint.set_color(accent);
    paint.set_style(skia_safe::PaintStyle::Fill);
    let chip_text = options.chip.as_deref().unwrap_or("JOHN TRAN");
    let chip_label = format!("{} • {}", chip_text, brand);
    let chip_w = measure_text(&title_font, chip_label) + 48.0;
    canvas.draw_str(&chip_label, Point::from((padding, y - 14.0)), &title_font, &paint);
    y += 62.0;

    if let Some(title) = options.title.as_deref().filter(|s| !s.is_empty()) {
        paint.set_color(text);
        for line in title.lines() {
            canvas.draw_str(line, Point::from((padding, y + 12.0)), &title_font, &paint);
            y += 62.0;
        }
    }

    if let Some(subtitle) = options.subtitle.as_deref().filter(|s| !s.is_empty()) {
        paint.set_color(Color::from_argb(200, 255, 255, 255));
        for line in subtitle.lines() {
            canvas.draw_str(line, Point::from((padding, y + 6.0)), &body_font, &paint);
            y += 36.0;
        }
    }

    if let Some(sections) = options.sections.as_deref() {
        for section in sections {
            y += 18.0;
            if let Some(title) = section.title.as_deref().filter(|s| !s.is_empty()) {
                paint.set_color(accent);
                canvas.draw_str(title, Point::from((padding, y)), &title_font, &paint);
                y += 42.0;
            }
            paint.set_color(text);
            for line in section.lines.as_deref().unwrap_or(&[]).iter().filter_map(|s| s.as_str()) {
                for wrapped in wrap_text(&body_font, line, width as f32 - padding * 2.0 - 30.0) {
                    canvas.draw_str(wrapped, Point::from((padding + 30.0, y)), &body_font, &paint);
                    y += 34.0;
                }
            }
            y += 10.0;
        }
    }

    if let Some(footer) = options.footer.as_deref().filter(|s| !s.is_empty()) {
        paint.set_color(Color::from_argb(180, 255, 255, 255));
        let mut fy = height as f32 - 48.0;
        for line in footer.lines().rev() {
            canvas.draw_str(line, Point::from((padding, fy)), &body_font, &paint);
            fy -= 28.0;
        }
    }

    let image = surface.image_snapshot();
    let data = image.encode(None, EncodedImageFormat::PNG, 100)
        .ok_or_else(|| Error::new(Status::GenericFailure, "failed to encode PNG"))?;
    let bytes = data.as_bytes().to_vec();

    Ok(RenderResult {
        buffer: Buffer::from(bytes),
        format: "png".to_string(),
        width,
        height,
        size: bytes.len() as u64,
    })
}

fn wrap_text(font: &Font, text: &str, max_width: f32) -> Vec<String> {
    let mut lines = Vec::new();
    for para in text.split(n) {
        let words: Vec<&str> = para.split_whitespace().collect();
        if words.is_empty() {
            lines.push(String::new());
            continue;
        }
        let mut current = String::new();
        for word in words {
            let test = if current.is_empty() { word.to_string() } else { format!("{} {}", current, word) };
            if measure_text(font, &test) > max_width && !current.is_empty() {
                lines.push(current);
                current = word.to_string();
            } else {
                current = test;
            }
        }
        if !current.is_empty() {
            lines.push(current);
        }
    }
    lines
}
