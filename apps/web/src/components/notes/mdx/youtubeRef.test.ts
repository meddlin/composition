import { describe, expect, it } from "vitest";
import { parseStart, parseYouTube, youtubeEmbedUrl, youtubeWatchUrl } from "./youtubeRef";

const ID = "dQw4w9WgXcQ";

describe("parseYouTube", () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&list=PL123&index=2`,
    `http://m.youtube.com/watch?feature=share&v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}?feature=share`,
    `youtu.be/${ID}`,
    `  www.youtube.com/watch?v=${ID}  `,
    ID,
  ])("finds the video in %j", (url) => {
    expect(parseYouTube(url)).toEqual({ id: ID, start: 0 });
  });

  it.each([
    undefined,
    "",
    "   ",
    "dQw4w9WgXc", // one character short of an id
    "https://www.youtube.com/watch",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/@channel",
    "https://www.youtube.com/playlist?list=PL1234567890A",
    "https://vimeo.com/123456789",
    `https://evil.example/watch?v=${ID}`,
    `https://youtube.com.evil.example/watch?v=${ID}`,
    `https://notyoutu.be/${ID}`,
    `javascript:alert(1)//youtu.be/${ID}`,
    `data:text/html,youtu.be/${ID}`,
    `ftp://youtu.be/${ID}`,
  ])("rejects %j", (url) => {
    expect(parseYouTube(url)).toBeNull();
  });

  it("takes a start time from the link", () => {
    expect(parseYouTube(`https://youtu.be/${ID}?t=90`)?.start).toBe(90);
    expect(parseYouTube(`https://www.youtube.com/watch?v=${ID}&t=1m30s`)?.start).toBe(90);
    expect(parseYouTube(`https://www.youtube.com/embed/${ID}?start=12`)?.start).toBe(12);
  });

  it("prefers the start prop to the link's", () => {
    expect(parseYouTube(`https://youtu.be/${ID}?t=90`, "5")?.start).toBe(5);
    expect(parseYouTube(ID, "1:05")?.start).toBe(65);
  });

  it("starts from the beginning when the start can't be read", () => {
    expect(parseYouTube(ID, "soon")?.start).toBe(0);
    expect(parseYouTube(`https://youtu.be/${ID}?t=soon`)?.start).toBe(0);
  });
});

describe("parseStart", () => {
  it.each([
    ["90", 90],
    ["90s", 90],
    ["1:30", 90],
    ["01:02:03", 3723],
    ["1m30s", 90],
    ["2m", 120],
    ["1h2m3s", 3723],
    [" 45 ", 45],
  ])("reads %j as %i seconds", (value, seconds) => expect(parseStart(value)).toBe(seconds));

  it.each([undefined, null, "", "-5", "1.5", "abc", "1:2:3:4", "m"])("ignores %j", (value) => expect(parseStart(value)).toBeNull());
});

describe("addresses", () => {
  it("embeds through the privacy-enhanced domain, from the id alone", () => {
    expect(youtubeEmbedUrl({ id: ID, start: 0 })).toBe(`https://www.youtube-nocookie.com/embed/${ID}?rel=0`);
    expect(youtubeEmbedUrl({ id: ID, start: 90 })).toBe(`https://www.youtube-nocookie.com/embed/${ID}?rel=0&start=90`);
  });

  it("links to the video on youtube.com", () => {
    expect(youtubeWatchUrl({ id: ID, start: 0 })).toBe(`https://www.youtube.com/watch?v=${ID}`);
    expect(youtubeWatchUrl({ id: ID, start: 90 })).toBe(`https://www.youtube.com/watch?v=${ID}&t=90s`);
  });
});
