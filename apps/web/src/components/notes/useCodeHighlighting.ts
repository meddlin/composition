import { useEffect, useState } from "react";
import type { Options } from "react-markdown";

type PluginList = NonNullable<Options["rehypePlugins"]>;

// Highlighting every highlight.js language is a large bundle, so it is fetched
// on demand: only once a note actually contains a fenced code block.
const FENCE = /^ {0,3}(`{3,}|~{3,})/m;

let loading: Promise<PluginList> | undefined;

function loadPlugins(): Promise<PluginList> {
  loading ??= Promise.all([import("rehype-highlight"), import("lowlight")]).then(
    ([{ default: rehypeHighlight }, { all }]): PluginList => {
      // react-markdown builds a new processor on every render, and a processor runs each plugin's setup again.
      // rehype-highlight's setup registers every language it is given (192 in `all`: about 6 ms and 1.3 MB), so
      // run it once here and hand every processor the same ready transform.
      // detect: false keeps fences without a language tag as plain text.
      const highlight = rehypeHighlight({ languages: all, detect: false });
      return [() => highlight];
    },
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
