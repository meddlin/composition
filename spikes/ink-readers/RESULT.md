# Vision and PencilKit's reader side by side: the runs of 2026-11-12/13

`./run.sh` on a Mac on macOS 27.0.1 (Xcode 27.2), from the foreground app this folder builds. The first seven rows are **your drawings** from the iPad backup of
2026-11-12 22:55 (`app_data/untitled-drawing-*.png`: six saved versions of one sketched page with your signature, one of them also with "How does this work?", and one page neither reader found writing in);
"saved alt" is what the iPad's Vision wrote then. `sample` is the conformance corpus's page (strokes, no writing); the rest are synthetic. "alt" is what
`InkTranscript.text` would write now: Vision's lines after the 0.5 confidence floor and the never-guessed words, PencilKit's lines after the never-guessed words only
(it gives no confidence). ⏎ is a line break in what the reader returned. Times are one call after the model has loaded, and vary between runs.

**PencilKit reads only while the app is in front.** "App active" says whether the app was as the row was read; in earlier runs every row read after another window took the
front came back nil (handwritingd logs com.apple.corehandwriting -1003 for each), so the app now asks to be in front before each row. The daemon's view lags `isActive`
a little (two rows below read fine while it said no). The first call in a fresh process, which loads the model, took 0.1 s to 80 s for Vision across runs and 0.5 to
0.8 s for PencilKit. Search, from an earlier run with the app in front throughout: in "hello world", "hello" found 1 result (6 strokes and their bounds), "hell" with whole
words only 0, "hell" 1, "zebra" 0.

- macOS Version 27.0.1 (Build 26A434); recognitionVersion 9; 33 languages: ar cs da de en es fi fr hi hi-Latn id it ja ko mr ms nb nl nn no pl pt ro ru sv th tr uk vi yue yue-CN zh zh-TW
- first call in this process (the model loads): Vision 513 ms, PencilKit 572 ms
- the system languages PencilKit reads with no preference: ["en"]

| Case | Written | Vision: lines (confidence) | Vision: alt | ms | App active | PencilKit: whole drawing | PencilKit: by line | PencilKit: alt | ms | PencilKit: indexableContent |
|---|---|---|---|---|---|---|---|---|---|---|
| untitled-drawing-0d22802197fe | (yours: saved alt: Sugarfrom) | Sugarfrom (0.30) |  | 158 | yes | %⏎My a Damien Rushing | % / My a Damien Rushing | % My a Damien Rushing | 89 | %⏎°⏎^ { { } } ( { { { } } }⏎^(⏎My a Damien Rushing⏎My a Damien Rishing⏎ |
| untitled-drawing-1f482de198bd | (yours: saved alt: How does this work? 7 - Drien fucking) | How doek this wok ốè (1.00) / Drien fuching (0.30) | How doek this wok ốè | 211 | yes | ←←←⏎How does this work? ⑤⏎mn⏎on Damien Rushing⏎Ind⏎IX⏎ | ←←← / How does this work? ⑤ / mn / on Damien Rushing / Ind / IX | ←←← How does this work? ⑤ mn on Damien Rushing Ind IX | 203 | ←←←⏎←-←⏎←+←⏎How does this work? ⑤⏎How does this work? ④⏎How does this work? ①⏎How does tis work? ⑤⏎How does tis work? ④⏎How does tis work? ①⏎How does this wok? ⑤⏎How does this wok? ④⏎How does this wok? ①⏎mn⏎nm⏎nn⏎on Damien Rushing⏎on Damian Rushing⏎Ind⏎ind⏎ins⏎IX⏎LX⏎- x⏎-x⏎ |
| untitled-drawing-39fd5af6f666 | (yours: saved alt: Drien fucking) | Drien fucking (1.00) |  | 158 | yes | %⏎My a Damien Rushing | % / My a Damien Rushing | % My a Damien Rushing | 77 | %⏎°⏎^ { { } } ( { { { } } }⏎^(⏎My a Damien Rushing⏎My a Damien Rishing⏎ |
| untitled-drawing-544ed3a05854 | (yours: no saved alt) |  |  | 49 | yes | nil |  |  | 5 | nil |
| untitled-drawing-59dc7b113bd0 | (yours: saved alt: Dmiem Pwsting) | Dmiem Pwsting (0.30) |  | 184 | yes | %⏎My a Damien Rushing | % / My a Damien Rushing | % My a Damien Rushing | 157 | %⏎°⏎^ { { } } ( { { { } } }⏎^(⏎My a Damien Rushing⏎My a Damien Rishing⏎ |
| untitled-drawing-939a95e8f83e | (yours: saved alt: Drien fucking) | Drien fucking (1.00) |  | 182 | yes | %⏎My a Damien Rushing⏎X⏎ | % / My a Damien Rushing / X | % My a Damien Rushing X | 336 | %⏎F⏎{ } ^ { { } } ( { { } }⏎^(⏎My a Damien Rushing⏎My a Damien Rishing⏎X⏎X⏎X⏎ |
| untitled-drawing-d13725d944ec | (yours: saved alt: m Dain sking) | m (1.00) / Dain sking (0.30) | m | 288 | yes | [⏎Mu mm Damien Rushing | [ / Mu mm Damien Rushing | [ Mu mm Damien Rushing | 144 | [⏎←⏎t⏎Mu mm Damien Rushing⏎Mu min Damien Rushing⏎ |
| sample | (yours: no saved alt) |  |  | 60 | yes | nil |  |  | 15 | nil |
| hello world | hello world | hello world (1.00) | hello world | 55 | yes | hello world | hello world | hello world | 90 | hello world⏎ |
| two lines | meeting notes / call sam | meeting notes (1.00) / call sam (1.00) | meeting notes call sam | 96 | yes | meeting notes call som | meeting notes / call som | meeting notes call som | 270 | meeting notes⏎meetingnotes⏎call som⏎call Sam⏎call sam⏎ |
| shopping | buy milk and eggs | buy milk and eggs (1.00) | buy milk and eggs | 180 | yes | buy milk and eggs | buy milk and eggs | buy milk and eggs | 62 | buy milk and eggs⏎ |
| pangram | the quick brown fox / jumps over the lazy dog | the quick brown fox (1.00) / jumps over the lazy dog (1.00) | the quick brown fox jumps over the lazy dog | 116 | yes | the quick brown fox jumps over the lazy dog | the quick brown fox / jumps over the lazy dog | the quick brown fox jumps over the lazy dog | 795 | the quick brown fox⏎jumps over the lazy dog⏎jumps over the lay dog⏎ |
| a name | darrien rushing | darrien rushing (1.00) | darrien rushing | 99 | **no** | darrien rushing | darrien rushing | darrien rushing | 215 | darrien rushing⏎darien rushing⏎ |
| a non-word | drien | drien (1.00) | drien | 42 | **no** | drien | drien | drien | 41 | drien⏎dien⏎ |
| nonsense | xqzt vbnk | xazt vonk (0.50) | xazt vonk | 34 | yes | xazt vlonk | xazt vlonk | xazt vlonk | 35 | xazt vlonk⏎xazt vlnk⏎ |
| item 263 words | drien fucking / call sam | drien fucking (1.00) / call sam (1.00) | call sam | 89 | yes | drien fucking call som | drien fucking / call som | call som | 179 | drien fucking⏎call som⏎call Sam⏎call sam⏎ |
| pencil ink | hello world | hello world (1.00) | hello world | 38 | yes | hello world | hello world | hello world | 34 | hello world⏎ |
| upright | hello world | hello world (1.00) | hello world | 33 | yes | hello world | hello world | hello world | 43 | hello world⏎ |
| signature | (loops, no word) |  |  | 43 | yes | nil |  |  | 6 | nil |
| signature small | (loops, no word) | ии (0.30) |  | 48 | yes | nil |  |  | 5 | nil |
| scribbles | (a wave, a line, a dot) |  |  | 26 | yes | nil |  |  | 5 | nil |
| arcs | (120 arcs, no word) |  |  | 146 | yes | nil |  |  | 66 | nil |
| sketch and caption | (a house) / my house | my house (1.00) | my house | 68 | yes | my house | my house | my house | 91 | my house⏎Y house⏎ |
| words and a wave | call sam (a wave beside) | mi Was 1100 (1.00) | mi Was 1100 | 50 | yes | call Sam⏎ | call Sam | call Sam | 33 | call Sam⏎call sam⏎call som⏎ |
| hello world at 6 pt | hello world | hello world (1.00) | hello world | 29 | yes | hello world | hello world | hello world | 29 | hello world⏎ |
| hello world at 10 pt | hello world | hello world (1.00) | hello world | 27 | yes | hello world | hello world | hello world | 31 | hello world⏎ |
| hello world at 32 pt | hello world | hello world (1.00) | hello world | 57 | yes | hello world | hello world | hello world | 32 | hello world⏎ |
| hello world at 64 pt | hello world | hello world (1.00) | hello world | 91 | yes | hello world | hello world | hello world | 34 | hello world⏎ |
