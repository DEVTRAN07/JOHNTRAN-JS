use napi_derive::napi;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Mutex;

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


fn permission_check_command_role_inner(
    requires_admin: bool,
    requires_admin_or_support: bool,
    is_bot_admin: bool,
    is_support: bool,
) -> bool {
    (requires_admin && !is_bot_admin)
        || (requires_admin_or_support && !is_bot_admin && !is_support)
}

fn permission_evaluate_group_inner(
    is_private_message: bool,
    admin_only: bool,
    support_only: bool,
    box_only: bool,
    is_bot_admin: bool,
    is_support: bool,
    is_group_admin: bool,
) -> i32 {
    if is_private_message {
        return 0;
    }
    if admin_only && !is_bot_admin {
        return 1;
    }
    if support_only && !is_support && !is_bot_admin {
        return 2;
    }
    if box_only && !is_group_admin && !is_bot_admin {
        return 3;
    }
    0
}

fn permission_resolve_group_admin_state_inner(
    group_info_present: bool,
    has_user_id: bool,
    creator_matches: bool,
    admin_list_matches: bool,
) -> i32 {
    if !group_info_present {
        return -1;
    }
    if has_user_id && (creator_matches || admin_list_matches) {
        1
    } else {
        0
    }
}

#[napi]
pub fn permission_check_command_role(
    requires_admin: bool,
    requires_admin_or_support: bool,
    is_bot_admin: bool,
    is_support: bool,
) -> bool {
    permission_check_command_role_inner(
        requires_admin,
        requires_admin_or_support,
        is_bot_admin,
        is_support,
    )
}

#[napi]
pub fn permission_evaluate_group(
    is_private_message: bool,
    admin_only: bool,
    support_only: bool,
    box_only: bool,
    is_bot_admin: bool,
    is_support: bool,
    is_group_admin: bool,
) -> i32 {
    permission_evaluate_group_inner(
        is_private_message,
        admin_only,
        support_only,
        box_only,
        is_bot_admin,
        is_support,
        is_group_admin,
    )
}

#[napi]
pub fn permission_resolve_group_admin_state(
    group_info_present: bool,
    has_user_id: bool,
    creator_matches: bool,
    admin_list_matches: bool,
) -> i32 {
    permission_resolve_group_admin_state_inner(
        group_info_present,
        has_user_id,
        creator_matches,
        admin_list_matches,
    )
}

#[cfg(test)]
mod permission_policy_tests {
    use super::*;

    #[test]
    fn command_role_gate_preserves_admin_and_support_levels() {
        assert!(permission_check_command_role_inner(true, false, false, false));
        assert!(!permission_check_command_role_inner(true, false, true, false));
        assert!(permission_check_command_role_inner(false, true, false, false));
        assert!(!permission_check_command_role_inner(false, true, false, true));
        assert!(!permission_check_command_role_inner(false, false, false, false));
    }

    #[test]
    fn group_permission_order_is_private_then_admin_then_support_then_box() {
        assert_eq!(permission_evaluate_group_inner(true, true, true, true, false, false, false), 0);
        assert_eq!(permission_evaluate_group_inner(false, true, true, true, false, false, false), 1);
        assert_eq!(permission_evaluate_group_inner(false, false, true, true, false, false, false), 2);
        assert_eq!(permission_evaluate_group_inner(false, false, false, true, false, false, false), 3);
        assert_eq!(permission_evaluate_group_inner(false, true, true, true, true, true, false), 0);
        assert_eq!(permission_evaluate_group_inner(false, false, false, true, false, false, true), 0);
    }

    #[test]
    fn group_admin_resolution_keeps_unknown_false_and_true_as_distinct_states() {
        assert_eq!(permission_resolve_group_admin_state_inner(false, true, true, true), -1);
        assert_eq!(permission_resolve_group_admin_state_inner(true, false, true, true), 0);
        assert_eq!(permission_resolve_group_admin_state_inner(true, true, false, false), 0);
        assert_eq!(permission_resolve_group_admin_state_inner(true, true, true, false), 1);
        assert_eq!(permission_resolve_group_admin_state_inner(true, true, false, true), 1);
    }
}


#[napi(object)]
pub struct RestartPlanNative {
    pub timestamps: Vec<f64>,
    pub attempts: f64,
    pub delay_ms: f64,
    pub cooldown: bool,
}

fn restart_plan_inner(
    history: Vec<f64>,
    now: f64,
    window_ms: f64,
    max_attempts: f64,
    base_delay_ms: f64,
    max_delay_ms: f64,
) -> RestartPlanNative {
    let cutoff = now - window_ms;
    let mut timestamps: Vec<f64> = history
        .into_iter()
        .filter(|timestamp| timestamp.is_finite() && *timestamp > cutoff && *timestamp <= now)
        .collect();
    timestamps.push(now);

    let attempts = timestamps.len() as f64;
    if attempts > max_attempts {
        let next_allowed_at = timestamps.first().copied().unwrap_or(now) + window_ms + 1.0;
        return RestartPlanNative {
            timestamps,
            attempts,
            delay_ms: (next_allowed_at - now).max(1000.0),
            cooldown: true,
        };
    }

    let exponent = (attempts - 1.0).max(0.0);
    let exponential_delay = base_delay_ms * 2.0_f64.powf(exponent);
    RestartPlanNative {
        timestamps,
        attempts,
        delay_ms: exponential_delay.min(max_delay_ms),
        cooldown: false,
    }
}

#[napi]
pub fn restart_plan(
    history: Vec<f64>,
    now: f64,
    window_ms: f64,
    max_attempts: f64,
    base_delay_ms: f64,
    max_delay_ms: f64,
) -> RestartPlanNative {
    restart_plan_inner(history, now, window_ms, max_attempts, base_delay_ms, max_delay_ms)
}

#[cfg(test)]
mod restart_policy_tests {
    use super::*;

    #[test]
    fn restart_backoff_is_exponential_and_capped() {
        let first = restart_plan_inner(vec![], 1000.0, 600_000.0, 5.0, 1000.0, 15000.0);
        assert_eq!(first.attempts, 1.0);
        assert_eq!(first.delay_ms, 1000.0);
        assert!(!first.cooldown);

        let second = restart_plan_inner(first.timestamps, 1200.0, 600_000.0, 5.0, 1000.0, 15000.0);
        assert_eq!(second.attempts, 2.0);
        assert_eq!(second.delay_ms, 2000.0);

        let third = restart_plan_inner(second.timestamps, 1500.0, 600_000.0, 5.0, 1000.0, 15000.0);
        assert_eq!(third.attempts, 3.0);
        assert_eq!(third.delay_ms, 4000.0);
    }

    #[test]
    fn cooldown_uses_the_oldest_retained_timestamp_and_minimum_one_second() {
        let plan = restart_plan_inner(
            vec![100.0, 200.0, 300.0, 400.0, 500.0],
            600.0,
            10_000.0,
            5.0,
            1000.0,
            15000.0,
        );
        assert_eq!(plan.attempts, 6.0);
        assert_eq!(plan.delay_ms, 9501.0);
        assert!(plan.cooldown);
    }

    #[test]
    fn filtering_is_strict_and_preserves_input_order() {
        let plan = restart_plan_inner(
            vec![100.0, 950.0, 1200.0, f64::NAN, f64::INFINITY, 900.0],
            1000.0,
            500.0,
            5.0,
            1000.0,
            15000.0,
        );
        assert_eq!(plan.timestamps, vec![950.0, 900.0, 1000.0]);
        assert_eq!(plan.attempts, 3.0);
    }

    #[test]
    fn zero_base_or_max_delay_is_valid_and_not_forced_to_default() {
        let plan = restart_plan_inner(vec![], 1000.0, 500.0, 5.0, 0.0, 0.0);
        assert_eq!(plan.delay_ms, 0.0);
        assert!(!plan.cooldown);
    }
}


#[napi(object)]
pub struct HttpRequestPolicyNative {
    pub timeout_ms: f64,
    pub retries: f64,
    pub delay_ms: f64,
    pub max_delay_ms: f64,
}

fn request_bounded_integer_inner(
    parsed: f64,
    valid: bool,
    min: f64,
    max: f64,
    fallback: f64,
) -> f64 {
    if !valid {
        return fallback;
    }
    min.max(max.min(parsed))
}

fn request_policy_inner(
    configured_timeout: f64,
    configured_timeout_valid: bool,
    environment_timeout: f64,
    environment_timeout_valid: bool,
    configured_retries: f64,
    configured_retries_valid: bool,
    environment_retries: f64,
    environment_retries_valid: bool,
    environment_delay: f64,
    environment_delay_valid: bool,
    configured_delay: f64,
    configured_delay_valid: bool,
) -> HttpRequestPolicyNative {
    let configured_timeout = request_bounded_integer_inner(
        configured_timeout, configured_timeout_valid, 1000.0, 15000.0, 8000.0
    );
    let timeout_ms = request_bounded_integer_inner(
        environment_timeout, environment_timeout_valid, 1000.0, 15000.0, configured_timeout
    );

    let configured_retries = request_bounded_integer_inner(
        configured_retries, configured_retries_valid, 0.0, 1.0, 0.0
    );
    let retries = request_bounded_integer_inner(
        environment_retries, environment_retries_valid, 0.0, 1.0, configured_retries
    );

    let configured_delay = request_bounded_integer_inner(
        configured_delay, configured_delay_valid, 50.0, 1000.0, 250.0
    );
    let delay_ms = request_bounded_integer_inner(
        environment_delay, environment_delay_valid, 50.0, 1000.0, configured_delay
    );

    HttpRequestPolicyNative {
        timeout_ms,
        retries,
        delay_ms,
        max_delay_ms: 1500.0_f64.min(delay_ms.max(delay_ms * 2.0)),
    }
}

#[napi]
pub fn request_bounded_integer(
    parsed: f64,
    valid: bool,
    min: f64,
    max: f64,
    fallback: f64,
) -> f64 {
    request_bounded_integer_inner(parsed, valid, min, max, fallback)
}

#[napi]
pub fn resolve_http_request_policy(
    configured_timeout: f64,
    configured_timeout_valid: bool,
    environment_timeout: f64,
    environment_timeout_valid: bool,
    configured_retries: f64,
    configured_retries_valid: bool,
    environment_retries: f64,
    environment_retries_valid: bool,
    environment_delay: f64,
    environment_delay_valid: bool,
    configured_delay: f64,
    configured_delay_valid: bool,
) -> HttpRequestPolicyNative {
    request_policy_inner(
        configured_timeout,
        configured_timeout_valid,
        environment_timeout,
        environment_timeout_valid,
        configured_retries,
        configured_retries_valid,
        environment_retries,
        environment_retries_valid,
        environment_delay,
        environment_delay_valid,
        configured_delay,
        configured_delay_valid,
    )
}

#[cfg(test)]
mod http_request_policy_tests {
    use super::*;

    #[test]
    fn request_policy_uses_legacy_defaults_and_clamps_all_ranges() {
        let policy = request_policy_inner(
            0.0, false,
            0.0, false,
            0.0, false,
            0.0, false,
            0.0, false,
            0.0, false,
        );
        assert_eq!(policy.timeout_ms, 8000.0);
        assert_eq!(policy.retries, 0.0);
        assert_eq!(policy.delay_ms, 250.0);
        assert_eq!(policy.max_delay_ms, 500.0);

        let configured = request_policy_inner(
            60000.0, true,
            0.0, false,
            3.0, true,
            0.0, false,
            0.0, false,
            2500.0, true,
        );
        assert_eq!(configured.timeout_ms, 15000.0);
        assert_eq!(configured.retries, 1.0);
        assert_eq!(configured.delay_ms, 1000.0);
        assert_eq!(configured.max_delay_ms, 1500.0);
    }

    #[test]
    fn valid_environment_values_override_configured_values() {
        let policy = request_policy_inner(
            4000.0, true,
            5000.0, true,
            1.0, true,
            0.0, true,
            120.0, true,
            800.0, true,
        );
        assert_eq!(policy.timeout_ms, 5000.0);
        assert_eq!(policy.retries, 0.0);
        assert_eq!(policy.delay_ms, 120.0);
        assert_eq!(policy.max_delay_ms, 240.0);
    }

    #[test]
    fn invalid_environment_values_fall_back_to_configured_values() {
        let policy = request_policy_inner(
            5000.0, true,
            0.0, false,
            1.0, true,
            2.0, false,
            200.0, true,
            0.0, false,
        );
        assert_eq!(policy.timeout_ms, 5000.0);
        assert_eq!(policy.retries, 1.0);
        assert_eq!(policy.delay_ms, 200.0);
    }

    #[test]
    fn bounded_integer_preserves_fractional_bounds_and_fallback() {
        assert_eq!(request_bounded_integer_inner(2.5, true, 0.5, 2.0, 7.0), 2.0);
        assert_eq!(request_bounded_integer_inner(0.1, true, 0.5, 2.0, 7.0), 0.5);
        assert_eq!(request_bounded_integer_inner(1.0, false, 0.5, 2.0, 7.0), 7.0);
    }
}


struct NativeRateLimiterEntryState {
    generation: u64,
    timestamps: Vec<f64>,
    cursor: usize,
    touched_at: f64,
}

struct NativeRateLimiterState {
    window_ms: f64,
    max: f64,
    max_keys: f64,
    entries: HashMap<String, NativeRateLimiterEntryState>,
    order: BTreeMap<u64, String>,
    next_generation: u64,
    prune_cursor: Option<u64>,
    operations: u64,
}

impl NativeRateLimiterState {
    fn new(window_ms: f64, max: f64, max_keys: f64) -> Self {
        Self {
            window_ms,
            max,
            max_keys,
            entries: HashMap::new(),
            order: BTreeMap::new(),
            next_generation: 0,
            prune_cursor: None,
            operations: 0,
        }
    }

    fn prune(&mut self, now: f64, force: bool) -> usize {
        let batch_size = if force { 1024usize } else { 256usize };
        let start = match self.prune_cursor {
            Some(cursor) => cursor,
            None => match self.order.keys().next().copied() {
                Some(generation) => generation,
                None => {
                    self.prune_cursor = None;
                    return 0;
                }
            },
        };

        let candidates: Vec<(u64, String)> = self.order
            .range(start..)
            .take(batch_size)
            .map(|(generation, key)| (*generation, key.clone()))
            .collect();

        if candidates.is_empty() {
            self.prune_cursor = None;
            return 0;
        }

        for (generation, key) in &candidates {
            let expired = self.entries.get(key)
                .map(|entry| now - entry.touched_at > self.window_ms)
                .unwrap_or(false);
            if expired {
                self.entries.remove(key);
                self.order.remove(generation);
            }
        }

        if candidates.len() < batch_size {
            // The Map iterator would have observed done within this pass.
            self.prune_cursor = None;
        } else {
            // It stops exactly at the bounded batch; done is discovered only
            // on the following prune call, matching the old JS iterator.
            self.prune_cursor = candidates.last().and_then(|(generation, _)| generation.checked_add(1));
        }

        candidates.len()
    }

    fn allow(&mut self, key: String, now: f64) -> bool {
        if key.is_empty() {
            return false;
        }

        if !self.entries.contains_key(&key) {
            if (self.entries.len() as f64) >= self.max_keys {
                self.prune(now, true);
                if (self.entries.len() as f64) >= self.max_keys {
                    if let Some(generation) = self.order.keys().next().copied() {
                        if let Some(oldest_key) = self.order.remove(&generation) {
                            self.entries.remove(&oldest_key);
                        }
                    }
                }
            }

            let generation = self.next_generation;
            self.next_generation = self.next_generation.saturating_add(1);
            self.order.insert(generation, key.clone());
            self.entries.insert(key.clone(), NativeRateLimiterEntryState {
                generation,
                timestamps: Vec::new(),
                cursor: 0,
                touched_at: now,
            });
        }

        let entry = match self.entries.get_mut(&key) {
            Some(entry) => entry,
            None => return false,
        };

        while entry.cursor < entry.timestamps.len()
            && now - entry.timestamps[entry.cursor] > self.window_ms
        {
            entry.cursor += 1;
        }

        if ((entry.timestamps.len() - entry.cursor) as f64) >= self.max {
            entry.touched_at = now;
            return false;
        }

        entry.timestamps.push(now);
        entry.touched_at = now;
        if entry.cursor >= 64 && entry.cursor * 2 >= entry.timestamps.len() {
            entry.timestamps = entry.timestamps[entry.cursor..].to_vec();
            entry.cursor = 0;
        }

        self.operations = self.operations.wrapping_add(1);
        if (self.operations & 1023) == 0 {
            self.prune(now, false);
        }
        true
    }
}

#[napi(object)]
pub struct NativeRateLimiterEntrySnapshot {
    pub key: String,
    pub timestamps: Vec<f64>,
    pub cursor: u32,
    pub touched_at: f64,
}

#[napi(object)]
pub struct NativeRateLimiterSnapshot {
    pub entries: Vec<NativeRateLimiterEntrySnapshot>,
    pub operations: f64,
    pub has_prune_cursor: bool,
    pub prune_cursor_next_key: Option<String>,
}

#[napi]
pub struct NativeSlidingWindowLimiter {
    state: Mutex<NativeRateLimiterState>,
}

#[napi]
impl NativeSlidingWindowLimiter {
    #[napi(constructor)]
    pub fn new(window_ms: f64, max: f64, max_keys: f64) -> Self {
        Self {
            state: Mutex::new(NativeRateLimiterState::new(window_ms, max, max_keys)),
        }
    }

    #[napi]
    pub fn allow(&self, key: String, now: f64) -> bool {
        let mut state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        state.allow(key, now)
    }

    #[napi]
    pub fn prune(&self, now: f64, force: bool) {
        let mut state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        state.prune(now, force);
    }

    #[napi]
    pub fn clear(&self) {
        let mut state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        state.entries.clear();
        state.order.clear();
        state.prune_cursor = None;
        // Match the legacy limiter: clear() does not reset its operation count.
    }

    #[napi(getter)]
    pub fn size(&self) -> u32 {
        let state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        state.entries.len().min(u32::MAX as usize) as u32
    }

    #[napi(getter)]
    pub fn operations(&self) -> f64 {
        let state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        state.operations as f64
    }

    #[napi(getter)]
    pub fn has_prune_cursor(&self) -> bool {
        let state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        state.prune_cursor.is_some()
    }

    #[napi]
    pub fn has_key(&self, key: String) -> bool {
        let state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        state.entries.contains_key(&key)
    }

    #[napi]
    pub fn snapshot(&self) -> NativeRateLimiterSnapshot {
        let state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let entries = state.order.iter().filter_map(|(generation, key)| {
            let entry = state.entries.get(key)?;
            if entry.generation != *generation {
                return None;
            }
            Some(NativeRateLimiterEntrySnapshot {
                key: key.clone(),
                timestamps: entry.timestamps.clone(),
                cursor: entry.cursor.min(u32::MAX as usize) as u32,
                touched_at: entry.touched_at,
            })
        }).collect();
        let prune_cursor_next_key = state.prune_cursor.and_then(|cursor| {
            state.order.range(cursor..).next().map(|(_, key)| key.clone())
        });
        NativeRateLimiterSnapshot {
            entries,
            operations: state.operations as f64,
            has_prune_cursor: state.prune_cursor.is_some(),
            prune_cursor_next_key,
        }
    }
}

#[cfg(test)]
mod native_rate_limiter_tests {
    use super::*;

    #[test]
    fn allows_max_requests_then_blocks_and_expires_strictly_after_window() {
        let mut limiter = NativeRateLimiterState::new(10_000.0, 2.0, 100.0);
        assert!(limiter.allow("u1".to_string(), 1000.0));
        assert!(limiter.allow("u1".to_string(), 2000.0));
        assert!(!limiter.allow("u1".to_string(), 3000.0));
        assert!(!limiter.allow("u1".to_string(), 11000.0));
        assert!(limiter.allow("u1".to_string(), 11001.0));
    }

    #[test]
    fn capacity_cleanup_prunes_expired_keys_before_evicting_a_live_key() {
        let mut limiter = NativeRateLimiterState::new(1000.0, 1.0, 2.0);
        assert!(limiter.allow("old-a".to_string(), 1000.0));
        assert!(limiter.allow("old-b".to_string(), 1000.0));
        assert!(limiter.allow("new-live".to_string(), 5000.0));
        assert!(!limiter.entries.contains_key("old-a"));
        assert!(!limiter.entries.contains_key("old-b"));
        assert!(limiter.entries.contains_key("new-live"));
        assert_eq!(limiter.entries.len(), 1);
    }

    #[test]
    fn prune_runs_in_bounded_rotating_batches_and_resets_after_done() {
        let mut limiter = NativeRateLimiterState::new(1000.0, 1.0, 2000.0);
        for index in 0..700 {
            assert!(limiter.allow(format!("idle-{}", index), 1000.0));
        }
        limiter.prune(2001.0, false);
        assert_eq!(limiter.entries.len(), 444);
        assert!(limiter.prune_cursor.is_some());
        limiter.prune(2001.0, false);
        assert_eq!(limiter.entries.len(), 188);
        assert!(limiter.prune_cursor.is_some());
        limiter.prune(2001.0, false);
        assert_eq!(limiter.entries.len(), 0);
        assert!(limiter.prune_cursor.is_none());
    }

    #[test]
    fn clear_resets_entries_and_prune_cursor_without_resetting_operations() {
        let mut limiter = NativeRateLimiterState::new(1000.0, 1.0, 1000.0);
        for index in 0..400 {
            assert!(limiter.allow(format!("cursor-{}", index), 1000.0));
        }
        limiter.prune(2001.0, false);
        assert!(limiter.prune_cursor.is_some());
        let operations = limiter.operations;
        limiter.entries.clear();
        limiter.order.clear();
        limiter.prune_cursor = None;
        assert!(limiter.entries.is_empty());
        assert!(limiter.prune_cursor.is_none());
        assert_eq!(limiter.operations, operations);
    }
}


#[napi(object)]
pub struct SoundCloudScriptSource {
    pub script: Option<String>,
    pub url: String,
}

fn replace_ascii_case_insensitive(source: &str, needle: &str, replacement: &str) -> String {
    let bytes = source.as_bytes();
    let needle_bytes = needle.as_bytes();
    let mut output = String::with_capacity(source.len());
    let mut cursor = 0usize;

    while cursor < bytes.len() {
        let end = cursor.saturating_add(needle_bytes.len());
        let matches = end <= bytes.len()
            && bytes[cursor..end].iter().zip(needle_bytes.iter())
                .all(|(left, right)| left.eq_ignore_ascii_case(right));
        if matches {
            output.push_str(replacement);
            cursor = end;
        } else {
            let character = source[cursor..].chars().next().unwrap_or('\0');
            output.push(character);
            cursor += character.len_utf8().max(1);
        }
    }
    output
}

fn normalize_soundcloud_source(source: &str) -> String {
    let escaped_ampersands = replace_ascii_case_insensitive(source, "\\u0026", "&");
    let escaped_equals = replace_ascii_case_insensitive(&escaped_ampersands, "\\x3d", "=");
    replace_ascii_case_insensitive(&escaped_equals, "&amp;", "&")
}

fn starts_with_ascii_case_insensitive_at(source: &str, position: usize, needle: &str) -> bool {
    let bytes = source.as_bytes();
    let needle_bytes = needle.as_bytes();
    let end = position.saturating_add(needle_bytes.len());
    end <= bytes.len()
        && bytes[position..end].iter().zip(needle_bytes.iter())
            .all(|(left, right)| left.eq_ignore_ascii_case(right))
}

fn find_ascii_case_insensitive_from(source: &str, needle: &str, start: usize) -> Option<usize> {
    source.char_indices()
        .filter(|(position, _)| *position >= start)
        .find_map(|(position, _)| {
            starts_with_ascii_case_insensitive_at(source, position, needle)
                .then_some(position)
        })
}

fn skip_js_whitespace(source: &str, mut position: usize) -> usize {
    while position < source.len() {
        let character = match source[position..].chars().next() {
            Some(character) => character,
            None => break,
        };
        if !is_js_whitespace(character) {
            break;
        }
        position += character.len_utf8();
    }
    position
}

fn read_client_id_at(source: &str, position: usize) -> Option<String> {
    let bytes = source.as_bytes();
    let end = position.checked_add(32)?;
    let candidate = bytes.get(position..end)?;
    if !candidate.iter().all(|byte| byte.is_ascii_alphanumeric()) {
        return None;
    }
    String::from_utf8(candidate.to_vec()).ok()
}

fn extract_soundcloud_client_id_from_normalized(source: &str) -> Option<String> {
    let bytes = source.as_bytes();

    // Regex 1: [?&]client_id=([A-Za-z0-9]{32})
    let mut cursor = 0usize;
    while let Some(absolute) = find_ascii_case_insensitive_from(source, "client_id", cursor) {
        // Use an ASCII-insensitive scan for mixed-case spellings.
        if starts_with_ascii_case_insensitive_at(source, absolute, "client_id") &&
            absolute > 0 &&
            matches!(bytes[absolute - 1], b'?' | b'&')
        {
            let value_start = absolute + "client_id=".len();
            if bytes.get(absolute + "client_id".len()) == Some(&b'=') {
                if let Some(value) = read_client_id_at(source, value_start) {
                    return Some(value);
                }
            }
        }
        cursor = absolute.saturating_add(1);
        if cursor >= source.len() {
            break;
        }
    }

    // Regex 2: (client_id|clientId)\s*[=:]\s*["']?([A-Za-z0-9]{32})
    for (position, _) in source.char_indices() {
        let key_len = if starts_with_ascii_case_insensitive_at(source, position, "client_id") {
            9
        } else if starts_with_ascii_case_insensitive_at(source, position, "clientId") {
            8
        } else {
            continue;
        };
        let mut value_position = skip_js_whitespace(source, position + key_len);
        if !matches!(bytes.get(value_position), Some(b'=') | Some(b':')) {
            continue;
        }
        value_position += 1;
        value_position = skip_js_whitespace(source, value_position);
        if matches!(bytes.get(value_position), Some(b'\'') | Some(b'"')) {
            value_position += 1;
        }
        if let Some(value) = read_client_id_at(source, value_position) {
            return Some(value);
        }
    }

    // Regex 3: quoted object key, colon, quoted 32-character value.
    for (position, _) in source.char_indices() {
        match bytes.get(position) {
            Some(b'\'') | Some(b'"') => {}
            _ => continue,
        }
        let key_position = position + 1;
        let key_len = if starts_with_ascii_case_insensitive_at(source, key_position, "client_id") {
            9usize
        } else if starts_with_ascii_case_insensitive_at(source, key_position, "clientId") {
            8usize
        } else {
            continue;
        };
        let closing_key_quote = key_position + key_len;
        if !matches!(bytes.get(closing_key_quote), Some(b'\'') | Some(b'"')) {
            continue;
        }
        let mut value_position = skip_js_whitespace(source, closing_key_quote + 1);
        if bytes.get(value_position) != Some(&b':') {
            continue;
        }
        value_position = skip_js_whitespace(source, value_position + 1);
        if !matches!(bytes.get(value_position), Some(b'\'') | Some(b'"')) {
            continue;
        }
        value_position += 1;
        if let Some(value) = read_client_id_at(source, value_position) {
            if matches!(bytes.get(value_position + 32), Some(b'\'') | Some(b'"')) {
                return Some(value);
            }
        }
    }

    // Regex 4: client_id%3[dD]([A-Za-z0-9]{32})
    let mut cursor = 0usize;
    while cursor < source.len() {
        let position = match find_ascii_case_insensitive_from(source, "client_id", cursor) {
            Some(position) => position,
            None => break,
        };
        let delimiter = position + "client_id".len();
        if starts_with_ascii_case_insensitive_at(source, delimiter, "%3d") {
            if let Some(value) = read_client_id_at(source, delimiter + 3) {
                return Some(value);
            }
        }
        cursor = position + 1;
    }

    None
}

fn extract_soundcloud_client_id(source: &str) -> Option<String> {
    let normalized = normalize_soundcloud_source(source);
    extract_soundcloud_client_id_from_normalized(&normalized)
}

#[napi]
pub fn soundcloud_extract_client_id(
    sources: Vec<SoundCloudScriptSource>,
) -> Option<String> {
    // Preserve the JS adapter's order: each bundle's body is checked first,
    // followed by that bundle URL, before moving to the next bundle.
    for source in sources {
        if let Some(script) = source.script {
            if let Some(client_id) = extract_soundcloud_client_id(&script) {
                return Some(client_id);
            }
        }
        if let Some(client_id) = extract_soundcloud_client_id(&source.url) {
            return Some(client_id);
        }
    }
    None
}

#[cfg(test)]
mod soundcloud_client_id_tests {
    use super::*;

    fn id(value: &str) -> String {
        value.to_string()
    }

    #[test]
    fn parser_matches_query_assignment_object_and_percent_encoded_patterns() {
        let first = "0123456789abcdef0123456789abcdef";
        let second = "abcdef0123456789abcdef0123456789";
        assert_eq!(
            extract_soundcloud_client_id(&format!("https://api.soundcloud.com/search?client_id={first}")),
            Some(id(first))
        );
        assert_eq!(
            extract_soundcloud_client_id(&format!("clientId = \"{second}\"")),
            Some(id(second))
        );
        assert_eq!(
            extract_soundcloud_client_id(&format!("{{\"client_id\":\"{second}\"}}")),
            Some(id(second))
        );
        assert_eq!(
            extract_soundcloud_client_id(&format!("client_id%3d{first}")),
            Some(id(first))
        );
    }

    #[test]
    fn quoted_json_pattern_keeps_legacy_independent_quote_matching() {
        let value = "0123456789abcdef0123456789abcdef";
        let source = format!("'client_id\":\"{value}'");
        assert_eq!(
            extract_soundcloud_client_id(&source),
            Some(id(value))
        );
    }

    #[test]
    fn parser_decodes_the_same_escaped_ampersand_equals_and_html_entity_inputs() {
        let value = "0123456789abcdef0123456789abcdef";
        assert_eq!(
            extract_soundcloud_client_id(&format!("x=1\\u0026client_id\\x3d{value}")),
            Some(id(value))
        );
        assert_eq!(
            extract_soundcloud_client_id(&format!("x=1&amp;client_id={value}")),
            Some(id(value))
        );
    }

    #[test]
    fn pattern_priority_matches_javascript_regex_order() {
        let query_id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let assignment_id = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        let source = format!(
            "client_id = '{assignment_id}' later ?client_id={query_id}"
        );
        assert_eq!(
            extract_soundcloud_client_id(&source),
            Some(id(query_id)),
            "the query-parameter regex is tried before the assignment regex"
        );
    }

    #[test]
    fn batch_parser_preserves_per_bundle_body_before_url_and_bundle_order() {
        let first_body = "cccccccccccccccccccccccccccccccc";
        let first_url = "dddddddddddddddddddddddddddddddd";
        let second_body = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
        let sources = vec![
            SoundCloudScriptSource {
                script: Some(format!("client_id='{first_body}'")),
                url: format!("https://cdn.example/script.js?client_id={first_url}"),
            },
            SoundCloudScriptSource {
                script: Some(format!("client_id='{second_body}'")),
                url: "https://cdn.example/other.js".to_string(),
            },
        ];
        assert_eq!(
            soundcloud_extract_client_id(sources),
            Some(id(first_body))
        );
    }

    #[test]
    fn parser_rejects_short_and_non_alphanumeric_values() {
        assert_eq!(extract_soundcloud_client_id("client_id=short"), None);
        assert_eq!(
            extract_soundcloud_client_id("client_id=0123456789abcdef0123456789abcde!"),
            None
        );
    }
}
