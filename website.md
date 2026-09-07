# Static website (with custom page builder/dashboard)

A static website for easy maintenance through a Tauri app that has a page builder. Website both has a desktop and a mobile friendly version with a system dark/light mode. 


## Philosophy


No JavaScript, only exception is glightbox for popup image sliders, the search bar, and a button to adjust the page width for the markdown generated html posts. Website should not render with errors if the user has JavaScript disabled. Anything else should only utilise CSS and try not to use too experimental CSS in case of users having older hardware. KaTeX should render without need for JavaScript for the users (markdown-it-katex works for 11ty). 

For the website development, using npm is fine. But for website generation, it should not rely on any npm commands, it should be able to be generated through a binary file (one for linux and one for windows).

No CDN servers, every single asset should be locally hosted.

User can make a new post/article in three ways:
- Markdown `.md` file in the `input_markdown/`
- Custom `.html` file in `input_custom_html/`
- Full `post_*/` folder in `input_custom_post/`

## Some website details

- The blog part should have thumbnail cards, not "just a long list" like many other blogs have. Include a tag filter (see the YAML data how 11ty gets the tag data) and a search bar (that has a dropdown suggestion list when typing and navigate with keyboard arrows). To make the website scale well as content continues to be added: limit the blog card rendering to max 40 articles per page, if more than 40 posts the site generator has pagination for the blog part. Note: if javascript is disabled, the search bar should not be visible at all and place the search bar in the navigation bar in a sensible position. Have nice hover animation when hovering over a card. 

- For markdown posts: In the lower right corner there should be an outline toggle button. The outline toggle button is strictly required to function using only CSS and chapters/subchapters are clickable so the viewport scrolls to said chapter/subchapter. The Cycle width button can be placed above the outline toggle button and only visible when the mouse cursor is hovering around the lower right corner. If javascript is disabled, the cycle button should not be visible. The cycle is: 100% (default), 75%, 55%, 40%, 28% and 18% of the website css page container width. The width settings should be persisting across post to post (`localstorage` is ok for this).

- In the theme.css, include an parameter to scale each fonts global typography base root size, letter-spacing and line-height space so user can tweak the fonts root characteristics ensuring these font settings act as the base for the entire site for each font (note: KaTeX font has its own separate global typography settings, isolated from the other fonts and has its own base root size value). Also define the theme colours (both dark and light mode) as variables to it can be tweaked from theme.css. In input.css: define what criteria variables for mobile / desktop are here so it can be tweaker later.

- Light/dark mode is system only, no javascript toggle for theme.

- Mathematical expressions must be rendered to static HTML during the build. The public site must include locally hosted KaTeX CSS and fonts and must not require client-side JavaScript for ordinary rendering.

- The legal.html being generated from legal.md should also render the all licences as individual section blocks of each license after the content from legal.md.

- For any section/block container that has text, use justified text alignment.



## Dashboard and page builder app


The page builder app is a block based tauri editor that generates html pages. User should have a dashboard over their website where they can change name/settings globally for the website and pick a page project to edit its content as a block editor (Behance / Flickr inspired).

Page builder Blocks:
- Image gallery grid (justified with native ratios or uniform ratio crop grid), should support svg as well. (Imported images are copied over to the /image folder. Alt text, title and description should be extracted from the exif data, and a min version should be generated to the /image_min for the gallery grid).
- Text section (markdown + KaTex) 
- Video (Title + description is optional below the video)
- Audio
- Heading
- Raw HTML
- FAQ section
- Feature page / One image catch text block. 
- Download (with automatic generated SHA-256 and SHA-512 string)
- Hero page (always on top and except from the two column criteria since it's its own part)

All blocks should be able to be arranged in a single full width column or a two column block (two "half width" sections, but with a sensible gap between those blocks). 

Note: block_test_page.html should be a stress page containing all possible combinations of these potential blocks to easy inspect and see that they look visually ok during development. If multiple hero page types, have  block_test_page_a.html and  block_test_page_b.html to show the different types of hero pages. If the page builder app is not working or not implemented yet. at least make the block_test_page.html pages easy to copy, tweak and paste so developers can reuse the html blocks to make html pages manually. 

## Folder structure

Something like this to keep it clean an easy to navigate the project.
 ```
.
└── project_root/
    ├── readme.md
    ├── _site/
    │   ├── javascript/
    │   │   └── ...
    │   ├── css/
    │   │   └── main.css
    │   ├── video/
    │   │   └── ...
    │   ├── font/
    │   │   ├── font_1.woff2
    │   │   ├── font_1.ttf
    │   │   ├── font_2.woff2
    │   │   └── font_2.ttf
    │   ├── gif/
    │   │   ├── gif_1.gif
    │   │   ├── gif_2.gif
    │   │   └── ...
    │   ├── image/
    │   │   ├── image_1.jpg
    │   │   ├── image_2.jpg
    │   │   ├── image_q.jpg
    │   │   └── ...
    │   ├── image_min/
    │   │   ├── image_1_min.jpg
    │   │   ├── image_2_min.jpg
    │   │   ├── image_q_min.jpg  <-- any missing `*_min.jpg` file from the `image/` input folder gets a generated complementary version on build. 
    │   │   └── ...
    │   ├── card_thumbnail/
    │   │   ├── thumbnail_1.jpg    <-- thumbnails for the blog/article cards
    │   │   ├── thumbnail_2.jpg
    │   │   └── ...
    │   ├── svg/
    │   │   ├── svg_file_1.svg
    │   │   ├── svg_file_2.svg
    │   │   └── ...
    │   ├── audio/
    │   │   ├── audio.mp3
    │   │   ├── song.mp3
    │   │   └── ...     
    │   ├── post_i/
    │   │   ├── image_zz.jpg
    │   │   ├── image_zz_min.jpg
    │   │   ├── image_vv.jpg
    │   │   ├── image_vv_min.jpg
    │   │   └── ...
    │   ├── post_ii/
    │   │   ├── image_u.jpg
    │   │   ├── image_u_min.jpg
    │   │   └── ...
    │   ├── favicon.ico
    │   ├── favicon.svg
    │   ├── index.html
    │   ├── about.html
    │   ├── contact.html
    │   ├── legal.html
    │   ├── 404.html
    │   ├── blog.html
    │   ├── blog_tag_1.html
    │   ├── blog_tag_2.html
    │   ├── post_1.html
    │   ├── post_2.html
    │   ├── some_page_1.html
    │   ├── some_page_2.html
    │   ├── post_x.html
    │   ├── post_y.html
    │   ├── post_i.html
    │   ├── post_ii.html
    │   ├── status_check.html    <-- website "health" dashboard information and stats, shows information similar to the status_check.sh/.bat as a html page.
    │   ├── sitemap.xml <-- generated by the site generator
    │   └── ...
    ├── image/
    │   ├── image_1.jpg
    │   ├── image_2.jpg
    │   ├── image_q.jpg
    │   └── ...
    ├── image_min/
    │   ├── image_1_min.jpg
    │   ├── image_2_min.jpg
    │   └── ...
    ├── svg/
    │   ├── svg_file_1.svg
    │   ├── svg_file_2.svg
    │   └── ...
    ├── card_thumbnail/
    │   ├── thumbnail_1.jpg    <-- thumbnails for the blog/article cards
    │   ├── thumbnail_2.jpg
    │   └── ...
    ├── audio/
    │   ├── audio.mp3
    │   ├── song.mp3
    │   └── ...
    ├── javascript/
    │   ├── glightbox_settings_min.js
    │   ├── glightbox.min.js
    │   ├── search_bar.js
    │   ├── reading_width.js
    │   └── ...
    ├── pagebuilder_app/
    │   ├── compile.sh  <-- compiles the binary for the tauri page builder
    │   └── page_builder/
    │       ├── src-tauri/
    │       │   ├── build.rs
    │       │   └── ...    
    │       ├── readme.md <-- all the information about how the page builder app works
    │       └── ...
    ├── input_markdown/
    │   ├── post_1.md  <-- markdown posts that will be generated to a blog post.
    │   └── post_2.md
    ├── input_custom_html/
    │   ├── block_test_page.html  <-- page containing all page block types, a stress test to see that all possible sections/block types renders out correctly.
    │   ├── some_page_1.html  <-- html page posts (user code it themselves) that copied over to a blog post (only striping away the YAML).
    │   ├── some_page_2.html
    │   └── ... 
    ├── input_custom_post/
    │   ├── post_i/
    │   │   ├── post_i.html     <-- html page posts (made with the page builder) that copied over to a blog post (only striping away the YAML).
    │   │   ├── post_i.json     <-- saving files for the page builder app.
    │   │   ├── image_zz.jpg
    │   │   ├── image_zz_min.jpg
    │   │   ├── image_vv.jpg
    │   │   ├── image_vv_min.jpg
    │   │   ├── thumbnail.jpg   <-- card thumbnail for the post
    │   │   └── ...              <-- all the other assets for the post
    │   ├── post_ii/
    │   │   ├── post_ii.html   
    │   │   ├── post_ii.json
    │   │   ├── image_u.jpg
    │   │   ├── image_u_min.jpg
    │   │   ├── thumbnail.jpg   
    │   │   └── ...
    │   └── ...
    ├── video/
    │   ├── video_1.mp4
    │   ├── video_2.mp4
    │   └── ...
    ├── licence_and_legal/
    │   ├── licence_1.md
    │   ├── licence_2.md
    │   ├── legal.md     <-- generates the legal.html for the website
    │   └── ...
    ├── eleventy_binary/
    │   ├── compile.sh   <-- compiles the whole eleventy logic to a binary for both linux and windows.
    │   ├── build.mjs
    │   ├── readme.md
    │   └── ...
    ├── eleventy_njk/
    │   ├── blog.njk
    │   ├── index.njk
    │   ├── about.njk
    │   ├── sitemap.njk
    │   ├── search-index.njk
    │   ├── blog-tag.njk
    │   ├── 404
    │   └── ...
    ├── eleventy_settings/
    │   ├── base.njk
    │   ├── footer.njk
    │   ├── nav.njk
    │   ├── post.njk
    │   ├── search.njk
    │   └── ...
    ├── font/
    │   ├── font_1.woff2
    │   ├── font_1.ttf
    │   ├── font_2.woff2
    │   └── font_2.ttf
    ├── gif/
    │   ├── gif_1.gif
    │   ├── gif_2.gif
    │   └── ...
    ├── css/
    │   ├── theme.css   <-- core aestetics of the site (root font settings, dark/light mode color theme, global variables etc)
    │   ├── input.css   <-- custom css
    │   ├── main.css    <-- final generated tailwind css (minified)
    │   └── main_max.css    <-- generated tailwind css (NOT minified, used for troubleshooting)
    ├── icon/
    │   ├── favicon.ico
    │   ├── favicon.svg
    │   ├── apple-touch-icon.png
    │   └── ...
    ├── update_css.sh    <-- updates tailwind css on linux.
    ├── update_css.bat   <-- updates tailwind css on windows.
    ├── site_generate    <-- rebuild the website on linux  (updates the css too).
    ├── site_generate.exe   <-- rebuild the website on windows  (updates the css too).
    ├── page_builder_app        <-- opens the page builder for linux
    ├── page_builder_app.exe    <-- opens the page builder for windows
    ├── eleventy.config.js
    ├── status_check.sh    <-- warns if pages missing links to media files and file sizes, missing meta data etc on linux
    ├── status_check.bat   <-- warns if pages missing links to media files and file sizes, missing meta data etc on windows
    ├── site_settings.json <-- Website settings
    ├── tailwindcss-linux-x64                <-- Tailwind binary for Linux
    ├── tailwindcss-windows-x64.exe        <-- Tailwind binary for Windows
    └── readme.md  
```

Some comments:

- The `/licence_and_legal` folder contains all the licences to comply with various licences to publish this website and the legal.md that is the websites own legal page.

- The `image_min/` folder contains the highly compressed image versions of the `/image` folder. `*_min.jpg` are used for image thumbnails in galleries etc so the website doesn't load the high resolution images when entering the page, save data for mobile users etc and better page speed scores. Subfolders are mirrored for `/image` and `/image_min`.

- The `input_custom_post/` subfolder structure can be tweaked to make the page generator have better output structure when rendering the site to reduce errors.

- The reason for the `input_custom_post/` and `input_custom_html/` separation is that users can choose to make custom html pages manually or in development before the page builder app is done to still being able to make posts and make test pages so everything looks good and renders correctly. 

- The `post_i/` and the `post_ii/` folders in this example are the files that the page builder app can open, while the webversion loads/exports the `post_i.zip` and `post_ii.zip` version of those folders.

- `status_check.html` is a page that shows stats, build date and pages with problems with the website (broken media links and other issues etc) in a presentable manner. Does not have to be linked anywhere, it's intended for as a developer to type `.../status_check.html` in the address bar to see it.

- `site_settings.json` should contain: Website name, short name, description, domain/url, language, max posts per page, navigation bar settings (label, link and order) and default image.

- On markdown generated post has an image, the image thumbnail (on the generated html page) is automatically referred to the mirrored `*_min.jpg` file in `image_min/` folder. On build, it should warn the user that there was missing mirrored `*_min.jpg` and that a generated one was made for said file. Note: User can either maintain their own  `image_min/` folder or let the builder complement genererade the missing counterpart in  `image/`, either choice, the generated site should have a a mirrored `image_min/` and `image/` folder in `_site/`.

- If more than one image is placed after each other on a markdown post, render those images as a justified image gallery grid (with said image slider when clicking on an image). Note: make sure the image gallery grid logic still looks visually intact no matter the reader width setting the user has. 






## YAML


YAML that are set for all the `input_custom_html/`, `input_markdown/` & `input_custom_post/` folders files (status_check should warn if something is missing/wrong). 

YAML format:
 ```
---
title: Title of the page
date: YYYY-MM-DD
image: /card_thumbnail/thumbnail_xx.jpg <-- used for post thumbnail and Open Graph image
tags: [tag_1, tag_2]
description: Short description or summary of the page.
draft: true/false        <-- If "draft = false", the page is not generated or copied for the generated site.
---
```


For the slug for the generated webpages, use the markdown/html input file name. For any conflicts, warn the user and add a suffix.

## Technical comment

For making the npm logic to a binary file for Windows and Linux, consider using Bun. For the page builder app maybe use Puck editor for the UI and have a live preview render in the centre. 

Even _with or without_ the page builder app, it should be easy to maintain the website and its content. 