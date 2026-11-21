use napi_derive::napi;
use unicode_normalization::UnicodeNormalization;
use std::sync::OnceLock;

const BOARD_SIZE: usize = 16;
const CELL_COUNT: usize = BOARD_SIZE * BOARD_SIZE;
const WIN_LENGTH: usize = 5;
const DIRECTIONS: [(isize, isize); 4] = [(0, 1), (1, 0), (1, 1), (1, -1)];

#[napi(object)]
pub struct MoveEvaluation {
    pub won: bool,
    pub draw: bool,
}

fn valid_board(board: &[Option<String>]) -> bool {
    board.len() == CELL_COUNT
}

fn inside(row: isize, col: isize) -> bool {
    row >= 0 && row < BOARD_SIZE as isize && col >= 0 && col < BOARD_SIZE as isize
}

fn check_winner_inner(board: &[Option<String>], cell_index: usize, symbol: &str) -> bool {
    if !valid_board(board) || cell_index >= CELL_COUNT {
        return false;
    }
    let row = (cell_index / BOARD_SIZE) as isize;
    let col = (cell_index % BOARD_SIZE) as isize;
    for (dr, dc) in DIRECTIONS {
        let mut count = 1usize;
        for direction in [-1isize, 1isize] {
            let mut r = row + dr * direction;
            let mut c = col + dc * direction;
            while inside(r, c) {
                let index = r as usize * BOARD_SIZE + c as usize;
                if board[index].as_deref() != Some(symbol) { break; }
                count += 1;
                r += dr * direction;
                c += dc * direction;
            }
        }
        if count >= WIN_LENGTH { return true; }
    }
    false
}

fn windows() -> &'static [[usize; WIN_LENGTH]] {
    static WINDOWS: OnceLock<Vec<[usize; WIN_LENGTH]>> = OnceLock::new();
    WINDOWS.get_or_init(|| {
        let mut result = Vec::new();
        for (dr, dc) in DIRECTIONS {
            for row in 0..BOARD_SIZE {
                for col in 0..BOARD_SIZE {
                    let end_row = row as isize + dr * (WIN_LENGTH as isize - 1);
                    let end_col = col as isize + dc * (WIN_LENGTH as isize - 1);
                    if !inside(end_row, end_col) { continue; }
                    let mut cells = [0usize; WIN_LENGTH];
                    for offset in 0..WIN_LENGTH {
                        let r = row as isize + dr * offset as isize;
                        let c = col as isize + dc * offset as isize;
                        cells[offset] = r as usize * BOARD_SIZE + c as usize;
                    }
                    result.push(cells);
                }
            }
        }
        result
    }).as_slice()
}

fn check_winner_with_virtual_move(board: &[Option<String>], cell_index: usize, symbol: &str) -> bool {
    if !valid_board(board) || cell_index >= CELL_COUNT { return false; }
    let row = (cell_index / BOARD_SIZE) as isize;
    let col = (cell_index % BOARD_SIZE) as isize;
    for (dr, dc) in DIRECTIONS {
        let mut count = 1usize;
        for direction in [-1isize, 1isize] {
            let mut r = row + dr * direction;
            let mut c = col + dc * direction;
            while inside(r, c) {
                let index = r as usize * BOARD_SIZE + c as usize;
                if board[index].as_deref() != Some(symbol) { break; }
                count += 1;
                r += dr * direction;
                c += dc * direction;
            }
        }
        if count >= WIN_LENGTH { return true; }
    }
    false
}

fn find_immediate_move(board: &[Option<String>], symbol: &str) -> Option<u32> {
    (0..CELL_COUNT)
        .find(|&index| board[index].is_none() && check_winner_with_virtual_move(board, index, symbol))
        .map(|index| index as u32 + 1)
}

fn choose_ai_move_inner(board: &[Option<String>], ai_symbol: &str) -> Option<u32> {
    if !valid_board(board) || (ai_symbol != "X" && ai_symbol != "O") { return None; }
    let opponent = if ai_symbol == "X" { "O" } else { "X" };
    if let Some(cell) = find_immediate_move(board, ai_symbol) { return Some(cell); }
    if let Some(cell) = find_immediate_move(board, opponent) { return Some(cell); }

    let attack_weight = [0.0_f64, 4.0, 32.0, 300.0, 30000.0];
    let defence_weight = [0.0_f64, 6.0, 48.0, 420.0, 36000.0];
    let mut scores = [0.0_f64; CELL_COUNT];

    for window in windows() {
        let mut own = 0usize;
        let mut enemy = 0usize;
        let mut empty = [0usize; WIN_LENGTH];
        let mut empty_count = 0usize;
        for &index in window {
            match board[index].as_deref() {
                Some(value) if value == ai_symbol => own += 1,
                Some(value) if value == opponent => enemy += 1,
                _ => { empty[empty_count] = index; empty_count += 1; }
            }
        }
        if empty_count == 0 || (own > 0 && enemy > 0) { continue; }
        let weight = if own > 0 { attack_weight[own] } else { defence_weight[enemy] };
        for &index in &empty[..empty_count] { scores[index] += weight; }
    }

    let center = (BOARD_SIZE as f64 - 1.0) / 2.0;
    let mut best_index: Option<usize> = None;
    let mut best_score = f64::NEG_INFINITY;
    for index in 0..CELL_COUNT {
        if board[index].is_some() { continue; }
        let row = (index / BOARD_SIZE) as f64;
        let col = (index % BOARD_SIZE) as f64;
        let distance = (row - center).abs() + (col - center).abs();
        let mut neighbors = 0usize;
        for dr in -1isize..=1 {
            for dc in -1isize..=1 {
                if dr == 0 && dc == 0 { continue; }
                let r = row as isize + dr;
                let c = col as isize + dc;
                if !inside(r, c) { continue; }
                let neighbor = r as usize * BOARD_SIZE + c as usize;
                if board[neighbor].as_ref().is_some_and(|value| !value.is_empty()) {
                    neighbors += 1;
                }
            }
        }
        let score = scores[index] + neighbors as f64 * 1.5 - distance * 0.05;
        if score > best_score { best_score = score; best_index = Some(index); }
    }
    best_index.map(|index| index as u32 + 1)
}

#[napi]
pub fn caro_check_winner(board: Vec<Option<String>>, cell_index: u32, symbol: String) -> bool {
    check_winner_inner(&board, cell_index as usize, &symbol)
}

#[napi]
pub fn caro_evaluate_move(board: Vec<Option<String>>, cell_index: u32, symbol: String) -> MoveEvaluation {
    let index = cell_index as usize;
    if !valid_board(&board) || index >= CELL_COUNT || board[index].is_some() {
        return MoveEvaluation { won: false, draw: false };
    }
    let won = check_winner_with_virtual_move(&board, index, &symbol);
    let draw = !won && board.iter().enumerate().all(|(position, value)| position == index || value.is_some());
    MoveEvaluation { won, draw }
}

#[napi]
pub fn caro_choose_ai_move(board: Vec<Option<String>>, ai_symbol: String) -> Option<u32> {
    choose_ai_move_inner(&board, &ai_symbol)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn empty_board() -> Vec<Option<String>> { vec![None; CELL_COUNT] }
    fn put(board: &mut [Option<String>], cell: usize, symbol: &str) {
        board[cell - 1] = Some(symbol.to_string());
    }

    #[test]
    fn detects_horizontal_diagonal_wins_without_row_wrapping() {
        let mut horizontal = empty_board();
        for cell in [1, 2, 3, 4] { put(&mut horizontal, cell, "X"); }
        assert!(check_winner_inner(&horizontal, 4, "X"));

        let mut diagonal = empty_board();
        for cell in [18, 35, 52, 69, 86] { put(&mut diagonal, cell, "O"); }
        assert!(check_winner_inner(&diagonal, 85, "O"));

        let mut wrapped = empty_board();
        for cell in [15, 16, 17, 18, 19] { put(&mut wrapped, cell, "X"); }
        assert!(!check_winner_inner(&wrapped, 19, "X"));
    }

    #[test]
    fn ai_takes_an_immediate_win_and_blocks_an_open_four() {
        let mut winning = empty_board();
        for cell in [34, 35, 36, 37] { put(&mut winning, cell, "O"); }
        assert_eq!(choose_ai_move_inner(&winning, "O"), find_immediate_move(&winning, "O"));

        let mut blocking = empty_board();
        for cell in [50, 51, 52, 53] { put(&mut blocking, cell, "X"); }
        assert_eq!(choose_ai_move_inner(&blocking, "O"), Some(49));
    }

    #[test]
    fn empty_and_full_boards_return_a_valid_result() {
        let empty = empty_board();
        assert!(choose_ai_move_inner(&empty, "O").is_some());
        let full = vec![Some("X".to_string()); CELL_COUNT];
        assert_eq!(choose_ai_move_inner(&full, "O"), None);
    }

    #[test]
    fn move_evaluation_reports_wins() {
        let mut board = empty_board();
        for cell in [1, 2, 3, 4] { put(&mut board, cell, "X"); }
        let result = caro_evaluate_move(board, 4, "X".to_string());
        assert!(result.won);
        assert!(!result.draw);
    }
}


#[napi(object)]
pub struct ParsedNoituPhrase {
    pub display: String,
    pub normalized: String,
    pub first: String,
    pub last: String,
    pub syllables: Vec<String>,
}

fn is_js_whitespace(character: char) -> bool {
    matches!(
        character,
        '\u{0009}'..='\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

fn normalize_syllable_inner(value: &str) -> String {
    value
        .to_lowercase()
        .nfd()
        .filter(|character| !('\u{0300}'..='\u{036F}').contains(character))
        .map(|character| if character == 'đ' { 'd' } else { character })
        .collect()
}

fn clean_phrase_display(value: &str, normalize_before_lowercase: bool) -> String {
    let source = if normalize_before_lowercase {
        value.nfc().collect::<String>().to_lowercase()
    } else {
        value.to_lowercase().nfc().collect::<String>()
    };
    let mut cleaned = String::with_capacity(source.len());
    for character in source.chars() {
        if character.is_alphabetic() || is_js_whitespace(character) {
            cleaned.push(character);
        } else {
            cleaned.push(' ');
        }
    }
    cleaned
        .split(is_js_whitespace)
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_phrase_inner(value: &str) -> String {
    let display = clean_phrase_display(value, false);
    display
        .split(' ')
        .filter(|word| !word.is_empty())
        .map(normalize_syllable_inner)
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_phrase_inner(value: &str) -> Option<ParsedNoituPhrase> {
    let display = clean_phrase_display(value, true);
    if display.is_empty() {
        return None;
    }

    let words: Vec<&str> = display.split(' ').filter(|word| !word.is_empty()).collect();
    if !(2..=4).contains(&words.len()) {
        return None;
    }

    let syllables: Vec<String> = words.iter().map(|word| normalize_syllable_inner(word)).collect();
    if syllables.iter().any(|word| {
        word.is_empty() || !word.chars().all(|character| character.is_ascii_lowercase())
    }) {
        return None;
    }

    Some(ParsedNoituPhrase {
        display,
        normalized: syllables.join(" "),
        first: syllables.first()?.clone(),
        last: syllables.last()?.clone(),
        syllables,
    })
}

#[napi]
pub fn noitu_normalize_syllable(value: String) -> String {
    normalize_syllable_inner(&value)
}

#[napi]
pub fn noitu_normalize_phrase(value: String) -> String {
    normalize_phrase_inner(&value)
}

#[napi]
pub fn noitu_parse_phrase(value: String) -> Option<ParsedNoituPhrase> {
    parse_phrase_inner(&value)
}

#[cfg(test)]
mod noitu_tests {
    use super::*;

    #[test]
    fn normalizes_vietnamese_diacritics_punctuation_and_spacing() {
        assert_eq!(normalize_phrase_inner("  VIÊN   CHỨC! "), "vien chuc");
        assert_eq!(normalize_syllable_inner("ĐIỆN"), "dien");
    }

    #[test]
    fn parses_valid_vietnamese_phrases_and_rejects_invalid_word_counts() {
        let parsed = parse_phrase_inner("ĐIỆN-thoại").unwrap();
        assert_eq!(parsed.display, "điện thoại");
        assert_eq!(parsed.normalized, "dien thoai");
        assert_eq!(parsed.first, "dien");
        assert_eq!(parsed.last, "thoai");
        assert_eq!(parsed.syllables, vec!["dien", "thoai"]);

        assert!(parse_phrase_inner("sinh").is_none());
        assert!(parse_phrase_inner("mot hai ba bon nam").is_none());
    }

    #[test]
    fn handles_unicode_whitespace_and_combining_marks() {
        assert_eq!(normalize_phrase_inner("\u{FEFF}VIÊN\u{00A0}CHỨC"), "vien chuc");
        assert_eq!(parse_phrase_inner("a\u{0085}b c").unwrap().normalized, "a b c");
        assert_eq!(normalize_syllable_inner("a\u{0301}"), "a");
    }

    #[test]
    fn rejects_non_ascii_syllables_for_game_phrases() {
        assert!(parse_phrase_inner("猫 猫").is_none());
        assert_eq!(normalize_phrase_inner("猫 猫"), "猫 猫");
    }
}
