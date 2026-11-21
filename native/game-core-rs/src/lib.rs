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


#[derive(Clone)]
#[napi(object)]
pub struct SamCard {
    pub rank: f64,
    pub suit: String,
    pub id: String,
}

#[derive(Clone)]
#[napi(object)]
pub struct SamCombo {
    pub combo_type: String,
    pub cards: Vec<SamCard>,
    pub length: u32,
    pub main_rank: f64,
    pub high_suit: i32,
    pub card_count: u32,
}

#[napi(object)]
pub struct SamValidationResult {
    pub ok: bool,
    pub code: Option<String>,
    pub combo: Option<SamCombo>,
    pub current_combo: Option<SamCombo>,
}

fn sam_suit_weight(suit: &str) -> i32 {
    match suit {
        "b" => 0,
        "ch" => 1,
        "r" => 2,
        "c" => 3,
        _ => -1,
    }
}

fn sam_valid_rank(rank: f64) -> bool {
    rank.is_finite() && rank.fract() == 0.0 && (3.0..=15.0).contains(&rank)
}

fn sam_sort_hand_inner(mut cards: Vec<SamCard>) -> Vec<SamCard> {
    cards.sort_by(|left, right| {
        left.rank.partial_cmp(&right.rank).unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| sam_suit_weight(&left.suit).cmp(&sam_suit_weight(&right.suit)))
    });
    cards
}

fn sam_parse_card_code_inner(value: &str) -> Option<SamCard> {
    let source = value.trim_matches(is_js_whitespace).to_ascii_lowercase();
    let (rank_text, suit_text) = if let Some(rest) = source.strip_prefix("10") {
        ("10", rest)
    } else {
        let mut chars = source.chars();
        let rank = chars.next()?;
        let rest: String = chars.collect();
        if !matches!(rank, '3'..='9' | 'j' | 'q' | 'k' | 'a' | '2') {
            return None;
        }
        return sam_build_card(rank.to_string().as_str(), rest.as_str());
    };
    sam_build_card(rank_text, suit_text)
}

fn sam_build_card(rank_text: &str, suit_text: &str) -> Option<SamCard> {
    let rank = match rank_text {
        "j" => 11.0,
        "q" => 12.0,
        "k" => 13.0,
        "a" => 14.0,
        "2" => 15.0,
        _ => rank_text.parse::<f64>().ok()?,
    };
    let suit = match suit_text {
        "t" => "ch",
        "b" | "ch" | "r" | "c" => suit_text,
        _ => return None,
    };
    if !sam_valid_rank(rank) {
        return None;
    }
    Some(SamCard {
        rank,
        suit: suit.to_string(),
        id: format!("{}{}", rank as u32, suit),
    })
}

fn sam_analyze_combo_inner(input_cards: Vec<SamCard>) -> Option<SamCombo> {
    let cards = sam_sort_hand_inner(input_cards);
    if cards.is_empty() || cards.iter().any(|card| !sam_valid_rank(card.rank) || sam_suit_weight(&card.suit) < 0) {
        return None;
    }

    let mut counts: Vec<(i64, usize)> = Vec::new();
    for card in &cards {
        let rank = card.rank as i64;
        if let Some((_, count)) = counts.iter_mut().find(|(existing, _)| *existing == rank) {
            *count += 1;
        } else {
            counts.push((rank, 1));
        }
    }
    counts.sort_by_key(|(rank, _)| *rank);
    let ranks: Vec<i64> = counts.iter().map(|(rank, _)| *rank).collect();

    let max_card = cards.last()?;
    let mut combo_type = String::new();
    let mut main_rank = max_card.rank;
    if cards.len() == 1 {
        combo_type = "single".to_string();
    } else if cards.len() == 2 && counts.len() == 1 {
        combo_type = "pair".to_string();
    } else if cards.len() == 3 && counts.len() == 1 {
        combo_type = "triple".to_string();
    } else if cards.len() == 4 && counts.len() == 1 {
        combo_type = "fourKind".to_string();
    } else if cards.len() >= 3 && counts.len() == cards.len()
        && !ranks.contains(&15)
        && ranks.iter().enumerate().all(|(index, rank)| index == 0 || *rank == ranks[index - 1] + 1)
    {
        combo_type = "straight".to_string();
        main_rank = *ranks.last()? as f64;
    }
    if combo_type.is_empty() {
        return None;
    }

    let high_suit = cards.iter().map(|card| sam_suit_weight(&card.suit)).max().unwrap_or(-1);
    Some(SamCombo {
        combo_type,
        length: cards.len() as u32,
        main_rank,
        high_suit,
        card_count: cards.len() as u32,
        cards,
    })
}

fn sam_can_beat_inner(candidate: Option<&SamCombo>, current: Option<&SamCombo>) -> bool {
    let Some(candidate) = candidate else { return false; };
    let Some(current) = current else { return true; };

    if candidate.combo_type == "fourKind" && current.combo_type == "single" && current.main_rank == 15.0 {
        return true;
    }
    if candidate.combo_type == "fourKind" && current.combo_type == "fourKind" {
        return candidate.main_rank > current.main_rank;
    }
    if candidate.combo_type != current.combo_type || candidate.length != current.length {
        return false;
    }
    candidate.main_rank > current.main_rank
}

fn sam_validation_error(code: &str, combo: Option<SamCombo>, current_combo: Option<SamCombo>) -> SamValidationResult {
    SamValidationResult {
        ok: false,
        code: Some(code.to_string()),
        combo,
        current_combo,
    }
}

fn sam_validate_play_inner(
    hand: Vec<SamCard>,
    input_cards: Vec<SamCard>,
    current_combo: Option<SamCombo>,
    must_contain_three_of_spades: bool,
) -> SamValidationResult {
    let selected = sam_sort_hand_inner(input_cards);
    if selected.is_empty() {
        return sam_validation_error("EMPTY_PLAY", None, None);
    }

    let mut ids = std::collections::HashSet::new();
    if selected.iter().any(|card| !ids.insert(card.id.clone())) {
        return sam_validation_error("DUPLICATE_CARD", None, None);
    }

    let hand_ids: std::collections::HashSet<String> = hand.into_iter().map(|card| card.id).collect();
    if selected.iter().any(|card| !hand_ids.contains(&card.id)) {
        return sam_validation_error("CARD_NOT_IN_HAND", None, None);
    }

    let Some(combo) = sam_analyze_combo_inner(selected.clone()) else {
        return sam_validation_error("INVALID_COMBINATION", None, None);
    };

    if must_contain_three_of_spades && !ids.contains("3b") {
        return sam_validation_error("MUST_PLAY_THREE_SPADES", None, None);
    }

    if let Some(current) = current_combo.as_ref() {
        if !sam_can_beat_inner(Some(&combo), Some(current)) {
            return SamValidationResult {
                ok: false,
                code: Some("CANNOT_BEAT".to_string()),
                combo: Some(combo),
                current_combo,
            };
        }
    }

    SamValidationResult {
        ok: true,
        code: None,
        combo: Some(combo),
        current_combo: None,
    }
}

fn sam_detect_white_hand_inner(input_hand: Vec<SamCard>) -> Option<String> {
    let cards = sam_sort_hand_inner(input_hand);
    if cards.len() != 10 {
        return None;
    }

    let mut counts: Vec<(i64, usize)> = Vec::new();
    for card in &cards {
        let rank = card.rank as i64;
        if let Some((_, count)) = counts.iter_mut().find(|(existing, _)| *existing == rank) {
            *count += 1;
        } else {
            counts.push((rank, 1));
        }
    }
    counts.sort_by_key(|(rank, _)| *rank);
    let ranks: Vec<i64> = counts.iter().map(|(rank, _)| *rank).collect();
    let mut priorities: Vec<&str> = Vec::new();

    if ranks.len() == 10 && !ranks.contains(&15)
        && ranks.iter().enumerate().all(|(index, rank)| index == 0 || *rank == ranks[index - 1] + 1)
    {
        priorities.push("longStraight");
    }
    if counts.iter().any(|(rank, count)| *rank == 15 && *count == 4) {
        priorities.push("fourTwos");
    }
    let is_red = |suit: &str| suit != "b" && suit != "ch";
    if cards.iter().all(|card| is_red(&card.suit)) || cards.iter().all(|card| !is_red(&card.suit)) {
        priorities.push("sameColor");
    }
    if counts.iter().filter(|(_, count)| *count == 3).count() >= 3 {
        priorities.push("threeTriples");
    }
    let pair_units: usize = counts.iter().map(|(_, count)| count / 2).sum();
    if pair_units >= 5 {
        priorities.push("fivePairs");
    }

    ["longStraight", "fourTwos", "sameColor", "threeTriples", "fivePairs"]
        .iter()
        .find(|kind| priorities.contains(kind))
        .map(|kind| (*kind).to_string())
}

fn sam_white_hand_priority(kind: &str) -> i32 {
    match kind {
        "longStraight" => 0,
        "fourTwos" => 1,
        "sameColor" => 2,
        "threeTriples" => 3,
        "fivePairs" => 4,
        _ => -1,
    }
}

fn sam_white_hand_score(hand: Vec<SamCard>, kind: &str) -> f64 {
    let cards = sam_sort_hand_inner(hand);
    let mut counts: Vec<(f64, usize)> = Vec::new();
    for card in &cards {
        if let Some((_, count)) = counts.iter_mut().find(|(rank, _)| *rank == card.rank) {
            *count += 1;
        } else {
            counts.push((card.rank, 1));
        }
    }
    cards.iter()
        .filter(|card| {
            let count = counts.iter().find(|(rank, _)| *rank == card.rank).map(|(_, count)| *count).unwrap_or(0);
            if kind == "threeTriples" { count == 3 }
            else if kind == "fivePairs" { count >= 2 }
            else { true }
        })
        .map(|card| card.rank)
        .fold(0.0_f64, f64::max)
}

fn sam_card_label_inner(card: &SamCard) -> String {
    let rank = match card.rank as i32 {
        3..=10 if sam_valid_rank(card.rank) => format!("{}", card.rank as i32),
        11 if card.rank == 11.0 => "J".to_string(),
        12 if card.rank == 12.0 => "Q".to_string(),
        13 if card.rank == 13.0 => "K".to_string(),
        14 if card.rank == 14.0 => "A".to_string(),
        15 if card.rank == 15.0 => "2".to_string(),
        _ => card.rank.to_string(),
    };
    let suit = match card.suit.as_str() {
        "b" => "♠",
        "ch" => "♣",
        "r" => "♦",
        "c" => "♥",
        _ => card.suit.as_str(),
    };
    format!("{}{}", rank, suit)
}

#[napi]
pub fn sam_create_deck() -> Vec<SamCard> {
    let mut deck = Vec::with_capacity(52);
    for rank in 3..=15 {
        for suit in ["b", "ch", "r", "c"] {
            deck.push(SamCard { rank: rank as f64, suit: suit.to_string(), id: format!("{}{}", rank, suit) });
        }
    }
    deck
}

#[napi]
pub fn sam_sort_hand(cards: Vec<SamCard>) -> Vec<SamCard> {
    sam_sort_hand_inner(cards)
}

#[napi]
pub fn sam_parse_card_code(value: String) -> Option<SamCard> {
    sam_parse_card_code_inner(&value)
}

#[napi]
pub fn sam_analyze_combo(cards: Vec<SamCard>) -> Option<SamCombo> {
    sam_analyze_combo_inner(cards)
}

#[napi]
pub fn sam_can_beat(candidate: Option<SamCombo>, current: Option<SamCombo>) -> bool {
    sam_can_beat_inner(candidate.as_ref(), current.as_ref())
}

#[napi]
pub fn sam_validate_play(
    hand: Vec<SamCard>,
    input_cards: Vec<SamCard>,
    current_combo: Option<SamCombo>,
    must_contain_three_of_spades: bool,
) -> SamValidationResult {
    sam_validate_play_inner(hand, input_cards, current_combo, must_contain_three_of_spades)
}

#[napi]
pub fn sam_remove_cards(hand: Vec<SamCard>, played_cards: Vec<SamCard>) -> Vec<SamCard> {
    let removed: std::collections::HashSet<String> = played_cards.into_iter().map(|card| card.id).collect();
    hand.into_iter().filter(|card| !removed.contains(&card.id)).collect()
}

#[napi]
pub fn sam_detect_white_hand(hand: Vec<SamCard>) -> Option<String> {
    sam_detect_white_hand_inner(hand)
}

#[napi]
pub fn sam_compare_white_hands(hand_a: Vec<SamCard>, type_a: String, hand_b: Vec<SamCard>, type_b: String) -> i32 {
    let priority = sam_white_hand_priority(&type_a) - sam_white_hand_priority(&type_b);
    if priority != 0 { return priority; }
    let score_a = sam_white_hand_score(hand_a, &type_a);
    let score_b = sam_white_hand_score(hand_b, &type_b);
    (score_b - score_a) as i32
}

#[napi]
pub fn sam_card_label(card: SamCard) -> String {
    sam_card_label_inner(&card)
}

#[napi]
pub fn sam_format_cards(cards: Vec<SamCard>) -> String {
    sam_sort_hand_inner(cards)
        .iter()
        .map(sam_card_label_inner)
        .collect::<Vec<_>>()
        .join("  ")
}


fn sam_normalize_text_inner(value: &str) -> String {
    value
        .nfd()
        .filter(|character| !('\u{0300}'..='\u{036F}').contains(character))
        .map(|character| if character == 'đ' || character == 'Đ' { 'd' } else { character })
        .collect::<String>()
        .to_lowercase()
        .trim_matches(is_js_whitespace)
        .to_string()
}

#[napi]
pub fn sam_normalize_text(value: String) -> String {
    sam_normalize_text_inner(&value)
}

#[cfg(test)]
mod sam_tests {
    use super::*;

    fn card(rank: f64, suit: &str) -> SamCard {
        SamCard { rank, suit: suit.to_string(), id: format!("{}{}", rank as u32, suit) }
    }

    #[test]
    fn creates_and_sorts_the_standard_deck() {
        let deck = sam_create_deck();
        assert_eq!(deck.len(), 52);
        let mut sorted = deck.clone();
        sorted.reverse();
        sorted = sam_sort_hand_inner(sorted);
        assert_eq!(sorted.first().unwrap().id, "3b");
        assert_eq!(sorted.last().unwrap().id, "15c");
    }

    #[test]
    fn parses_card_codes_and_normalizes_vietnamese_text() {
        assert_eq!(sam_parse_card_code_inner("10CH").unwrap().id, "10ch");
        assert_eq!(sam_parse_card_code_inner("At").unwrap().id, "14ch");
        assert!(sam_parse_card_code_inner("16b").is_none());
        assert_eq!(sam_normalize_text_inner("  ĐIỆN THOẠI! "), "dien thoai!");
    }

    #[test]
    fn analyzes_combinations_and_compares_four_of_a_kind() {
        let pair = sam_analyze_combo_inner(vec![card(3.0, "b"), card(3.0, "r")]).unwrap();
        assert_eq!(pair.combo_type, "pair");
        let four = sam_analyze_combo_inner(vec![
            card(7.0, "b"), card(7.0, "ch"), card(7.0, "r"), card(7.0, "c")
        ]).unwrap();
        let two = sam_analyze_combo_inner(vec![card(15.0, "c")]).unwrap();
        assert!(sam_can_beat_inner(Some(&four), Some(&two)));
        assert!(!sam_can_beat_inner(Some(&pair), Some(&two)));
    }

    #[test]
    fn white_hand_tiebreak_returns_the_full_rank_difference() {
        let low = vec![card(5.0, "b")];
        let high = vec![card(8.0, "b")];
        assert_eq!(sam_compare_white_hands(low, "sameColor".to_string(), high, "sameColor".to_string()), 3);
    }

    #[test]
    fn detects_white_hand_priorities() {
        let long_straight: Vec<SamCard> = (3..=12).map(|rank| card(rank as f64, "b")).collect();
        assert_eq!(sam_detect_white_hand_inner(long_straight), Some("longStraight".to_string()));
        let five_pairs: Vec<SamCard> = (3..=7).flat_map(|rank| {
            vec![card(rank as f64, "b"), card(rank as f64, "c")]
        }).collect();
        assert_eq!(sam_detect_white_hand_inner(five_pairs), Some("fivePairs".to_string()));
    }
}


fn tlmn_suit_weight(suit: &str) -> Option<i32> {
    match suit {
        "b" => Some(0),
        "ch" | "t" => Some(1),
        "r" => Some(2),
        "c" => Some(3),
        _ => None,
    }
}

fn tlmn_compare_cards_inner(left: &SamCard, right: &SamCard) -> f64 {
    let rank_difference = left.rank - right.rank;
    if rank_difference != 0.0 {
        return rank_difference;
    }
    match (tlmn_suit_weight(&left.suit), tlmn_suit_weight(&right.suit)) {
        (Some(left), Some(right)) => (left - right) as f64,
        _ => f64::NAN,
    }
}

fn tlmn_sort_hand_inner(mut cards: Vec<SamCard>) -> Vec<SamCard> {
    cards.sort_by(|left, right| {
        let difference = tlmn_compare_cards_inner(left, right);
        if difference.is_nan() || difference == 0.0 {
            std::cmp::Ordering::Equal
        } else if difference < 0.0 {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });
    cards
}

fn tlmn_create_deck_inner() -> Vec<SamCard> {
    let mut deck = Vec::with_capacity(52);
    for rank in 3..=15 {
        for suit in ["b", "ch", "r", "c"] {
            deck.push(SamCard {
                rank: rank as f64,
                suit: suit.to_string(),
                id: format!("{}{}", rank, suit),
            });
        }
    }
    deck
}

fn tlmn_normalize_text_inner(value: &str) -> String {
    value.nfd()
        .filter(|character| !('\u{0300}'..='\u{036F}').contains(character))
        .map(|character| if character == 'đ' || character == 'Đ' { 'd' } else { character })
        .collect::<String>()
        .to_lowercase()
        .trim_matches(is_js_whitespace)
        .to_string()
}

fn tlmn_rank_label_inner(rank: f64) -> String {
    match rank as i32 {
        3..=10 if sam_valid_rank(rank) => format!("{}", rank as i32),
        11 if rank == 11.0 => "J".to_string(),
        12 if rank == 12.0 => "Q".to_string(),
        13 if rank == 13.0 => "K".to_string(),
        14 if rank == 14.0 => "A".to_string(),
        15 if rank == 15.0 => "2".to_string(),
        _ => rank.to_string(),
    }
}

fn tlmn_card_code_inner(card: &SamCard) -> String {
    format!("{}{}", tlmn_rank_label_inner(card.rank).to_lowercase(), card.suit)
}

fn tlmn_build_card(rank_text: &str, suit_text: &str) -> Option<SamCard> {
    let rank = match rank_text {
        "j" => 11.0,
        "q" => 12.0,
        "k" => 13.0,
        "a" => 14.0,
        "2" => 15.0,
        _ => rank_text.parse::<f64>().ok()?,
    };
    let suit = match suit_text {
        "t" | "dt" => "ch",
        "b" | "ch" | "r" | "c" => suit_text,
        _ => return None,
    };
    if !sam_valid_rank(rank) {
        return None;
    }
    Some(SamCard {
        rank,
        suit: suit.to_string(),
        id: format!("{}{}", rank as u32, suit),
    })
}

fn tlmn_parse_card_code_inner(value: &str) -> Option<SamCard> {
    let source = value.trim_matches(is_js_whitespace).to_ascii_lowercase();
    let (rank_text, suit_text) = if let Some(rest) = source.strip_prefix("10") {
        ("10", rest)
    } else {
        let mut chars = source.chars();
        let rank = chars.next()?;
        let rest: String = chars.collect();
        if !matches!(rank, '3'..='9' | 'j' | 'q' | 'k' | 'a' | '2') {
            return None;
        }
        return tlmn_build_card(rank.to_string().as_str(), rest.as_str());
    };
    tlmn_build_card(rank_text, suit_text)
}

fn tlmn_parse_rank_inner(value: &str) -> Option<u32> {
    let raw = value.to_lowercase();
    let rank = match raw.as_str() {
        "j" => 11,
        "q" => 12,
        "k" => 13,
        "a" => 14,
        "2" => 15,
        _ => raw.parse::<u32>().ok()?,
    };
    if (3..=15).contains(&rank) { Some(rank) } else { None }
}

fn tlmn_parse_rank_sequence_inner(value: &str) -> Vec<u32> {
    let source: String = value.chars()
        .filter(|character| !(is_js_whitespace(*character) || matches!(*character, ',' | '.' | '_' | '-')))
        .flat_map(|character| character.to_lowercase())
        .collect();
    let chars: Vec<char> = source.chars().collect();
    let mut result = Vec::new();
    let mut index = 0usize;
    while index < chars.len() {
        let (token, consumed) = if chars[index] == '1' && index + 1 < chars.len() && chars[index + 1] == '0' {
            ("10".to_string(), 2)
        } else {
            (chars[index].to_string(), 1)
        };
        let Some(rank) = tlmn_parse_rank_inner(&token) else { return Vec::new(); };
        result.push(rank);
        index += consumed;
    }
    result
}

fn tlmn_analyze_combo_inner(input_cards: Vec<SamCard>) -> Option<SamCombo> {
    let cards = tlmn_sort_hand_inner(input_cards);
    if cards.is_empty() || cards.iter().any(|card| !sam_valid_rank(card.rank) || tlmn_suit_weight(&card.suit).is_none()) {
        return None;
    }

    let mut counts: Vec<(i64, usize)> = Vec::new();
    for card in &cards {
        let rank = card.rank as i64;
        if let Some((_, count)) = counts.iter_mut().find(|(existing, _)| *existing == rank) {
            *count += 1;
        } else {
            counts.push((rank, 1));
        }
    }
    counts.sort_by_key(|(rank, _)| *rank);
    let unique_ranks: Vec<i64> = counts.iter().map(|(rank, _)| *rank).collect();
    let rank_counts: Vec<usize> = counts.iter().map(|(_, count)| *count).collect();
    let top = cards.last()?;
    let mut combo_type = String::new();
    let mut main_rank = top.rank;
    let mut length = cards.len();

    if cards.len() == 1 {
        combo_type = "single".to_string();
    } else if cards.len() == 2 && counts.len() == 1 && rank_counts[0] == 2 {
        combo_type = "pair".to_string();
    } else if cards.len() == 3 && counts.len() == 1 && rank_counts[0] == 3 {
        combo_type = "triple".to_string();
    } else if cards.len() == 4 && counts.len() == 1 && rank_counts[0] == 4 {
        combo_type = "fourKind".to_string();
    } else if cards.len() >= 3 && unique_ranks.len() == cards.len()
        && !unique_ranks.contains(&15)
        && unique_ranks.iter().enumerate().all(|(index, rank)| index == 0 || *rank == unique_ranks[index - 1] + 1)
    {
        combo_type = "straight".to_string();
        main_rank = *unique_ranks.last()? as f64;
    } else if cards.len() >= 6 && cards.len() <= 8 && cards.len() % 2 == 0
        && unique_ranks.len() == cards.len() / 2
        && rank_counts.iter().all(|count| *count == 2)
        && unique_ranks.iter().enumerate().all(|(index, rank)| *rank != 15 && (index == 0 || *rank == unique_ranks[index - 1] + 1))
    {
        combo_type = "pairRun".to_string();
        main_rank = *unique_ranks.last()? as f64;
        length = unique_ranks.len();
    }

    if combo_type.is_empty() {
        return None;
    }

    Some(SamCombo {
        combo_type,
        cards: cards.clone(),
        length: length as u32,
        main_rank,
        high_suit: tlmn_suit_weight(&top.suit).unwrap_or(-1),
        card_count: cards.len() as u32,
    })
}

fn tlmn_can_beat_inner(candidate: Option<&SamCombo>, current: Option<&SamCombo>) -> bool {
    let Some(candidate) = candidate else { return false; };
    let Some(current) = current else { return true; };

    if candidate.combo_type == current.combo_type && candidate.length == current.length {
        return candidate.main_rank > current.main_rank
            || (candidate.main_rank == current.main_rank && candidate.high_suit > current.high_suit);
    }
    if candidate.combo_type == "fourKind" && current.combo_type == "fourKind" {
        return candidate.main_rank > current.main_rank;
    }

    let target_is_two = current.combo_type == "single" && current.main_rank == 15.0;
    let target_is_two_pair = current.combo_type == "pair" && current.main_rank == 15.0;

    if candidate.combo_type == "pairRun" && candidate.length == 3
        && (target_is_two || (current.combo_type == "pairRun" && current.length == 3)) {
        return true;
    }
    if candidate.combo_type == "fourKind" && (target_is_two
        || (current.combo_type == "pairRun" && current.length == 3)) {
        return true;
    }
    if candidate.combo_type == "pairRun" && candidate.length >= 4
        && (target_is_two || target_is_two_pair || current.combo_type == "fourKind"
            || (current.combo_type == "pairRun" && current.length >= 3)) {
        return true;
    }
    false
}

fn tlmn_validation_error(code: &str, combo: Option<SamCombo>, current_combo: Option<SamCombo>) -> SamValidationResult {
    SamValidationResult {
        ok: false,
        code: Some(code.to_string()),
        combo,
        current_combo,
    }
}

fn tlmn_validate_play_inner(
    hand: Vec<SamCard>,
    input_cards: Vec<SamCard>,
    current_combo: Option<SamCombo>,
    must_contain_three_of_spades: bool,
) -> SamValidationResult {
    let selected = tlmn_sort_hand_inner(input_cards);
    if selected.is_empty() {
        return tlmn_validation_error("EMPTY_PLAY", None, None);
    }

    let mut ids = std::collections::HashSet::new();
    if selected.iter().any(|card| !ids.insert(card.id.clone())) {
        return tlmn_validation_error("DUPLICATE_CARD", None, None);
    }

    let hand_ids: std::collections::HashSet<String> = hand.into_iter().map(|card| card.id).collect();
    if selected.iter().any(|card| !hand_ids.contains(&card.id)) {
        return tlmn_validation_error("CARD_NOT_IN_HAND", None, None);
    }

    let Some(combo) = tlmn_analyze_combo_inner(selected.clone()) else {
        return tlmn_validation_error("INVALID_COMBINATION", None, None);
    };
    if must_contain_three_of_spades && !ids.contains("3b") {
        return tlmn_validation_error("MUST_PLAY_THREE_SPADES", None, None);
    }
    if let Some(current) = current_combo.as_ref() {
        if !tlmn_can_beat_inner(Some(&combo), Some(current)) {
            return SamValidationResult {
                ok: false,
                code: Some("CANNOT_BEAT".to_string()),
                combo: Some(combo),
                current_combo,
            };
        }
    }
    SamValidationResult {
        ok: true,
        code: None,
        combo: Some(combo),
        current_combo: None,
    }
}

fn tlmn_detect_white_hand_inner(hand: Vec<SamCard>) -> Option<String> {
    let cards = tlmn_sort_hand_inner(hand);
    if cards.len() != 13 { return None; }

    let mut counts: Vec<(i64, usize)> = Vec::new();
    for card in &cards {
        let rank = card.rank as i64;
        if let Some((_, count)) = counts.iter_mut().find(|(existing, _)| *existing == rank) {
            *count += 1;
        } else {
            counts.push((rank, 1));
        }
    }
    counts.sort_by_key(|(rank, _)| *rank);
    let ranks: Vec<i64> = counts.iter().map(|(rank, _)| *rank).collect();

    let has_run = |length: usize| -> bool {
        let paired: Vec<i64> = counts.iter()
            .filter(|(rank, count)| *rank != 15 && *count >= 2)
            .map(|(rank, _)| *rank)
            .collect();
        (0..=paired.len().saturating_sub(length))
            .any(|index| index + length <= paired.len()
                && paired[index..index + length].iter().enumerate()
                    .all(|(offset, rank)| offset == 0 || *rank == paired[index + offset - 1] + 1))
    };

    let mut priorities: Vec<&str> = Vec::new();
    let has_dragon = (3..=14).all(|rank| ranks.contains(&rank));
    if has_dragon { priorities.push("dragonStraight"); }
    if has_run(6) { priorities.push("sixPairRun"); }
    if counts.iter().filter(|(_, count)| *count >= 3).count() >= 4 { priorities.push("fourTriples"); }
    if counts.iter().filter(|(_, count)| *count == 4).count() >= 2 { priorities.push("twoFourKinds"); }
    if ["b", "ch", "r", "c"].iter().any(|suit| cards.iter().filter(|card| card.suit.as_str() == *suit).count() >= 12) {
        priorities.push("twelveSameSuit");
    }
    if has_run(5) { priorities.push("fivePairRun"); }
    if counts.iter().any(|(rank, count)| *rank == 15 && *count == 4) { priorities.push("fourTwos"); }
    if counts.iter().map(|(_, count)| count / 2).sum::<usize>() >= 6 { priorities.push("sixPairs"); }

    [
        "dragonStraight", "sixPairRun", "fourTriples", "twoFourKinds",
        "twelveSameSuit", "fivePairRun", "fourTwos", "sixPairs"
    ].iter().find(|kind| priorities.contains(kind)).map(|kind| (*kind).to_string())
}

fn tlmn_white_hand_high_card_inner(hand: Vec<SamCard>, kind: &str) -> Option<SamCard> {
    let cards = tlmn_sort_hand_inner(hand);
    let mut counts: Vec<(i64, usize)> = Vec::new();
    for card in &cards {
        let rank = card.rank as i64;
        if let Some((_, count)) = counts.iter_mut().find(|(existing, _)| *existing == rank) {
            *count += 1;
        } else {
            counts.push((rank, 1));
        }
    }
    counts.sort_by_key(|(rank, _)| *rank);

    let pick_highest_card_of_rank = |rank: i64| -> Option<SamCard> {
        cards.iter().filter(|card| card.rank as i64 == rank).last().cloned()
    };

    if kind == "dragonStraight" { return pick_highest_card_of_rank(14); }
    if kind == "fourTwos" { return pick_highest_card_of_rank(15); }
    if kind == "twelveSameSuit" {
        let suit = ["b", "ch", "r", "c"].iter().find(|suit| cards.iter().filter(|card| card.suit.as_str() == *suit).count() >= 12)?;
        return cards.iter().filter(|card| card.suit.as_str() == *suit).last().cloned();
    }
    if kind == "fourTriples" || kind == "twoFourKinds" {
        let minimum = if kind == "fourTriples" { 3 } else { 4 };
        let rank = counts.iter().filter(|(_, count)| *count >= minimum).map(|(rank, _)| *rank).max()?;
        return pick_highest_card_of_rank(rank);
    }
    if kind == "sixPairs" {
        let rank = counts.iter().filter(|(_, count)| *count >= 2).map(|(rank, _)| *rank).max()?;
        return pick_highest_card_of_rank(rank);
    }
    if kind == "sixPairRun" || kind == "fivePairRun" {
        let length = if kind == "sixPairRun" { 6 } else { 5 };
        let paired: Vec<i64> = counts.iter().filter(|(rank, count)| *rank != 15 && *count >= 2).map(|(rank, _)| *rank).collect();
        let mut highest: Option<i64> = None;
        for index in 0..paired.len() {
            if index + length > paired.len() { break; }
            let run = &paired[index..index + length];
            if run.iter().enumerate().all(|(offset, rank)| offset == 0 || *rank == run[offset - 1] + 1) {
                highest = Some(highest.map_or(run[length - 1], |value| value.max(run[length - 1])));
            }
        }
        if let Some(rank) = highest { return pick_highest_card_of_rank(rank); }
    }
    cards.last().cloned()
}

fn tlmn_white_hand_priority(kind: &str) -> i32 {
    match kind {
        "dragonStraight" => 0,
        "sixPairRun" => 1,
        "fourTriples" => 2,
        "twoFourKinds" => 3,
        "twelveSameSuit" => 4,
        "fivePairRun" => 5,
        "fourTwos" => 6,
        "sixPairs" => 7,
        _ => -1,
    }
}

fn tlmn_compare_white_hands_inner(hand_a: Vec<SamCard>, type_a: &str, hand_b: Vec<SamCard>, type_b: &str) -> f64 {
    let priority = tlmn_white_hand_priority(type_a) - tlmn_white_hand_priority(type_b);
    if priority != 0 { return priority as f64; }
    let a = tlmn_white_hand_high_card_inner(hand_a, type_a);
    let b = tlmn_white_hand_high_card_inner(hand_b, type_b);
    match (a.as_ref(), b.as_ref()) {
        (None, None) => 0.0,
        (None, Some(_)) => 1.0,
        (Some(_), None) => -1.0,
        (Some(a), Some(b)) => tlmn_compare_cards_inner(b, a),
    }
}

fn tlmn_card_label_inner(card: &SamCard) -> String {
    let suit = match card.suit.as_str() {
        "b" => "♠",
        "ch" => "♣",
        "r" => "♦",
        "c" => "♥",
        _ => card.suit.as_str(),
    };
    format!("{}{}", tlmn_rank_label_inner(card.rank), suit)
}

#[napi]
pub fn tlmn_create_deck() -> Vec<SamCard> { tlmn_create_deck_inner() }

#[napi]
pub fn tlmn_normalize_text(value: String) -> String { tlmn_normalize_text_inner(&value) }

#[napi]
pub fn tlmn_card_code(card: SamCard) -> String { tlmn_card_code_inner(&card) }

#[napi]
pub fn tlmn_parse_card_code(value: String) -> Option<SamCard> { tlmn_parse_card_code_inner(&value) }

#[napi]
pub fn tlmn_compare_cards(left: SamCard, right: SamCard) -> f64 {
    tlmn_compare_cards_inner(&left, &right)
}

#[napi]
pub fn tlmn_sort_hand(cards: Vec<SamCard>) -> Vec<SamCard> { tlmn_sort_hand_inner(cards) }

#[napi]
pub fn tlmn_parse_rank(value: String) -> Option<u32> { tlmn_parse_rank_inner(&value) }

#[napi]
pub fn tlmn_parse_rank_sequence(value: String) -> Vec<u32> { tlmn_parse_rank_sequence_inner(&value) }

#[napi]
pub fn tlmn_analyze_combo(cards: Vec<SamCard>) -> Option<SamCombo> { tlmn_analyze_combo_inner(cards) }

#[napi]
pub fn tlmn_can_beat(candidate: Option<SamCombo>, current: Option<SamCombo>) -> bool {
    tlmn_can_beat_inner(candidate.as_ref(), current.as_ref())
}

#[napi]
pub fn tlmn_validate_play(
    hand: Vec<SamCard>,
    input_cards: Vec<SamCard>,
    current_combo: Option<SamCombo>,
    must_contain_three_of_spades: bool,
) -> SamValidationResult {
    tlmn_validate_play_inner(hand, input_cards, current_combo, must_contain_three_of_spades)
}

#[napi]
pub fn tlmn_remove_cards(hand: Vec<SamCard>, played_cards: Vec<SamCard>) -> Vec<SamCard> {
    let removed: std::collections::HashSet<String> = played_cards.into_iter().map(|card| card.id).collect();
    hand.into_iter().filter(|card| !removed.contains(&card.id)).collect()
}

#[napi]
pub fn tlmn_detect_white_hand(hand: Vec<SamCard>) -> Option<String> { tlmn_detect_white_hand_inner(hand) }

#[napi]
pub fn tlmn_white_hand_high_card(hand: Vec<SamCard>, kind: String) -> Option<SamCard> {
    tlmn_white_hand_high_card_inner(hand, &kind)
}

#[napi]
pub fn tlmn_white_hand_compare_cards(hand: Vec<SamCard>, kind: String) -> Vec<SamCard> {
    tlmn_white_hand_high_card_inner(hand, &kind).into_iter().collect()
}

#[napi]
pub fn tlmn_compare_white_hands(hand_a: Vec<SamCard>, type_a: String, hand_b: Vec<SamCard>, type_b: String) -> f64 {
    tlmn_compare_white_hands_inner(hand_a, &type_a, hand_b, &type_b)
}

#[napi]
pub fn tlmn_rank_label(rank: f64) -> String { tlmn_rank_label_inner(rank) }

#[napi]
pub fn tlmn_card_label(card: SamCard) -> String { tlmn_card_label_inner(&card) }

#[napi]
pub fn tlmn_format_cards(cards: Vec<SamCard>) -> String {
    tlmn_sort_hand_inner(cards).iter().map(tlmn_card_label_inner).collect::<Vec<_>>().join("  ")
}

#[cfg(test)]
mod tlmn_tests {
    use super::*;

    fn card(rank: f64, suit: &str) -> SamCard {
        SamCard { rank, suit: suit.to_string(), id: format!("{}{}", rank as u32, suit) }
    }

    #[test]
    fn creates_a_deck_and_parses_aliases() {
        let deck = tlmn_create_deck_inner();
        assert_eq!(deck.len(), 52);
        assert_eq!(tlmn_parse_card_code_inner("10dt").unwrap().id, "10ch");
        assert_eq!(tlmn_parse_card_code_inner("At").unwrap().id, "14ch");
        assert_eq!(tlmn_normalize_text_inner("  ĐIỆN THOẠI! "), "dien thoai!");
    }

    #[test]
    fn parses_rank_sequences_and_compares_high_card_suits() {
        assert_eq!(tlmn_parse_rank_inner("j"), Some(11));
        assert_eq!(tlmn_parse_rank_sequence_inner("10JQKA"), vec![10, 11, 12, 13, 14]);
        assert!(tlmn_parse_rank_sequence_inner("345x").is_empty());
        assert!(tlmn_parse_rank_sequence_inner("2 3 4").iter().eq([15, 3, 4].iter()));

        let low = card(9.0, "b");
        let high = card(9.0, "c");
        assert!(tlmn_compare_cards_inner(&high, &low) > 0.0);
    }

    #[test]
    fn analyzes_pair_runs_and_gamevh_chop_rules() {
        let three_pairs: Vec<SamCard> = (3..=5).flat_map(|rank| vec![card(rank as f64, "b"), card(rank as f64, "c")]).collect();
        let four_pairs: Vec<SamCard> = (4..=7).flat_map(|rank| vec![card(rank as f64, "b"), card(rank as f64, "c")]).collect();
        let pair_run_3 = tlmn_analyze_combo_inner(three_pairs).unwrap();
        let pair_run_4 = tlmn_analyze_combo_inner(four_pairs).unwrap();
        let two = tlmn_analyze_combo_inner(vec![card(15.0, "b")]).unwrap();
        assert_eq!(pair_run_3.combo_type, "pairRun");
        assert_eq!(pair_run_3.length, 3);
        assert!(tlmn_can_beat_inner(Some(&pair_run_3), Some(&two)));
        assert_eq!(pair_run_4.length, 4);
        assert!(tlmn_can_beat_inner(Some(&pair_run_4), Some(&two)));
    }

    #[test]
    fn white_hand_detector_prioritizes_dragon_and_pair_runs() {
        let dragon: Vec<SamCard> = (3..=14).map(|rank| card(rank as f64, "b")).chain(vec![card(15.0, "c")]).collect();
        assert_eq!(tlmn_detect_white_hand_inner(dragon.clone()), Some("dragonStraight".to_string()));
        let high = tlmn_white_hand_high_card_inner(dragon, "dragonStraight").unwrap();
        assert_eq!(high.rank, 14.0);

        let six_pair_run: Vec<SamCard> = (3..=8).flat_map(|rank| vec![card(rank as f64, "b"), card(rank as f64, "c")])
            .chain(vec![card(9.0, "b")]).collect();
        assert_eq!(tlmn_detect_white_hand_inner(six_pair_run), Some("sixPairRun".to_string()));
    }
}
