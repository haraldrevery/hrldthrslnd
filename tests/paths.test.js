/**
 * paths.js — the vocabulary every other module shares.
 *
 * These are pure functions with no filesystem access, and they decide what a
 * URL, an extension and a "_min counterpart" mean. Everything downstream
 * inherits whatever they answer, so this is the cheapest place to pin the
 * behaviour down.
 */
import { test, expect, describe } from "bun:test";
import {
  extensionOf,
  mediaKind,
  mediaType,
  isRaster,
  isDecodable,
  isMinName,
  minVariant,
  minFileName,
  slugify,
  headingSlug,
  escapeHtml,
} from "../eleventy_binary/lib/paths.js";

describe("extensionOf", () => {
  test("lowercases, and keeps the dot", () => {
    expect(extensionOf("a.JPG")).toBe(".jpg");
  });

  test("a query string or fragment is not part of the extension", () => {
    expect(extensionOf("/image/a.jpg?v=2")).toBe(".jpg");
    expect(extensionOf("/image/a.jpg#top")).toBe(".jpg");
  });

  test("an extensionless name has no extension, not its last character", () => {
    expect(extensionOf("/video/clip")).toBe("");
  });

  test("a dot in a directory name is not the file's extension", () => {
    expect(extensionOf("/dir.mp4/file")).toBe("");
  });

  test("a leading dot is a name, not an extension", () => {
    expect(extensionOf(".gitignore")).toBe("");
  });
});

describe("media classification", () => {
  test("video, audio and everything else", () => {
    expect(mediaKind("/video/a.mp4")).toBe("video");
    expect(mediaKind("/audio/a.wav")).toBe("audio");
    expect(mediaKind("/image/a.jpg")).toBe("image");
    // An unknown extension is treated as an image, which is what renderFigure
    // relies on to fall through to <img>.
    expect(mediaKind("/thing/a.xyz")).toBe("image");
  });

  test("mime types for <source>", () => {
    expect(mediaType("/video/a.mp4")).toBe("video/mp4");
    expect(mediaType("/audio/a.opus")).toBe("audio/ogg");
    expect(mediaType("/image/a.jpg")).toBe("");
  });
});

describe("_min counterparts", () => {
  test("image/ is mirrored into image_min/, subfolders included", () => {
    expect(minVariant("/image/a.jpg")).toBe("/image_min/a_min.jpg");
    expect(minVariant("/image/sub/a.jpg")).toBe("/image_min/sub/a_min.jpg");
  });

  test("a folder that is not image/ keeps its counterpart beside the file", () => {
    expect(minVariant("/post_i/a.jpg")).toBe("/post_i/a_min.jpg");
    expect(minVariant("/card_thumbnail/a.jpg")).toBe("/card_thumbnail/a_min.jpg");
  });

  test("formats with no counterpart are returned unchanged", () => {
    expect(minVariant("/svg/a.svg")).toBe("/svg/a.svg");
    expect(minVariant("/gif/a.gif")).toBe("/gif/a.gif");
  });

  test("a name that is already a counterpart is final", () => {
    expect(isMinName("/image_min/a_min.jpg")).toBe(true);
    expect(minVariant("/image_min/a_min.jpg")).toBe("/image_min/a_min.jpg");
  });

  test("a cache-busting query does not carry over to the counterpart", () => {
    expect(minVariant("/image/a.jpg?v=2")).toBe("/image_min/a_min.jpg");
  });

  test("raster formats are the ones that get a counterpart", () => {
    expect(isRaster("/image/a.jpg")).toBe(true);
    expect(isRaster("/image/a.png")).toBe(true);
    expect(isRaster("/image/a.webp")).toBe(true);
    expect(isRaster("/svg/a.svg")).toBe(false);
  });

  test("KNOWN: every raster format collapses onto the same .jpg counterpart", () => {
    // Not a desirable property — two images with one basename and different
    // extensions want the same file. The mirror is what has to notice; see
    // images.test.js. Pinned here so a change to the naming scheme is a
    // deliberate act rather than a surprise.
    expect(minFileName("a.jpg")).toBe("a_min.jpg");
    expect(minFileName("a.png")).toBe("a_min.jpg");
    expect(minFileName("a.webp")).toBe("a_min.jpg");
  });
});

describe("isDecodable", () => {
  test("narrower than isRaster, and the gap is the point", () => {
    // A .webp takes a _min counterpart and uses one if the author supplies it,
    // but the mirror has no webp encoder and cannot make one. The status check
    // used to demand it anyway, which made a single .webp in image/ a permanent
    // build error nothing the author did could clear.
    expect(isRaster("/image/a.webp")).toBe(true);
    expect(isDecodable("/image/a.webp")).toBe(false);
  });

  test("the formats the mirror can actually encode from", () => {
    expect(isDecodable("/image/a.jpg")).toBe(true);
    expect(isDecodable("/image/a.jpeg")).toBe(true);
    expect(isDecodable("/image/a.JPG")).toBe(true);
    expect(isDecodable("/image/a.png")).toBe(true);
  });

  test("nothing outside the raster set is decodable", () => {
    for (const file of ["/svg/a.svg", "/gif/a.gif", "/video/a.mp4", "/a"]) {
      expect(isDecodable(file)).toBe(false);
    }
  });
});

describe("slugify", () => {
  test("lowercases and collapses runs of non-alphanumerics to one underscore", () => {
    expect(slugify("My Travel Notes")).toBe("my_travel_notes");
    expect(slugify("a  --  b")).toBe("a_b");
  });

  test("strips diacritics rather than dropping the letter", () => {
    expect(slugify("Galdhøpiggen")).toBe("galdh_piggen");
    expect(slugify("café")).toBe("cafe");
  });

  test("leading and trailing separators are trimmed", () => {
    expect(slugify("__a__")).toBe("a");
  });

  test("a name with nothing usable in it still gets a slug", () => {
    expect(slugify("---")).toBe("untitled");
    expect(slugify("")).toBe("untitled");
  });
});

describe("headingSlug", () => {
  test("keeps hyphens, which read better in a URL", () => {
    expect(headingSlug("My Heading")).toBe("my-heading");
  });

  test("is NOT injective — punctuation-only differences collapse", () => {
    // This is why tag slugs are assigned from one table rather than derived
    // independently on each side. See eleventy_config.js assignTagSlugs().
    expect(headingSlug("C++")).toBe("c");
    expect(headingSlug("C#")).toBe("c");
  });

  test("falls back rather than returning an empty id", () => {
    expect(headingSlug("!!!")).toBe("section");
  });
});

describe("escapeHtml", () => {
  test("escapes the five characters that matter in markup and attributes", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  test("escapes the ampersand first, so nothing is double-encoded", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});
