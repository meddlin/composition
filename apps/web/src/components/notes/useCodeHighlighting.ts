import { useEffect, useState } from "react";
import type { Options } from "react-markdown";

type PluginList = NonNullable<Options["rehypePlugins"]>;

// Highlighting every highlight.js language is a large bundle, so it is fetched
// on demand: only once a note actually contains a fenced code block.
const FENCE = /^ {0,3}(`{3,}|~{3,})/m;

let loading: Promise<PluginList> | undefined;

function loadPlugins(): Promise<PluginList> {
  loading ??= Promise.all([import("rehype-highlight"), import("lowlight")]).then(
    ([{ default: rehypeHighlight }, { all }]): PluginList => [
      // detect: false keeps fences without a language tag as plain text.
      [rehypeHighlight, { languages: all, detect: false }],
    ],
  );
  return loading;
}

export function useCodeHighlighting(body: string): PluginList {
  const [plugins, setPlugins] = useState<PluginList>([]);
  const needed = FENCE.test(body);

  useEffect(() => {
    if (!needed) return;
    let cancelled = false;
    loadPlugins().then((loaded) => {
      if (!cancelled) setPlugins(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [needed]);

  return plugins;
}
