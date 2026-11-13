# Ink readers: Vision beside PencilKit's PKStrokeRecognizer

A throwaway Mac app that reads the same drawings with the two readers behind `InkTextRecognizing` (`VisionTextRecognizer`, which reads a picture of the strokes,
and `PencilKitTextRecognizer`, which reads the strokes) and writes a table. Findings: [docs/architecture/ink.md](../../docs/architecture/ink.md#pencilkits-reader-beside-vision-spike-2026-11-12);
the run they come from: [RESULT.md](RESULT.md).

```sh
./run.sh [out-folder] [drawing.png ...]
```

- It reads the synthetic drawings (`InkHandwriting.swift` and `InkSamples.swift`, linked from the ink tests) and then **any drawing PNG you name**: one the iPad app
  stored under `app_data/` (its strokes ride in the PNG). Nothing leaves the Mac.
- **It is an app, not a test,** because the recognizer runs in `handwritingd`, which refuses xcodebuild's test host ("The application does not have permission to run
  remote recognition or synthesis at this time", com.apple.corehandwriting -1003). `run.sh` wraps the build in an `.app` with a bundle identifier, signs it ad hoc
  and opens it in front; it quits when the table is written.
- **It reads only while it is the app in front.** When another window takes the front, every reading after that is nil (handwritingd logs -1003 again), so the app asks
  to be in front before each row and the table says whether it was. Leave the Mac alone for the ten seconds it runs.
- Needs macOS 27 and Xcode 27. The Mac reads with the full model (33 languages); an iPad Simulator reads Latin scripts only, and needs an iOS 27 runtime.
