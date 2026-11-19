//! Helpers shared by every data source implementation.

/// Replace the password in a connection URI with `***` for safe display.
pub(crate) fn mask_uri_password(uri: &str) -> String {
    if let Some(proto_end) = uri.find("://") {
        let after_proto = &uri[proto_end + 3..];
        if let Some(at_pos) = after_proto.find('@') {
            let user_info = &after_proto[..at_pos];
            if let Some(colon_pos) = user_info.find(':') {
                let proto = &uri[..proto_end + 3];
                let user = &user_info[..colon_pos];
                let rest = &uri[proto_end + 3 + at_pos..];
                return format!("{}{}:***{}", proto, user, rest);
            }
        }
    }
    uri.to_string()
}

pub(crate) fn sort_names(mut names: Vec<String>) -> Vec<String> {
    names.sort_by_cached_key(|name| name.to_lowercase());
    names
}
