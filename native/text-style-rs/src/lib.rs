use napi::{Error, Result, Status};
use std::sync::atomic::{AtomicU64, Ordering};

#[napi(object)]
pub struct ColorStyle {
    pub start: u32,
    pub len: u32,
    pub st: String,
}

#[napi(object)]
pub struct ExcludedRange {
    pub start: u32,
    pub end: u32,
}

static RNG_STATE: AtomicU64 = AtomicU64::new(0x9e37_79b9_7f4a_7c15);

fn next_random(limit: usize) -> usize {
    if limit <= 1 { return 0; }
    let seed = RNG_STATE.fetch_add(0x9e37_79b9_7f4a_7c15, Ordering::Relaxed);
    let mut value = seed;
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^= value >> 31;
    (value as usize) % limit
}

fn push_span(
    output: &mut Vec<ColorStyle>,
    start: usize,
    end: usize,
    colors: &[String],
    excluded: &[ExcludedRange],
    previous_color: &mut Option<usize>,
) {
    if end <= start || colors.is_empty() { return; }
    if excluded.iter().any(|range| start < range.end as usize && (range.start as usize) < end) {
        return;
    }

    let mut color_index = next_random(colors.len());
    if *previous_color == Some(color_index) && colors.len() > 1 {
        color_index = (color_index + 1 + next_random(colors.len() - 1)) % colors.len();
    }
    output.push(ColorStyle {
        start: start as u32,
        len: (end - start) as u32,
        st: colors[color_index].clone(),
    });
    *previous_color = Some(color_index);
}

fn tokenize_utf16(text: &str, colors: &[String], excluded: &[ExcludedRange]) -> Vec<ColorStyle> {
    let mut output = Vec::new();
    if text.is_empty() || colors.is_empty() { return output; }

    let mut utf16_offset = 0usize;
    let mut token_start: Option<usize> = None;
    let mut previous_color = None;

    for character in text.chars() {
        if character.is_whitespace() || character == '\u{FEFF}' {
            if let Some(start) = token_start.take() {
                push_span(&mut output, start, utf16_offset, colors, excluded, &mut previous_color);
            }
        } else if token_start.is_none() {
            token_start = Some(utf16_offset);
        }
        utf16_offset += character.len_utf16();
    }

    if let Some(start) = token_start {
        push_span(&mut output, start, utf16_offset, colors, excluded, &mut previous_color);
    }
    output
}

#[napi]
pub fn random_color_styles(
    text: String,
    colors: Vec<String>,
    excluded: Vec<ExcludedRange>,
) -> Result<Vec<ColorStyle>> {
    if colors.len() < 2 {
        return Err(Error::new(Status::InvalidArg, "at least two colors are required"));
    }
    Ok(tokenize_utf16(&text, &colors, &excluded))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn colors() -> Vec<String> {
        vec!["red".to_string(), "orange".to_string(), "yellow".to_string(), "green".to_string()]
    }

    #[test]
    fn token_offsets_match_javascript_utf16_indices() {
        let text = "🤖 Chào bạn nhé\n👉 你好";
        let styles = tokenize_utf16(text, &colors(), &[]);
        let spans: Vec<(u32, u32)> = styles.iter().map(|s| (s.start, s.len)).collect();
        assert_eq!(spans, vec![(0, 2), (3, 4), (8, 3), (12, 3), (16, 2), (19, 2)]);
    }

    #[test]
    fn tagged_mention_spans_are_not_colored() {
        let text = "@Wuang chào bạn";
        let excluded = vec![ExcludedRange { start: 0, end: 6 }];
        let styles = tokenize_utf16(text, &colors(), &excluded);
        let spans: Vec<(u32, u32)> = styles.iter().map(|s| (s.start, s.len)).collect();
        assert_eq!(spans, vec![(7, 4), (12, 3)]);
    }

    #[test]
    fn adjacent_tokens_never_reuse_the_same_color() {
        let styles = tokenize_utf16("one two three four five six", &colors(), &[]);
        assert_eq!(styles.len(), 6);
        for pair in styles.windows(2) { assert_ne!(pair[0].st, pair[1].st); }
    }

    #[test]
    fn empty_input_produces_no_styles() {
        let colors = vec!["red".to_string(), "green".to_string()];
        assert!(tokenize_utf16("", &colors, &[]).is_empty());
        assert!(tokenize_utf16("   \n\t", &colors, &[]).is_empty());
    }
}
