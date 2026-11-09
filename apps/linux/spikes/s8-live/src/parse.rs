//! Finds the Live tab's constructs in one line of Markdown: what is drawn styled, and which characters are its marks (the ones
//! hidden away from the caret). A deliberately small scanner (no nesting, no escapes): enough to try the widget, not a Markdown parser.
//! Offsets are characters, relative to the start of the line.

#[derive(Clone, Debug, PartialEq)]
pub enum Kind {
    Heading(u8),
    Rule,
    Bold,
    Italic,
    Strike,
    Code,
    Mark,
    /// `![alt](src)`: the text is hidden and the picture drawn after it.
    Image { alt: String, src: String },
}

#[derive(Clone, Debug)]
pub struct Construct {
    pub kind: Kind,
    /// The whole construct, marks included: what "the caret touches it" is measured against.
    pub start: usize,
    pub end: usize,
    /// The characters hidden while the caret is elsewhere.
    pub marks: Vec<(usize, usize)>,
    /// What gets the construct's style.
    pub content: (usize, usize),
    pub revealed: bool,
}

fn find(chars: &[char], from: usize, pat: &str) -> Option<usize> {
    let p: Vec<char> = pat.chars().collect();
    (from..chars.len().saturating_sub(p.len() - 1)).find(|&i| chars[i..i + p.len()] == p[..])
}

fn starts(chars: &[char], at: usize, pat: &str) -> bool {
    pat.chars().enumerate().all(|(k, c)| chars.get(at + k) == Some(&c))
}

fn plain(kind: Kind, start: usize, end: usize, open: usize, close: usize) -> Construct {
    Construct { kind, start, end, marks: vec![(start, start + open), (end - close, end)], content: (start + open, end - close), revealed: false }
}

pub fn parse_line(line: &str) -> Vec<Construct> {
    let chars: Vec<char> = line.chars().collect();
    let n = chars.len();
    let hashes = chars.iter().take_while(|&&c| c == '#').count();
    if (1..=6).contains(&hashes) && chars.get(hashes) == Some(&' ') {
        return vec![Construct { kind: Kind::Heading(hashes as u8), start: 0, end: n, marks: vec![(0, hashes + 1)], content: (hashes + 1, n), revealed: false }];
    }
    let trimmed: String = chars.iter().collect::<String>().trim().to_string();
    if trimmed.len() >= 3 && (trimmed.chars().all(|c| c == '-') || trimmed.chars().all(|c| c == '*') || trimmed.chars().all(|c| c == '_')) {
        return vec![Construct { kind: Kind::Rule, start: 0, end: n, marks: vec![(0, n)], content: (0, n), revealed: false }];
    }
    let mut out = vec![];
    let mut i = 0;
    while i < n {
        if starts(&chars, i, "![") {
            if let Some(close) = find(&chars, i + 2, "](") {
                if let Some(paren) = find(&chars, close + 2, ")") {
                    let alt: String = chars[i + 2..close].iter().collect();
                    let src: String = chars[close + 2..paren].iter().collect();
                    out.push(Construct { kind: Kind::Image { alt, src }, start: i, end: paren + 1, marks: vec![(i, paren + 1)], content: (i, paren + 1), revealed: false });
                    i = paren + 1;
                    continue;
                }
            }
        }
        if chars[i] == '`' {
            if let Some(close) = find(&chars, i + 1, "`") {
                if close > i + 1 {
                    out.push(plain(Kind::Code, i, close + 1, 1, 1));
                    i = close + 1;
                    continue;
                }
            }
        }
        if starts(&chars, i, "**") {
            if let Some(close) = find(&chars, i + 2, "**") {
                if close > i + 2 {
                    out.push(plain(Kind::Bold, i, close + 2, 2, 2));
                    i = close + 2;
                    continue;
                }
            }
        }
        if starts(&chars, i, "~~") {
            if let Some(close) = find(&chars, i + 2, "~~") {
                if close > i + 2 {
                    out.push(plain(Kind::Strike, i, close + 2, 2, 2));
                    i = close + 2;
                    continue;
                }
            }
        }
        if chars[i] == '*' && chars.get(i + 1) != Some(&'*') {
            if let Some(close) = (i + 1..n).find(|&k| chars[k] == '*' && chars.get(k + 1) != Some(&'*') && chars.get(k.wrapping_sub(1)) != Some(&'*')) {
                if close > i + 1 {
                    out.push(plain(Kind::Italic, i, close + 1, 1, 1));
                    i = close + 1;
                    continue;
                }
            }
        }
        if starts(&chars, i, "<Mark") {
            if let (Some(gt), Some(close)) = (find(&chars, i, ">"), find(&chars, i, "</Mark>")) {
                if gt < close {
                    out.push(Construct { kind: Kind::Mark, start: i, end: close + 7, marks: vec![(i, gt + 1), (close, close + 7)], content: (gt + 1, close), revealed: false });
                    i = close + 7;
                    continue;
                }
            }
        }
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_constructs_and_their_marks() {
        let c = parse_line("Plain **bold** and *it* and `x` ~~s~~ <Mark color=\"green\">hi</Mark>.");
        let kinds: Vec<_> = c.iter().map(|c| c.kind.clone()).collect();
        assert_eq!(kinds, vec![Kind::Bold, Kind::Italic, Kind::Code, Kind::Strike, Kind::Mark]);
        assert_eq!(c[0].marks, vec![(6, 8), (12, 14)]);
        assert_eq!(c[0].content, (8, 12));
    }

    #[test]
    fn headings_rules_and_images_are_whole_line_or_whole_span() {
        assert_eq!(parse_line("## Title")[0].marks, vec![(0, 3)]);
        assert_eq!(parse_line("---")[0].kind, Kind::Rule);
        assert!(matches!(parse_line("![a](app_data/x.png)")[0].kind, Kind::Image { .. }));
        assert!(parse_line("**unfinished").is_empty(), "a mark with no partner is left alone");
        assert!(parse_line("#nospace").is_empty());
    }
}
