use napi::Result;
use napi_derive::napi;

#[napi(object)]
pub struct ParsedCommand {
    pub matched: bool,
    pub command: String,
    pub args: Vec<String>,
}

fn is_js_whitespace(character: char) -> bool {
    character.is_whitespace() || character == '\u{FEFF}'
}

fn parse_command_inner(message_text: &str, prefix: &str) -> ParsedCommand {
    if prefix.is_empty() {
        return ParsedCommand { matched: false, command: String::new(), args: Vec::new() };
    }

    let Some(remainder) = message_text.strip_prefix(prefix) else {
        return ParsedCommand { matched: false, command: String::new(), args: Vec::new() };
    };

    let remainder = remainder.trim_matches(is_js_whitespace);
    if remainder.is_empty() {
        return ParsedCommand { matched: true, command: String::new(), args: Vec::new() };
    }

    let mut tokens = remainder.split(is_js_whitespace).filter(|token| !token.is_empty());
    let command = tokens.next().unwrap_or_default().to_lowercase();
    let args = tokens.map(str::to_owned).collect();

    ParsedCommand { matched: true, command, args }
}

/// Keep parity with the legacy JavaScript split(/\s+/) command-token contract.
#[napi]
pub fn parse_command(message_text: String, prefix: String) -> Result<ParsedCommand> {
    Ok(parse_command_inner(&message_text, &prefix))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_command_and_arguments_like_legacy_pipeline() {
        let parsed = parse_command_inner("/SCL   Sơn Tùng --format=aac", "/");
        assert!(parsed.matched);
        assert_eq!(parsed.command, "scl");
        assert_eq!(parsed.args, vec!["Sơn", "Tùng", "--format=aac"]);
    }

    #[test]
    fn supports_bom_and_unicode_whitespace() {
        let parsed = parse_command_inner("/\u{FEFF}MENU\u{00A0}xin chào", "/");
        assert!(parsed.matched);
        assert_eq!(parsed.command, "menu");
        assert_eq!(parsed.args, vec!["xin", "chào"]);
    }

    #[test]
    fn prefix_only_message_has_no_command() {
        let parsed = parse_command_inner("/ \t\n", "/");
        assert!(parsed.matched);
        assert!(parsed.command.is_empty());
        assert!(parsed.args.is_empty());
    }

    #[test]
    fn rejects_messages_without_a_nonempty_prefix() {
        assert!(!parse_command_inner("hello", "/").matched);
        assert!(!parse_command_inner("/menu", "").matched);
    }

    #[test]
    fn lowercases_vietnamese_command_names() {
        let parsed = parse_command_inner("/ĐĂNG nhập", "/");
        assert_eq!(parsed.command, "đăng");
    }
}
