import { describe, expect, it } from "vitest";
import { parseRepo, repoLabel } from "./repoRef";

describe("parseRepo", () => {
  it.each([
    ["https://github.com/meddlin/composition", "github.com", "GitHub", "meddlin", "composition", "https://github.com/meddlin/composition"],
    ["https://www.github.com/meddlin/composition/", "github.com", "GitHub", "meddlin", "composition", "https://github.com/meddlin/composition"],
    ["github.com/meddlin/composition", "github.com", "GitHub", "meddlin", "composition", "https://github.com/meddlin/composition"],
    ["https://github.com/meddlin/composition.git", "github.com", "GitHub", "meddlin", "composition", "https://github.com/meddlin/composition"],
    ["https://github.com/meddlin/composition/tree/main/apps/web?tab=readme#top", "github.com", "GitHub", "meddlin", "composition", "https://github.com/meddlin/composition"],
    ["git@github.com:meddlin/composition.git", "github.com", "GitHub", "meddlin", "composition", "https://github.com/meddlin/composition"],
    ["ssh://git@github.com/meddlin/composition.git", "github.com", "GitHub", "meddlin", "composition", "https://github.com/meddlin/composition"],
    ["https://gitlab.com/gitlab-org/gitlab", "gitlab.com", "GitLab", "gitlab-org", "gitlab", "https://gitlab.com/gitlab-org/gitlab"],
    ["https://gitlab.com/group/sub/group/repo/-/tree/main", "gitlab.com", "GitLab", "group/sub/group", "repo", "https://gitlab.com/group/sub/group/repo"],
    ["https://bitbucket.org/atlassian/aui/src/master/", "bitbucket.org", "Bitbucket", "atlassian", "aui", "https://bitbucket.org/atlassian/aui"],
    ["https://codeberg.org/forgejo/forgejo/issues/1", "codeberg.org", "Codeberg", "forgejo", "forgejo", "https://codeberg.org/forgejo/forgejo"],
    ["https://git.sr.ht/~sircmpwn/hare", "git.sr.ht", "SourceHut", "~sircmpwn", "hare", "https://git.sr.ht/~sircmpwn/hare"],
    ["https://git.example.com/team/tool.git", "git.example.com", null, "team", "tool", "https://git.example.com/team/tool"],
    ["https://git.example.com/a/b/c/-/blob/main/x", "git.example.com", null, "a/b", "c", "https://git.example.com/a/b/c"],
    ["https://git.example.com/team/src/tree/main", "git.example.com", null, "team", "src", "https://git.example.com/team/src"],
    ["http://git.example.com:3000/team/tool", "git.example.com:3000", null, "team", "tool", "http://git.example.com:3000/team/tool"],
    ["  https://GitHub.com/Meddlin/Composition  ", "github.com", "GitHub", "Meddlin", "Composition", "https://github.com/Meddlin/Composition"],
  ])("reads %j", (url, host, service, owner, name, href) => {
    expect(parseRepo(url)).toEqual({ host, service, owner, name, href });
  });

  it("names the repository owner/name", () => {
    expect(repoLabel(parseRepo("gitlab.com/a/b/c")!)).toBe("a/b/c");
  });

  it.each([
    undefined,
    "",
    "   ",
    "owner/repo", // no host
    "https://github.com",
    "https://github.com/meddlin",
    "https://example.com/",
    "javascript:alert(1)",
    "data:text/html,x",
    "ftp://github.com/a/b",
    "https://github.com/a b/c",
    'https://github.com/a/b"><script>x</script>',
    "https://github.com/a/..",
    "https://github.com/../b",
  ])("is not a repository: %j", (url) => {
    expect(parseRepo(url)).toBeNull();
  });

  it("builds the link from the host and path only", () => {
    const ref = parseRepo("https://user:secret@github.com/a/b?token=x#frag");

    expect(ref?.href).toBe("https://github.com/a/b");
  });
});
