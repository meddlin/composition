using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Xunit;
using Xunit.Abstractions;
using YamlDotNet.Core;
using YamlDotNet.Core.Events;
using YamlDotNet.RepresentationModel;
using YamlDotNet.Serialization;

namespace Composition.Core.Tests;

/// <summary>
/// S2: the shared corpus's frontmatter cases, answered by the desktop's real js-yaml code (oracle/frontmatter.oracle.ts) and by
/// YamlDotNet, so the choice between "use YamlDotNet" and "port js-yaml's loader and dumper" (what the iPad did) rests on a count.
/// This is a measurement, not a gate: it reports and only fails if the corpus or the oracle is missing.
/// </summary>
public class FrontmatterProbeTests(ITestOutputHelper output)
{
    private static readonly string? Corpus = Environment.GetEnvironmentVariable("COMPOSITION_CORPUS_DIR");

    private static readonly Regex FrontmatterRe = new(@"\A---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?", RegexOptions.CultureInvariant);

    // --- the probe: YamlDotNet's node model, plus a js-yaml-style resolver for plain scalars ------------------

    /// <summary>What js-yaml's default schema makes of a plain scalar, as the string frontmatter.ts's asString() then sees.</summary>
    private static string? JsYamlPlainToString(string raw)
    {
        if (raw is "" or "~" or "null" or "Null" or "NULL") return "";
        if (raw is "true" or "True" or "TRUE") return "true";
        if (raw is "false" or "False" or "FALSE") return "false";
        if (Regex.IsMatch(raw, @"^[-+]?[0-9][0-9_]*$") && long.TryParse(raw.Replace("_", ""), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var i)) return i.ToString(CultureInfo.InvariantCulture);
        if (Regex.IsMatch(raw, @"^0x[0-9a-fA-F_]+$")) return Convert.ToInt64(raw[2..].Replace("_", ""), 16).ToString(CultureInfo.InvariantCulture);
        if (Regex.IsMatch(raw, @"^0o[0-7_]+$")) return Convert.ToInt64(raw[2..].Replace("_", ""), 8).ToString(CultureInfo.InvariantCulture);
        if (Regex.IsMatch(raw, @"^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$") && double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var d))
            return d.ToString("R", CultureInfo.InvariantCulture); // JavaScript prints 1000 for 1e3, "1.5" for 1.5; "R" is close, not identical (probe)
        var ts = Regex.Match(raw, @"^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:(?:[Tt]|[ \t]+)([0-9]{1,2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]*))?(?:[ \t]*(Z|[-+][0-9]{1,2}(?::([0-9]{2}))?))?)?$");
        if (ts.Success && DateTimeOffset.TryParse(raw.Replace(' ', 'T'), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var dto))
            return dto.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture); // Date -> toISOString()
        return null;
    }

    private static string ScalarString(YamlNode? node, bool resolve)
    {
        if (node is not YamlScalarNode s) return node is null ? "" : "[object]";
        if (!resolve || s.Style != ScalarStyle.Plain) return s.Value ?? "";
        return JsYamlPlainToString(s.Value ?? "") ?? s.Value ?? "";
    }

    private static string DateOnly(string value)
    {
        var m = Regex.Match(value.Trim(), @"^(\d{4}-\d{2}-\d{2})(?:[T ]|$)");
        return m.Success ? m.Groups[1].Value : value;
    }

    private static JsonNode? ProbeParse(string content, bool resolve)
    {
        var match = FrontmatterRe.Match(content);
        if (!match.Success) return new JsonArray(null, content);
        YamlMappingNode root;
        try
        {
            var stream = new YamlStream();
            stream.Load(new StringReader(match.Groups[1].Value));
            if (stream.Documents.Count == 0 || stream.Documents[0].RootNode is not YamlMappingNode m) return new JsonArray(null, content);
            root = m;
        }
        catch (YamlException) { return new JsonArray(null, content); }

        YamlNode? Get(string key) => root.Children.FirstOrDefault(kv => kv.Key is YamlScalarNode k && k.Value == key).Value;
        var tags = new JsonArray();
        switch (Get("tags"))
        {
            case YamlSequenceNode seq:
                foreach (var t in seq.Children.Select(c => ScalarString(c, resolve).Trim()).Where(t => t != "")) tags.Add(t);
                break;
            case YamlScalarNode scalar:
                foreach (var t in ScalarString(scalar, resolve).Split(',').Select(t => t.Trim()).Where(t => t != "")) tags.Add(t);
                break;
        }
        var fm = new JsonObject
        {
            ["title"] = ScalarString(Get("title"), resolve),
            ["description"] = ScalarString(Get("description"), resolve),
            ["tags"] = tags,
            ["createdAt"] = DateOnly(ScalarString(Get("createdAt"), resolve)),
            ["updatedAt"] = DateOnly(ScalarString(Get("updatedAt"), resolve)),
        };
        var header = ScalarString(Get("headerImage"), resolve).Trim();
        if (header != "")
        {
            fm["headerImage"] = header;
            var layout = ScalarString(Get("headerImageLayout"), resolve).Trim().ToLowerInvariant();
            fm["headerImageLayout"] = layout == "centered" ? "centered" : "full";
        }
        return new JsonArray(fm, content[match.Length..]);
    }

    private static string ProbeGenerate(JsonNode c)
    {
        var data = new List<KeyValuePair<string, object>>
        {
            new("title", c["title"]!.GetValue<string>()),
            new("description", c["description"]!.GetValue<string>()),
            new("tags", c["tags"]!.AsArray().Select(t => t!.GetValue<string>()).ToList()),
            new("createdAt", DateOnly(c["createdAt"]!.GetValue<string>())),
            new("updatedAt", DateOnly(c["updatedAt"]!.GetValue<string>())),
        };
        var serializer = new SerializerBuilder().Build();
        var sb = new StringBuilder();
        foreach (var (key, value) in data)
        {
            var one = serializer.Serialize(new Dictionary<string, object> { [key] = value }).Replace("\r\n", "\n");
            sb.Append(one);
        }
        return $"---\n{sb}---\n";
    }

    // --- the test --------------------------------------------------------------------------------------------

    [OracleFact]
    public void HowFarIsYamlDotNetFromJsYamlOnTheSharedCorpus()
    {
        if (Corpus is null || !File.Exists(Path.Combine(Corpus, "frontmatter-cases.json")) || !File.Exists(Oracle.Path("frontmatter-expected.json")))
        {
            output.WriteLine("SKIPPED: set COMPOSITION_CORPUS_DIR (a directory with frontmatter-cases.json) and run the oracle phase 'frontmatter'.");
            return;
        }
        var cases = JsonNode.Parse(File.ReadAllText(Path.Combine(Corpus, "frontmatter-cases.json")))!;
        var expected = Oracle.Json("frontmatter-expected.json");
        var parseCases = cases["parse"]!.AsArray();
        var generateCases = cases["generate"]!.AsArray();
        Assert.Equal(parseCases.Count, expected["parse"]!.AsArray().Count);

        var report = new JsonObject();
        foreach (var (label, resolve) in new[] { ("YamlDotNet scalars as written (no js-yaml typing)", false), ("YamlDotNet + a js-yaml-style plain-scalar resolver", true) })
        {
            var agree = 0;
            var disagree = new List<string>();
            for (var i = 0; i < parseCases.Count; i++)
            {
                var got = ProbeParse(parseCases[i]!.GetValue<string>(), resolve);
                if (JsonNode.DeepEquals(expected["parse"]![i], got)) agree++;
                else disagree.Add($"#{i}: {Short(parseCases[i]!.GetValue<string>())}  desktop={Short(expected["parse"]![i]!.ToJsonString())}  .NET={Short(got?.ToJsonString())}");
            }
            output.WriteLine($"parse, {label}: {agree} of {parseCases.Count} agree with js-yaml");
            foreach (var line in disagree.Take(12)) output.WriteLine("   " + line);
            report[$"parse: {label}"] = new JsonObject { ["agree"] = agree, ["of"] = parseCases.Count };
        }

        var identical = 0;
        var differ = new List<string>();
        for (var i = 0; i < generateCases.Count; i++)
        {
            var got = ProbeGenerate(generateCases[i]!);
            if (got == expected["generate"]![i]!.GetValue<string>()) identical++;
            else differ.Add($"#{i}: title={Short(generateCases[i]!["title"]!.GetValue<string>())}\n      desktop={Short(expected["generate"]![i]!.GetValue<string>())}\n      .NET   ={Short(got)}");
        }
        output.WriteLine($"generate, YamlDotNet's default emitter: {identical} of {generateCases.Count} byte-identical to js-yaml's dump");
        foreach (var line in differ.Take(8)) output.WriteLine("   " + line);
        report["generate: YamlDotNet default emitter"] = new JsonObject { ["byteIdentical"] = identical, ["of"] = generateCases.Count };
        File.WriteAllText(Oracle.Path("frontmatter-drift.json"), report.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
    }

    private static string Short(string? s)
    {
        s ??= "(null)";
        s = s.Replace("\n", "\\n").Replace("\r", "\\r");
        return s.Length > 110 ? s[..110] + "…" : s;
    }
}
