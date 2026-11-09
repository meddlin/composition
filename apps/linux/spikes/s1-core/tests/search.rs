mod common;

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::Instant;

use composition_core_spike::pass;
use composition_core_spike::search::{parse, SearchIndex, Tolerance};
use serde::Deserialize;

#[derive(Deserialize)]
struct Group {
    name: String,
    queries: Vec<String>,
}
#[derive(Deserialize)]
struct QueriesFile {
    groups: Vec<Group>,
}
#[derive(Deserialize)]
struct Answer {
    query: String,
    ids: Vec<i64>,
}
#[derive(Deserialize)]
struct Corpus {
    results: Vec<Answer>,
}
#[derive(Deserialize)]
struct Expected {
    meilisearch: String,
    corpora: HashMap<String, Corpus>,
}
#[derive(Deserialize)]
struct ParseExpected {
    text: String,
    filters: Vec<String>,
    #[serde(rename = "attributesToSearchOn")]
    attributes: Option<Vec<String>>,
}

const RESULT_LIMIT: usize = 50;

fn load(corpus: &Path) -> (Vec<Group>, Expected) {
    let groups = serde_json::from_slice::<QueriesFile>(&std::fs::read(corpus.join("search-queries.json")).unwrap()).unwrap().groups;
    let expected = serde_json::from_slice::<Expected>(&std::fs::read(corpus.join("search-expected.json")).unwrap()).unwrap();
    (groups, expected)
}

/// A search index over a copy of the generated notes.
fn index(corpus: &Path, size: &str, scratch: &Path) -> SearchIndex {
    let db = common::copy_to(scratch, &corpus.join(format!("search-corpus-{size}.db")), &format!("composition-{size}.db"));
    let database = pass::open(&db).unwrap();
    let mut index = SearchIndex::open(&scratch.join(format!("search-{size}.db")), Tolerance::MatchesMeilisearch).unwrap();
    let started = Instant::now();
    let n = index.rebuild_from(&database).unwrap();
    eprintln!("search index over {n} notes built in {:.1} ms", started.elapsed().as_secs_f64() * 1000.0);
    index
}

struct Comparison {
    group: String,
    query: String,
    meili: Vec<i64>,
    ours: Vec<i64>,
}

impl Comparison {
    fn set_equal(&self) -> bool {
        self.meili.iter().collect::<HashSet<_>>() == self.ours.iter().collect::<HashSet<_>>()
    }
    fn capped(&self) -> bool {
        self.meili.len() >= RESULT_LIMIT
    }
    fn recall(&self) -> f64 {
        if self.meili.is_empty() {
            return 1.0;
        }
        let ours: HashSet<_> = self.ours.iter().collect();
        self.meili.iter().filter(|i| ours.contains(i)).count() as f64 / self.meili.len() as f64
    }
    fn top_ten_overlap(&self) -> f64 {
        let theirs: HashSet<_> = self.meili.iter().take(10).collect();
        if theirs.is_empty() {
            return 1.0;
        }
        let ours: HashSet<_> = self.ours.iter().take(10).collect();
        theirs.intersection(&ours).count() as f64 / theirs.len() as f64
    }
}

fn compare(index: &SearchIndex, groups: &[Group], expected: &Expected, size: &str) -> Vec<Comparison> {
    let answers: HashMap<&str, &Vec<i64>> = expected.corpora[size].results.iter().map(|a| (a.query.as_str(), &a.ids)).collect();
    groups
        .iter()
        .flat_map(|g| {
            g.queries.iter().map(|q| Comparison {
                group: g.name.clone(),
                query: q.clone(),
                meili: answers.get(q.as_str()).map(|v| (*v).clone()).unwrap_or_default(),
                ours: index.search(q).unwrap(),
            })
        })
        .collect()
}

fn report(title: &str, rows: &[Comparison]) {
    eprintln!("\n{title}");
    eprintln!("  {:<58} queries  same set  recall  top-10", "group");
    let mut order: Vec<&str> = vec![];
    for r in rows {
        if !order.contains(&r.group.as_str()) {
            order.push(&r.group);
        }
    }
    order.push("ALL");
    for name in order {
        let sel: Vec<&Comparison> = rows.iter().filter(|r| name == "ALL" || r.group == name).collect();
        let uncapped: Vec<_> = sel.iter().filter(|r| !r.capped()).collect();
        let with_hits: Vec<_> = sel.iter().filter(|r| !r.meili.is_empty()).collect();
        let mean = |f: &dyn Fn(&&&Comparison) -> f64| if with_hits.is_empty() { 1.0 } else { with_hits.iter().map(f).sum::<f64>() / with_hits.len() as f64 };
        let pct = |part: usize, whole: usize| if whole == 0 { "   -".to_string() } else { format!("{:3}%", (100.0 * part as f64 / whole as f64).round() as i64) };
        eprintln!(
            "  {:<58} {:<7}  {}      {:3}%    {:3}%",
            name,
            sel.len(),
            pct(uncapped.iter().filter(|r| r.set_equal()).count(), uncapped.len()),
            (mean(&|r| r.recall()) * 100.0).round() as i64,
            (mean(&|r| r.top_ten_overlap()) * 100.0).round() as i64
        );
    }
}

#[test]
fn the_query_parser_makes_the_same_text_filters_and_attributes_as_the_desktops_for_every_query() {
    let corpus = need_corpus!();
    let expected: HashMap<String, ParseExpected> = serde_json::from_slice(&std::fs::read(corpus.join("search-parse-expected.json")).unwrap()).unwrap();
    assert!(expected.len() > 200);
    let mut bad = vec![];
    for (query, desktop) in &expected {
        let ours = parse(query);
        let clauses: Vec<String> = ours.filters.iter().map(|f| f.meilisearch_clause()).collect();
        if ours.text != desktop.text || clauses != desktop.filters || ours.attributes != desktop.attributes {
            bad.push(format!("{query:?}: ours {:?} {:?} {:?}, desktop {:?} {:?} {:?}", ours.text, clauses, ours.attributes, desktop.text, desktop.filters, desktop.attributes));
        }
    }
    assert!(bad.is_empty(), "{} of {} differ:\n{}", bad.len(), expected.len(), bad.join("\n"));
    eprintln!("search parser: {} queries, all the same as the desktop's", expected.len());
}

/// The iPad's S2 acceptance criteria, written down before its first run and reused unchanged:
///   A  Queries with no typos: the same set of results as Meilisearch wherever it returned fewer than the cap of 50, and
///      on average at least 8 of its top 10 among our top 10.
///   B  Queries with typos: nothing Meilisearch finds is missed.
///   C  Every query answers in under 200 ms on 1,000 notes.
#[test]
fn acceptance_on_the_100_note_corpus() {
    let corpus = need_corpus!();
    let (groups, expected) = load(&corpus);
    assert!(expected.meilisearch.starts_with("1."));
    let scratch = tempfile::tempdir().unwrap();
    let index = index(&corpus, "100", scratch.path());
    let all = compare(&index, &groups, &expected, "100");
    report(&format!("100 notes (Meilisearch {})", expected.meilisearch), &all);

    let typo_group = |c: &Comparison| c.group.starts_with("typo") || c.group.starts_with("too short");
    let exact: Vec<&Comparison> = all.iter().filter(|c| !typo_group(c) && !c.group.starts_with("phrase")).collect();
    let typos: Vec<&Comparison> = all.iter().filter(|c| c.group.starts_with("typo")).collect();

    let uncapped: Vec<_> = exact.iter().filter(|c| !c.capped()).collect();
    let same_set = uncapped.iter().filter(|c| c.set_equal()).count();
    let tens: Vec<f64> = exact.iter().filter(|c| c.meili.len() >= 10).map(|c| c.top_ten_overlap()).collect();
    let top_ten = tens.iter().sum::<f64>() / tens.len().max(1) as f64;
    eprintln!("\n  A  same set: {same_set} of {}; mean top-10 overlap {top_ten:.2} over {} queries with at least 10 results", uncapped.len(), tens.len());
    for c in uncapped.iter().filter(|c| !c.set_equal()).take(20) {
        eprintln!("       differs: {:?} meili {} ours {}", c.query, c.meili.len(), c.ours.len());
    }

    let missed: Vec<_> = typos.iter().filter(|c| !c.capped() && c.recall() < 1.0).collect();
    eprintln!("  B  typo queries that miss something Meilisearch finds: {} of {}", missed.len(), typos.len());
    for c in missed.iter().take(20) {
        eprintln!("       {:?} misses {:?}", c.query, c.meili.iter().filter(|i| !c.ours.contains(i)).collect::<Vec<_>>());
    }
    assert_eq!(same_set, uncapped.len(), "A: every exact query finds Meilisearch's set");
    assert!(top_ten >= 0.8, "A: at least 8 of Meilisearch's top 10 in ours");
    assert!(missed.is_empty(), "B: nothing Meilisearch finds is missed");
}

#[test]
fn the_1000_note_corpus_reports_agreement_and_answers_every_query_in_under_200_ms() {
    let corpus = need_corpus!();
    let (groups, expected) = load(&corpus);
    let scratch = tempfile::tempdir().unwrap();
    let index = index(&corpus, "1000", scratch.path());
    let queries: Vec<&String> = groups.iter().flat_map(|g| g.queries.iter()).collect();
    let first = Instant::now();
    index.search("kubernetes").unwrap();
    eprintln!("first search (reads the vocabulary): {:.1} ms", first.elapsed().as_secs_f64() * 1000.0);
    let mut timings: Vec<(f64, &String)> = vec![];
    for _ in 0..3 {
        for q in &queries {
            let t = Instant::now();
            index.search(q).unwrap();
            timings.push((t.elapsed().as_secs_f64(), q));
        }
    }
    timings.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    let ms = |s: f64| format!("{:.1} ms", s * 1000.0);
    let slowest = timings.last().unwrap();
    eprintln!(
        "speed, 1,000 notes: {} searches: median {}, 95th {}, slowest {} ({:?})",
        timings.len(),
        ms(timings[timings.len() / 2].0),
        ms(timings[timings.len() * 95 / 100].0),
        ms(slowest.0),
        slowest.1
    );
    assert!(slowest.0 < 0.2, "C: every query under 200 ms (slowest: {:?})", slowest.1);
    let all = compare(&index, &groups, &expected, "1000");
    report("1,000 notes (most queries hit the cap of 50, so the set is mostly ties)", &all);
}
