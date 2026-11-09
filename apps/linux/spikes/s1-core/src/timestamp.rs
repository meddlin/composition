//! ISO 8601 timestamps as the app writes them (`2026-11-05T12:00:00.000Z`, and `+00:00` forms from older notes), and the
//! civil-calendar arithmetic the search filters need. No time-zone database: every timestamp in the file is UTC or carries
//! its own offset.

use std::time::{SystemTime, UNIX_EPOCH};

/// Days from 1970-01-01 to the given civil date (Howard Hinnant's algorithm).
pub fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => {
            if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 {
                29
            } else {
                28
            }
        }
    }
}

/// Now, as `new Date().toISOString()` writes it.
pub fn now_iso() -> String {
    let ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    iso_from_millis(ms)
}

pub fn iso_from_millis(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let (y, m, d) = civil_from_days(secs.div_euclid(86_400));
    let rem = secs.rem_euclid(86_400);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z", rem / 3600, rem % 3600 / 60, rem % 60, ms.rem_euclid(1000))
}

/// Milliseconds since 1970 for `YYYY-MM-DDTHH:MM:SS[.fff](Z|±HH:MM)`, or None if it is not that.
pub fn milliseconds_from_iso(text: &str) -> Option<i64> {
    let b = text.as_bytes();
    let num = |from: usize, len: usize| -> Option<i64> {
        let s = text.get(from..from + len)?;
        if s.bytes().all(|c| c.is_ascii_digit()) {
            s.parse().ok()
        } else {
            None
        }
    };
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || (b[10] != b'T' && b[10] != b' ') || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let (y, mo, d, h, mi, s) = (num(0, 4)?, num(5, 2)?, num(8, 2)?, num(11, 2)?, num(14, 2)?, num(17, 2)?);
    let mut at = 19;
    let mut millis = 0;
    if b.get(at) == Some(&b'.') {
        let digits = b[at + 1..].iter().take_while(|c| c.is_ascii_digit()).count();
        if digits == 0 {
            return None;
        }
        let frac = &text[at + 1..at + 1 + digits.min(3)];
        millis = frac.parse::<i64>().ok()? * 10_i64.pow(3 - frac.len() as u32);
        at += 1 + digits;
    }
    let offset_minutes = match b.get(at) {
        Some(b'Z') | None => 0,
        Some(&sign @ (b'+' | b'-')) => {
            let (oh, om) = (num(at + 1, 2)?, num(at + 4, 2).or_else(|| num(at + 3, 2))?);
            (if sign == b'+' { 1 } else { -1 }) * (oh * 60 + om)
        }
        _ => return None,
    };
    let days = days_from_civil(y, mo, d);
    Some(((days * 86_400 + h * 3600 + mi * 60 + s) - offset_minutes * 60) * 1000 + millis)
}
