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


fn requester_normalize_uid_inner(value: &str) -> String {
    trim_js(value).to_string()
}

fn requester_includes_uid_inner(values: &[String], uid: &str) -> bool {
    let target = requester_normalize_uid_inner(uid);
    !target.is_empty() && values.iter().any(|value| requester_normalize_uid_inner(value) == target)
}

fn requester_get_admin_ids_inner(
    configured_admins: Vec<String>,
    runtime_admins: Vec<String>,
) -> Vec<String> {
    let mut seen = HashSet::new();
    configured_admins
        .into_iter()
        .chain(runtime_admins)
        .map(|value| requester_normalize_uid_inner(&value))
        .filter(|value| !value.is_empty() && seen.insert(value.clone()))
        .collect()
}

fn requester_get_owner_id_inner(explicit_owner: &str, configured_admins: &[String]) -> String {
    let explicit = requester_normalize_uid_inner(explicit_owner);
    if !explicit.is_empty() {
        return explicit;
    }
    configured_admins
        .iter()
        .map(|value| requester_normalize_uid_inner(value))
        .find(|value| !value.is_empty())
        .unwrap_or_default()
}

fn requester_is_bot_admin_inner(
    uid: &str,
    configured_admins: &[String],
    runtime_admins: &[String],
) -> bool {
    let admins = requester_get_admin_ids_inner(
        configured_admins.to_vec(),
        runtime_admins.to_vec(),
    );
    requester_includes_uid_inner(&admins, uid)
}

fn requester_is_support_user_inner(
    uid: &str,
    runtime_support: &[String],
    configured_support: &[String],
) -> bool {
    requester_includes_uid_inner(
        &runtime_support.iter().chain(configured_support.iter()).cloned().collect::<Vec<_>>(),
        uid,
    )
}

fn requester_is_bot_owner_inner(uid: &str, explicit_owner: &str, configured_admins: &[String]) -> bool {
    let owner = requester_get_owner_id_inner(explicit_owner, configured_admins);
    !owner.is_empty() && owner == requester_normalize_uid_inner(uid)
}

fn requester_role_inner(
    uid: &str,
    explicit_owner: &str,
    configured_admins: Vec<String>,
    runtime_admins: Vec<String>,
    runtime_support: Vec<String>,
    configured_support: Vec<String>,
) -> String {
    let configured_owner_admins = configured_admins.clone();
    if requester_is_bot_owner_inner(uid, explicit_owner, &configured_owner_admins) {
        return "owner".to_string();
    }
    if requester_is_bot_admin_inner(uid, &configured_admins, &runtime_admins) {
        return "admin".to_string();
    }
    if requester_is_support_user_inner(uid, &runtime_support, &configured_support) {
        return "support".to_string();
    }
    "member".to_string()
}

#[napi]
pub fn requester_normalize_uid(value: String) -> String {
    requester_normalize_uid_inner(&value)
}

#[napi]
pub fn requester_includes_uid(values: Vec<String>, uid: String) -> bool {
    requester_includes_uid_inner(&values, &uid)
}

#[napi]
pub fn requester_get_admin_ids(
    configured_admins: Vec<String>,
    runtime_admins: Vec<String>,
) -> Vec<String> {
    requester_get_admin_ids_inner(configured_admins, runtime_admins)
}

#[napi]
pub fn requester_get_bot_owner_id(
    explicit_owner: String,
    configured_admins: Vec<String>,
) -> String {
    requester_get_owner_id_inner(&explicit_owner, &configured_admins)
}

#[napi]
pub fn requester_is_bot_admin(
    uid: String,
    configured_admins: Vec<String>,
    runtime_admins: Vec<String>,
) -> bool {
    requester_is_bot_admin_inner(&uid, &configured_admins, &runtime_admins)
}

#[napi]
pub fn requester_is_support_user(
    uid: String,
    runtime_support: Vec<String>,
    configured_support: Vec<String>,
) -> bool {
    requester_is_support_user_inner(&uid, &runtime_support, &configured_support)
}

#[napi]
pub fn requester_is_bot_owner(
    uid: String,
    explicit_owner: String,
    configured_admins: Vec<String>,
) -> bool {
    requester_is_bot_owner_inner(&uid, &explicit_owner, &configured_admins)
}

#[napi]
pub fn requester_role(
    uid: String,
    explicit_owner: String,
    configured_admins: Vec<String>,
    runtime_admins: Vec<String>,
    runtime_support: Vec<String>,
    configured_support: Vec<String>,
) -> String {
    requester_role_inner(
        &uid,
        &explicit_owner,
        configured_admins,
        runtime_admins,
        runtime_support,
        configured_support,
    )
}

#[cfg(test)]
mod requester_tests {
    use super::*;

    #[test]
    fn uid_normalization_uses_javascript_string_trim_whitespace() {
        assert_eq!(requester_normalize_uid_inner("\u{FEFF} 12345\u{00A0}"), "12345");
        assert_eq!(requester_normalize_uid_inner("\u{0085}12345\u{0085}"), "\u{0085}12345\u{0085}");
        assert_eq!(requester_normalize_uid_inner("  "), "");
    }

    #[test]
    fn admin_ids_are_deduplicated_in_config_then_runtime_order() {
        let result = requester_get_admin_ids_inner(
            vec![" owner ".to_string(), "admin".to_string(), "owner".to_string()],
            vec![" admin ".to_string(), "runtime".to_string(), "".to_string()],
        );
        assert_eq!(result, vec!["owner", "admin", "runtime"]);
    }

    #[test]
    fn explicit_owner_is_preferred_and_runtime_admin_never_becomes_owner() {
        assert_eq!(
            requester_get_owner_id_inner(" explicit ", &vec!["configured".to_string()]),
            "explicit"
        );
        assert_eq!(
            requester_get_owner_id_inner("", &vec!["".to_string(), "primary".to_string(), "second".to_string()]),
            "primary"
        );
        assert!(!requester_is_bot_owner_inner("runtime", "", &vec![]));
    }

    #[test]
    fn role_priority_is_owner_then_admin_then_support_then_member() {
        let config_admins = vec!["owner".to_string(), "both".to_string()];
        let runtime_admins = vec!["admin".to_string(), "both".to_string()];
        let runtime_support = vec!["support".to_string(), "both".to_string()];
        let config_support = vec!["config-support".to_string()];
        let role = |uid: &str| requester_role_inner(
            uid,
            "",
            config_admins.clone(),
            runtime_admins.clone(),
            runtime_support.clone(),
            config_support.clone(),
        );
        assert_eq!(role("owner"), "owner");
        assert_eq!(role("both"), "admin");
        assert_eq!(role("support"), "support");
        assert_eq!(role("config-support"), "support");
        assert_eq!(role("member"), "member");
    }

    #[test]
    fn uid_membership_rejects_empty_targets_and_normalizes_each_value() {
        assert!(requester_includes_uid_inner(&vec![" 123 ".to_string()], "123"));
        assert!(!requester_includes_uid_inner(&vec!["123".to_string()], " "));
        assert!(!requester_includes_uid_inner(&vec![], "123"));
    }
}


const ANTI_PROTECTION_KEYS_RUST: [&str; 21] = [
    "anti_nude",
    "anti_undo",
    "anti_danger_link",
    "anti_sticker_spam",
    "anti_link",
    "anti_spam",
    "anti_card",
    "anti_doodle",
    "anti_file",
    "anti_gif",
    "anti_join",
    "anti_location",
    "anti_other",
    "anti_photo",
    "anti_qr",
    "anti_reaction",
    "anti_sticker",
    "anti_taghide",
    "anti_video",
    "anti_voice",
    "anti_word",
];

#[napi(object)]
pub struct AntiProtectionEntry {
    pub key: String,
    pub enabled: bool,
}

fn anti_is_supported_feature_inner(feature: &str) -> bool {
    ANTI_PROTECTION_KEYS_RUST.contains(&feature)
}

fn anti_protection_state_inner(values: Vec<bool>) -> Vec<AntiProtectionEntry> {
    ANTI_PROTECTION_KEYS_RUST
        .iter()
        .enumerate()
        .map(|(index, key)| AntiProtectionEntry {
            key: (*key).to_string(),
            enabled: values.get(index).copied().unwrap_or(false),
        })
        .collect()
}

#[napi]
pub fn anti_is_supported_feature(feature: String) -> bool {
    anti_is_supported_feature_inner(&feature)
}

#[napi]
pub fn anti_protection_keys() -> Vec<String> {
    ANTI_PROTECTION_KEYS_RUST.iter().map(|key| (*key).to_string()).collect()
}

#[napi]
pub fn anti_protection_state(values: Vec<bool>) -> Vec<AntiProtectionEntry> {
    anti_protection_state_inner(values)
}

#[cfg(test)]
mod anti_protection_tests {
    use super::*;

    #[test]
    fn supported_feature_registry_has_all_twenty_one_flags_in_legacy_order() {
        assert_eq!(ANTI_PROTECTION_KEYS_RUST.len(), 21);
        assert!(anti_is_supported_feature_inner("anti_nude"));
        assert!(anti_is_supported_feature_inner("anti_undo"));
        assert!(anti_is_supported_feature_inner("anti_qr"));
        assert!(anti_is_supported_feature_inner("anti_word"));
        assert!(!anti_is_supported_feature_inner("anti_unknown"));
        assert!(!anti_is_supported_feature_inner("ANTI_LINK"));
    }

    #[test]
    fn strict_state_mapping_preserves_key_order_and_defaults_missing_values_to_off() {
        let entries = anti_protection_state_inner(vec![true, false, true]);
        assert_eq!(entries.len(), 21);
        assert_eq!(entries[0].key, "anti_nude");
        assert!(entries[0].enabled);
        assert_eq!(entries[1].key, "anti_undo");
        assert!(!entries[1].enabled);
        assert_eq!(entries[2].key, "anti_danger_link");
        assert!(entries[2].enabled);
        assert_eq!(entries[20].key, "anti_word");
        assert!(!entries[20].enabled);
    }

    #[test]
    fn state_mapping_ignores_extra_input_values() {
        let values = vec![false; 25];
        let entries = anti_protection_state_inner(values);
        assert_eq!(entries.len(), ANTI_PROTECTION_KEYS_RUST.len());
        assert!(entries.iter().all(|entry| !entry.enabled));
    }
}
