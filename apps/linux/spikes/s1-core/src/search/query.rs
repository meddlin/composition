//! The search bar's `field: value` syntax, parsed the way `searchQuery.ts` does it, character for character. Pure, so it is
//! safe to run on every keystroke. A port of the iPad's `SearchQuery.swift`.

use crate::timestamp::{days_from_civil, days_in_month};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DateField {
    Created,
    Updated,
}

impl DateField {
    fn meili(self) -> &'static str {
        match self {
            DateField::Created => "created_at_ts",
            DateField::Updated => "updated_at_ts",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SearchFilter {
    Tag(String),
    /// `field >= seconds`, in whole seconds since 1970.
    AtLeast(DateField, i64),
    /// `field < seconds`.
    Before(DateField, i64),
}

impl SearchFilter {
    /// The clause in the form the desktop hands to Meilisearch, which is what the conformance run compares.
    pub fn meilisearch_clause(&self) -> String {
        match self {
            SearchFilter::Tag(v) => format!("tags = \"{}\"", v.replace('\\', "\\\\").replace('"', "\\\"")),
            SearchFilter::AtLeast(f, s) => format!("{} >= {s}", f.meili()),
            SearchFilter::Before(f, s) => format!("{} < {s}", f.meili()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedSearchQuery {
    pub text: String,
    pub filters: Vec<SearchFilter>,
    /// Restricts which attributes `text` is matched against (`title`, `description`); None means all.
    pub attributes: Option<Vec<String>>,
}

#[derive(Clone, Copy)]
enum Field {
    Tag,
    Text(&'static str),
    Date(DateField),
}

const FIELDS: &[(&str, Field)] = &[
    ("tag", Field::Tag),
    ("tags", Field::Tag),
    ("title", Field::Text("title")),
    ("description", Field::Text("description")),
    ("created", Field::Date(DateField::Created)),
    ("createdat", Field::Date(DateField::Created)),
    ("createdon", Field::Date(DateField::Created)),
    ("updated", Field::Date(DateField::Updated)),
    ("updatedat", Field::Date(DateField::Updated)),
    ("updatedon", Field::Date(DateField::Updated)),
];

/// JavaScript's `\s` (and `trim`): not the same set as Rust's `char::is_whitespace`.
fn is_space(c: char) -> bool {
    matches!(c as u32, 0x09..=0x0D | 0x20 | 0xA0 | 0x1680 | 0x2000..=0x200A | 0x2028 | 0x2029 | 0x202F | 0x205F | 0x3000 | 0xFEFF)
}

fn trimmed(s: &[char]) -> String {
    let start = s.iter().position(|&c| !is_space(c)).unwrap_or(s.len());
    let end = s.iter().rposition(|&c| !is_space(c)).map(|i| i + 1).unwrap_or(start);
    s[start..end.max(start)].iter().collect()
}

/// ASCII lowercasing is enough: every key is ASCII, and a non-ASCII letter must not turn into one (the Kelvin sign).
fn lower(c: char) -> char {
    if c.is_ascii_uppercase() {
        c.to_ascii_lowercase()
    } else {
        c
    }
}

fn key_at(s: &[char], index: usize) -> Option<(Field, usize)> {
    for (key, field) in FIELDS {
        let k: Vec<char> = key.chars().collect();
        if index + k.len() >= s.len() || s[index + k.len()] != ':' {
            continue;
        }
        if (0..k.len()).all(|i| lower(s[index + i]) == k[i]) {
            let mut next = index + k.len() + 1;
            while next < s.len() && is_space(s[next]) {
                next += 1;
            }
            return Some((*field, next));
        }
    }
    None
}

/// `\s(?:key):` first occurring at or after `from`: the index of that space.
fn next_key(s: &[char], from: usize) -> Option<usize> {
    let mut i = from;
    while i < s.len() {
        if is_space(s[i]) && i + 1 < s.len() {
            for (key, _) in FIELDS {
                let k: Vec<char> = key.chars().collect();
                if i + 1 + k.len() < s.len() && s[i + 1 + k.len()] == ':' && (0..k.len()).all(|j| lower(s[i + 1 + j]) == k[j]) {
                    return Some(i);
                }
            }
        }
        i += 1;
    }
    None
}

fn read_value(s: &[char], from: usize) -> (String, usize) {
    if from < s.len() && s[from] == '"' {
        if let Some(close) = s[from + 1..].iter().position(|&c| c == '"').map(|p| p + from + 1) {
            return (trimmed(&s[from + 1..close]), close + 1);
        }
        return (trimmed(&s[(from + 1).min(s.len())..]), s.len());
    }
    let end = next_key(s, from).unwrap_or(s.len());
    (trimmed(&s[from.min(s.len())..end.max(from.min(s.len()))]), end)
}

fn date_filters(field: DateField, raw: &str) -> Option<Vec<SearchFilter>> {
    let mut rest: Vec<char> = raw.chars().collect();
    let mut op = "=";
    for candidate in [">=", "<=", ">", "<", "="] {
        let c: Vec<char> = candidate.chars().collect();
        if rest.starts_with(&c) {
            op = candidate;
            rest.drain(..c.len());
            break;
        }
    }
    if rest.len() != 10 || rest[4] != '-' || rest[7] != '-' {
        return None;
    }
    let digits = |range: std::ops::Range<usize>| -> Option<i64> {
        let mut v = 0i64;
        for i in range {
            let d = rest[i].to_digit(10).filter(|_| rest[i].is_ascii_digit())?;
            v = v * 10 + d as i64;
        }
        Some(v)
    };
    let (mut year, month, day) = (digits(0..4)?, digits(5..7)?, digits(8..10)?);
    // JavaScript's Date.UTC reads the years 0 to 99 as 1900 to 1999.
    if year < 100 {
        year += 1900;
    }
    // Date.UTC rolls 2026-02-31 over to March; that is malformed here, not a date.
    if !(1..=12).contains(&month) || day < 1 || day > days_in_month(year, month) {
        return None;
    }
    let start = days_from_civil(year, month, day) * 86_400;
    let end = start + 86_400;
    Some(match op {
        ">" => vec![SearchFilter::AtLeast(field, end)],
        ">=" => vec![SearchFilter::AtLeast(field, start)],
        "<" => vec![SearchFilter::Before(field, start)],
        "<=" => vec![SearchFilter::Before(field, end)],
        _ => vec![SearchFilter::AtLeast(field, start), SearchFilter::Before(field, end)],
    })
}

fn collapse_spaces(text: &str) -> String {
    let mut out = String::new();
    let mut prev_space = false;
    for c in text.chars() {
        if is_space(c) {
            if !prev_space {
                out.push(' ');
            }
            prev_space = true;
        } else {
            out.push(c);
            prev_space = false;
        }
    }
    out
}

pub fn parse(raw: &str) -> ParsedSearchQuery {
    let s: Vec<char> = raw.chars().collect();
    let mut filters = vec![];
    let mut text_attributes: Vec<String> = vec![];
    let mut text_values: Vec<String> = vec![];
    let mut free_text: Vec<String> = vec![];

    let mut i = 0;
    while i < s.len() {
        if is_space(s[i]) {
            i += 1;
            continue;
        }
        let Some((field, value_start)) = key_at(&s, i) else {
            let mut end = i;
            while end < s.len() && !is_space(s[end]) {
                end += 1;
            }
            free_text.push(trimmed(&s[i..end]));
            i = end;
            continue;
        };
        let (value, end) = read_value(&s, value_start);
        let consumed = trimmed(&s[i..end]);
        i = end;
        // A half-typed `tags:` has no value yet: ignore it rather than searching for the word "tags:".
        if value.is_empty() {
            continue;
        }
        match field {
            Field::Tag => filters.push(SearchFilter::Tag(value)),
            Field::Text(attribute) => {
                if !text_attributes.iter().any(|a| a == attribute) {
                    text_attributes.push(attribute.to_string());
                }
                text_values.push(value);
            }
            Field::Date(f) => match date_filters(f, &value) {
                Some(clauses) => filters.extend(clauses),
                // Malformed date: keep it as literal text, so a half-typed date finds nothing instead of dropping the constraint.
                None => free_text.push(consumed),
            },
        }
    }

    let text = text_values
        .iter()
        .chain(free_text.iter())
        .map(|t| trimmed(&t.chars().collect::<Vec<_>>()))
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    ParsedSearchQuery { text: collapse_spaces(&text), filters, attributes: if text_attributes.is_empty() { None } else { Some(text_attributes) } }
}
