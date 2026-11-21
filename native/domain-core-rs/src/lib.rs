use napi_derive::napi;
use std::collections::HashSet;

#[napi(object)]
pub struct GroupStateSnapshot {
    pub gid: String,
    pub bot_enabled: bool,
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

fn trim_js(value: &str) -> &str {
    value.trim_matches(is_js_whitespace)
}

fn is_allowed_control_inner(command_name: &str, first_arg: &str) -> bool {
    trim_js(command_name).to_lowercase() == "bot"
        && matches!(trim_js(first_arg).to_lowercase().as_str(), "on" | "status")
}

fn is_allowed_control_message_inner(content: &str, prefix: &str) -> bool {
    if prefix.is_empty() {
        return false;
    }
    let Some(remainder) = content.strip_prefix(prefix) else {
        return false;
    };
    let parts: Vec<&str> = trim_js(remainder)
        .split(is_js_whitespace)
        .filter(|part| !part.is_empty())
        .collect();
    let command = parts.first().copied().unwrap_or("");
    let first_arg = parts.get(1).copied().unwrap_or("");
    is_allowed_control_inner(command, first_arg)
}

#[napi]
pub fn group_is_enabled(bot_enabled: bool) -> bool {
    bot_enabled
}

#[napi]
pub fn group_is_allowed_control(command_name: String, first_arg: String) -> bool {
    is_allowed_control_inner(&command_name, &first_arg)
}

#[napi]
pub fn group_is_allowed_control_message(content: String, prefix: String) -> bool {
    is_allowed_control_message_inner(&content, &prefix)
}

#[napi]
pub fn group_can_run_command(
    bot_enabled: bool,
    command_name: String,
    first_arg: String,
) -> bool {
    bot_enabled || is_allowed_control_inner(&command_name, &first_arg)
}

#[napi]
pub fn group_enabled_flags(enabled_ids: Vec<String>, group_ids: Vec<String>) -> Vec<bool> {
    let enabled: HashSet<String> = enabled_ids
        .into_iter()
        .filter(|id| !id.is_empty())
        .collect();
    group_ids
        .into_iter()
        .map(|group_id| !group_id.is_empty() && enabled.contains(&group_id))
        .collect()
}

#[napi]
pub fn group_state_snapshot(
    gids: Vec<String>,
    enabled_flags: Vec<bool>,
) -> Vec<GroupStateSnapshot> {
    gids.into_iter()
        .enumerate()
        .filter_map(|(index, gid)| {
            if gid.is_empty() {
                return None;
            }
            Some(GroupStateSnapshot {
                gid,
                bot_enabled: enabled_flags.get(index).copied().unwrap_or(false),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn control_policy_is_case_insensitive_and_only_allows_on_or_status() {
        assert!(is_allowed_control_inner(" BOT ", "On"));
        assert!(is_allowed_control_inner("bot", "STATUS"));
        assert!(!is_allowed_control_inner("bot", "off"));
        assert!(!is_allowed_control_inner("menu", "on"));
        assert!(!is_allowed_control_inner("", "on"));
    }

    #[test]
    fn message_parser_respects_prefix_and_javascript_whitespace() {
        assert!(is_allowed_control_message_inner("/bot on", "/"));
        assert!(is_allowed_control_message_inner("!BOT\u{FEFF}STATUS", "!"));
        assert!(is_allowed_control_message_inner("::bot\u{00A0}on", "::"));
        assert!(!is_allowed_control_message_inner("bot on", "/"));
        assert!(!is_allowed_control_message_inner("/bot off", "/"));
        assert!(!is_allowed_control_message_inner("/menu on", "/"));
        assert!(!is_allowed_control_message_inner("/bot\u{0085}on", "/"));
        assert!(!is_allowed_control_message_inner("/bot on", ""));
    }

    #[test]
    fn group_enabled_flags_match_ids_without_enabling_empty_ids() {
        let flags = group_enabled_flags(
            vec!["g1".to_string(), "".to_string(), "g3".to_string()],
            vec!["g1".to_string(), "g2".to_string(), "".to_string(), "g3".to_string()],
        );
        assert_eq!(flags, vec![true, false, false, true]);
    }

    #[test]
    fn snapshots_keep_order_and_filter_empty_ids() {
        let result = group_state_snapshot(
            vec!["g1".to_string(), "".to_string(), "g2".to_string()],
            vec![true, true, false],
        );
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].gid, "g1");
        assert!(result[0].bot_enabled);
        assert_eq!(result[1].gid, "g2");
        assert!(!result[1].bot_enabled);
    }

    #[test]
    fn short_flag_arrays_default_missing_snapshot_values_to_off() {
        let result = group_state_snapshot(
            vec!["g1".to_string(), "g2".to_string()],
            vec![true],
        );
        assert_eq!(result.len(), 2);
        assert!(result[0].bot_enabled);
        assert!(!result[1].bot_enabled);
    }
}
