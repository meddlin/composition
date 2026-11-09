//! How far a typed word may be from a word in the notes and still count as a match: Meilisearch's rules (measured against
//! 1.53.1 for the iPad's spike S2). The budget depends on the typed word's length, a swapped pair of neighbouring letters
//! is one edit, and the word being typed (the last one) also matches as the start of a longer word. A wrong, missing or
//! extra *first letter* costs two edits, not one.

use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

/// Edits allowed in a word of `length` letters: none up to 4, one for 5 to 8, two from 9.
pub fn budget(length: usize) -> i32 {
    if length >= 9 {
        2
    } else if length >= 5 {
        1
    } else {
        0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rules {
    /// What a wrong, missing or extra first letter costs, in edits. Meilisearch counts it as two.
    pub first_letter_cost: i32,
    /// Whether a word of 3 or 4 letters is allowed one mistake (Meilisearch allows none up to 4).
    pub short_words_get_one: bool,
}

impl Rules {
    pub const MEILISEARCH: Rules = Rules { first_letter_cost: 2, short_words_get_one: false };
    pub const FORGIVING: Rules = Rules { first_letter_cost: 1, short_words_get_one: false };
    pub const FORGIVING_FALLBACK: Rules = Rules { first_letter_cost: 1, short_words_get_one: true };

    pub fn budget(&self, length: usize) -> i32 {
        if self.short_words_get_one && (3..=4).contains(&length) {
            1
        } else {
            budget(length)
        }
    }
}

/// Lowercase, diacritic-free text, which is how the index stores words (FTS5 `unicode61 remove_diacritics 2`).
pub fn fold(text: &str) -> String {
    text.nfd().filter(|c| !is_combining_mark(*c)).flat_map(|c| c.to_lowercase()).collect()
}

/// The runs of letters and digits in `text`, folded: where the index splits words too.
pub fn words_in(text: &str) -> Vec<String> {
    let mut words = vec![];
    let mut current = String::new();
    for c in fold(text).chars() {
        if c.is_alphanumeric() {
            current.push(c);
        } else if !current.is_empty() {
            words.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        words.push(current);
    }
    words
}

pub fn scalars(text: &str) -> Vec<u32> {
    text.chars().map(|c| c as u32).collect()
}

pub fn text_of(scalars: &[u32]) -> String {
    scalars.iter().filter_map(|&u| char::from_u32(u)).collect()
}

/// The edit distance from `word` to `term`, where swapping two neighbouring letters counts once, or None if over `limit`.
pub fn distance(word: &[u32], term: &[u32], limit: i32, first_letter_cost: i32) -> Option<i32> {
    if (word.len() as i64 - term.len() as i64).abs() > limit as i64 {
        return None;
    }
    search(word, term, limit, false, first_letter_cost).map(|(d, _)| d)
}

/// The smallest edit distance from `word` to any start of `term`, with the shortest such start, or None if over `limit`.
/// This is how the word being typed matches: `kubernet` is 0 from `kubernetes`.
pub fn prefix_distance(word: &[u32], term: &[u32], limit: i32, first_letter_cost: i32) -> Option<(i32, usize)> {
    if term.len() as i64 + (limit as i64) < word.len() as i64 {
        return None;
    }
    search(word, term, limit, true, first_letter_cost)
}

/// Optimal string alignment distance over three rolling rows, giving up once no cell can come back under `limit`.
fn search(a: &[u32], b: &[u32], limit: i32, prefix: bool, first: i32) -> Option<(i32, usize)> {
    let (m, n) = (a.len(), b.len());
    let mut older = vec![0i32; n + 1];
    let mut previous: Vec<i32> = (0..=n).map(|j| if j == 0 { 0 } else { j as i32 - 1 + first }).collect();
    let mut current = vec![0i32; n + 1];
    let mut previous_minimum = 0;

    if m == 0 {
        return if prefix {
            Some((0, 0))
        } else if n as i32 <= limit {
            Some((n as i32, n))
        } else {
            None
        };
    }
    for i in 1..=m {
        current[0] = i as i32 - 1 + first;
        let mut minimum = current[0];
        for j in 1..=n {
            let substitution = if a[i - 1] == b[j - 1] { 0 } else if i == 1 { first } else { 1 };
            let mut best = (previous[j] + 1).min(current[j - 1] + 1).min(previous[j - 1] + substitution);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                best = best.min(older[j - 2] + if i == 2 { first } else { 1 });
            }
            current[j] = best;
            if best < minimum {
                minimum = best;
            }
        }
        if minimum > limit && previous_minimum > limit {
            return None;
        }
        previous_minimum = minimum;
        std::mem::swap(&mut older, &mut previous);
        std::mem::swap(&mut previous, &mut current);
    }
    if !prefix {
        return if previous[n] <= limit { Some((previous[n], n)) } else { None };
    }
    let mut best = (i32::MAX, 0usize);
    for (j, &d) in previous.iter().enumerate() {
        if d < best.0 {
            best = (d, j);
        }
    }
    if best.0 <= limit {
        Some(best)
    } else {
        None
    }
}
