using Microsoft.UI;
using Microsoft.UI.Text;
using Windows.UI;

namespace Composition.Shell.Spike;

/// <summary>
/// A deliberately crude Markdown colourer over a RichEditBox's text range API, to find out whether the control survives the
/// design's editor job (Decision 2: native RichEditBox, gated on this spike). RichEdit stores a paragraph break as '\r'.
/// </summary>
public static class MarkdownColour
{
    private static readonly Color Heading = Color.FromArgb(255, 86, 156, 214);
    private static readonly Color Fence = Color.FromArgb(255, 206, 145, 120);
    private static readonly Color Marker = Color.FromArgb(255, 181, 206, 168);
    private static readonly Color Tag = Color.FromArgb(255, 78, 201, 176);

    public static Color? ColourOf(string line, ref bool inFence)
    {
        if (line.StartsWith("```", StringComparison.Ordinal)) { inFence = !inFence; return Fence; }
        if (inFence) return Fence;
        if (line.StartsWith('#')) return Heading;
        if (line.StartsWith('<') && line.Length > 1 && char.IsLetter(line[1])) return Tag;
        var t = line.TrimStart();
        if (t.StartsWith("- ", StringComparison.Ordinal) || t.StartsWith("* ", StringComparison.Ordinal) || t.StartsWith("> ", StringComparison.Ordinal)) return Marker;
        return null;
    }

    /// <summary>Colour every line. One batch, so the control repaints once.</summary>
    public static void ApplyAll(RichEditTextDocument doc)
    {
        doc.GetText(TextGetOptions.None, out var text);
        doc.BatchDisplayUpdates();
        try
        {
            var inFence = false;
            var at = 0;
            foreach (var line in text.Split('\r'))
            {
                if (ColourOf(line, ref inFence) is { } colour && line.Length > 0)
                    doc.GetRange(at, at + line.Length).CharacterFormat.ForegroundColor = colour;
                at += line.Length + 1;
            }
        }
        finally { doc.ApplyDisplayUpdates(); }
    }

    /// <summary>
    /// Recolour only the paragraph around <paramref name="caret"/> (what an editor must do per keystroke). Fence state is NOT tracked
    /// here; a real implementation needs an incremental model, and that is part of what this spike's number is meant to price.
    /// </summary>
    public static void ApplyParagraph(RichEditTextDocument doc, int caret)
    {
        var range = doc.GetRange(caret, caret);
        range.Expand(TextRangeUnit.Paragraph);
        range.GetText(TextGetOptions.None, out var line);
        line = line.TrimEnd('\r');
        var inFence = false;
        var colour = ColourOf(line, ref inFence) ?? Colors.White;
        range.CharacterFormat.ForegroundColor = colour;
    }
}
