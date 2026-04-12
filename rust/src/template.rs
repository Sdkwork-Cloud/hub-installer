use std::collections::BTreeMap;

pub fn render_template(input: &str, variables: &BTreeMap<String, String>) -> String {
    let mut rendered = input.to_owned();
    for (key, value) in variables {
        let token = format!("{{{{{key}}}}}");
        if rendered.contains(&token) {
            rendered = rendered.replace(&token, value);
        }
    }
    rendered
}

pub fn render_optional(
    input: &Option<String>,
    variables: &BTreeMap<String, String>,
) -> Option<String> {
    input
        .as_ref()
        .map(|value| render_template(value, variables))
}
