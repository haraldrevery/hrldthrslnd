> **Superseded in part.** The plan that was actually built is in
> [`page_builder_plan.md`](page_builder_plan.md): the same features, delivered as
> `site_generate --edit` rather than a Tauri or Electron app, and the reasons why.
> This file is kept as the original brief.

# Page builder app

Concept: Instead of copy and pasting code for making custom html pages for photography/art portfolio or just fancier articles, a block editor where you can paste markdown+KaTeX in blocks and import images and see the image grid rendering and warn the user about missing compressed images (missing "*_min.jpg"). 

Inspiration: I just wanted a fancy Behance, Flickr and DeviantArt experience, but for my own website. 


## Features

Some guidelines:

- If the static images that the user imports is over 250-750kB (depending on resolution size of the image), it gets converted to a jpg to the 250-750kB file size range. All images gets an generated `*_min.jpg` thumbnail. `*_min.jpg` image thumbnails must be less than 80kb per image. Use MozJpeg for the jpg with YCbCr, ImageMagick Quantization of 26, Smoothing of 30 and Auto subsample chroma. If resolution is more than 2800px on any side, down size it. Since this can be a computational heavy task, use a load bar with info what is happening. 

- Check if videos are browser friendly (note, that it should not try to convert them, just check the format and let the user know if there are issues). Same with gif files, just notify the user if they are too large for its file type.

- Stable saving/import project logic, so that users can import a project into this web app and continue working on their website page. Include an option to also export a `post_x.zip` file with all the content (the `.json` save file, the exported `.html` page with YAML and all the media assets), the desktop version can also open up a post folder. 

- You can use either Electron or Tauri for this software (use an abstraction layer so both can be added supported, reducing technical debt to one type only). Note: Since the desktop app can handle files on a hard drive, be very careful to not risk unwarranted overrides, data corruption or data losses. The desktop app must be safe and reliable to use!

- Video should be simple html player, but can contain a thumbnail.

- Indicators that the user has filled all the fields correct (h1, h2, h3... header structure, YAML field is in order and images have their `*_min` version and alt, title and description text.). Green for correct, yellow for warning (will render out, but minor website and SEO issues) and red for severe SEO punishment or can cause 11ty rendering problems.

- When writing text in the project, the editor should have markdown + KaTex support (katex renders to html, the final rendered html page should not need JavaScript for the LaTex content).

- For photography/illustrator sections, have a few options for the photo grid, i.g aspect ratio grid/masonry photo grid, standard grid or waterfall layout (with photo descriptions). SVG, GIF and video files should be supported in grids too. Let user define a universal gap for the grids.

- Block-Based Editor. For the projects and for making a page, drag and drop or reordering parts of the page and so on (should be intuitive for the user). 

- A few hero page templates to pick from.

- Generate the Metadata automatically (if necessary, make the user fill in some forms per project page or for the whole webpage project). But don't make the user fill in more fields than necessary, reuse inputs if that can save them time.

- Revision history / undo / autosave for blocks and projects. Since users will be building long-form pages, stable draft recovery matters a lot.

- EXIF handling: tile and description should preferably be imported (so the user doesn't has to write more than necessary). (Privacy defaults: strip GPS/location EXIF by default and warn before exporting personal metadata.)

- SEO and social metadata: Open Graph, Twitter card fields, and metadata should be generated correctly.

---

## Set up

Puck seems like the most stable choice for block logic and a live preview renderer. The app should be a Tauri/Electron app for opening up folders or project zip files. Note: use native_api.js for the abstraction layer. 
