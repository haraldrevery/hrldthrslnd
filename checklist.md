
# Things to check


Click around, not much to say. The website should look nice, not drain your laptop/phone battery. Some common subtle errors: 
- Font prose and KaTeX font size, they might not match visually in size and you must adjust them individually.
- Make sure markdown posts renders images and video + image slider popup works.
- Reader width button acts predictable (text not going to one side, cycles correctly, not working etc). Worth checking that the page width edge is looks balanced with the navigation bar and the content and so on. Note: The reason for the button is for users who either has a vertically rotated desktop screen or an ultra wide screen.
- Outline works (can be toggled on/off) and scroll on click works, visually looks pleasing and not too distracting from the text itself. 
- Disable JavaScript and use the website, it should not cause any visual errors.
- On Firefox and Chrome, check "console" (right click "inspect (Q)" --> "Console") and see if there are any errors. Paste those errors to the LLM and see what causes them. If you got Safari, check that too (or you just have to trust the LLM on this).
- Check how it looks on a mobile device, check the padding and that the navigation menu is responsive and not glitchy (I suggest to have simple drop down menu from a hamburger menu, less risks for bugs etc). Many LLM models just slop a squashed navigation bar that is buggy with bad button logic, so you have to test and prompt a little to make it look nice and work reliable.
- Is the text legible? Is there enough color contrast between the text and the background, again, check on both mobile and desktop! Worth noting that this has to be eyeballed (hence the theme.css font parameters so you can easily tweak by eye).
- Image slider pop up errors: Check that the description/title is the correct font and follows the colour theme for light/dark mode. GLightBox has a tendency to just have a white background with black text with some default font. 
- Asymmetric padding issue: Some fonts might mathematically have more padding in the bottom than on top and vice versa, so when you use "centre" classes to align it vertically, visually it will look asymmetric and not really centre, resulting in an unbalanced padding on the navigation bar, tag buttons and buttons over all and search bar fields. So you need to tweak each element that has said font to have a certain amount of extra/less padding bellow/above to visually tweak this so it actually looks balanced no matter the font size being used.
- On blog posts, check that the tag system works, click on the tag buttons so they actually filter them correctly.
- If your blog ever might exceed +100 posts, you need to have a page logic for the cards so you don't risk rendering out +100 cards in the future. Prompt to have a limit of 40 to 60 cards per page, after that it has to numerate the blog posts.
- For the blog card page, if there are more than 2 rows of tags, consider having them collapsed instead of rendering all the tags out.
- Minor detail, check that javascripts are rendered in the very end with `defer`, example `<script src="/javascript/reading_width.js" defer></script>` after all the main content. If you don't use `defer` the page will load the js file before rendering anything and will cause minor SEO punishment (bad page speed score hurts SEO).
- Check that you got something called "schema" (looks something like `<script type="application/ld+json">...`) and blocks containing `<meta property="og:..." content=..."`, these are SEO stuff. No idea how it works, but I hope the LLM got it correctly.
- Check that the legal.html renders correctly, proof read it and make sure all the licenses are in the input folder and are rendered out correctly (safest way to make sure licenses that requires the licence text to be included in the website).
- Check that the `site_settings.json` actually works and is utilized for the generated website.
- Double check that `status_check.sh`/`status_check.bat` actually catchers errors and broken links etc and that `status_check.html` shows correct data and said errors etc. It's important to know if you have made some mistake when updating the site and there is an visual and easy way to just see what pages have problems.
- When using justified text alignment, check that the very last row for any text isn't too spaced out, check that the last row of text is sensibly cut off. Note: Check that KaTeX isn't getting odd alignment issues too, that it's not aligned to the right/left when it's supposed to be centered and so on.
- Make sure KaTeX syntax parts are rendered out with the KaTeX font and not mixed up with another fonts glyphs (rare instances can occur where other fonts hijacks the glyphs).
- If you choose to have a full view port hero page, consider having a "click here to scroll down" text button that scrolls past the hero page. Have this text button animate in after 2 seconds the page load, this is in case users don't understand that they have to scroll to see the actual content.
- Check that the RSS utilizes everything in the YAML: title, description, thumbnail and so on so it looks correct for visitors using RSS readers.




---

Make sure to ask the LLM for logic checks, bug hunts, code evaluations and SEO errors/faults and so on every now and then (from a new session as if it has never seen the code before). 

For the page builder app, ask for for risk of data corruption or accidental deletions and so on to mitigate code that could cause errors that could cause unwarranted deletions of files. 

Make sure to prompt the LLM to make sure status_check.sh/.bat works correctly and wants you about important stuff, it's your own troubleshooting script when you don't have access to LLM for typo errors or files being too large and so on. 


---


## A lot of content (example: Massive markdown dump)


If you got a lot content (+100 posts), consider:
- Make the `input_markdown/` folder have subfolder support or even nested folder support (note that you have to tweak how media files are linked so it doesn't break and so on). Maybe even let the blog render folders as special cards with its own thumbnail and so on. Maybe consider having a logic where the you got a `thumbnail/` where the website generator pick random images for the folders from or take a random image from within the folder. Make sure you got nested folder logic to work and check, LLM can hallucinate broken links and breadcrumb logic and so on, so you got to test and make sure links and media loads properly. Note: consider ditching the page builder posts since now the code might become fragile. If you are having a bunch of unsorted markdown notes, maybe include a logic to deal with missing YAML (filename becomes the title, thumbnail is randomly selected from the same folder and tag is "misc").
- The search bar logic to utilize "Pagefind" (a static search library). A single file to store all the data can scale really bad.

If you got a huge markdown folder that you have from Obsidian/Logseq and so on, maybe just prompt the LLM to have a logic to copy and convert content to html and automatically compress all the media images (that needs it). 

## Media

How you want to structure  `svg/,` `image/`, `video/` and `gif/` the folders should be up to you, also depending if the code can generate the correct links so the page is not broken. You can tweak them to maybe have them inside each input folders so it's more consistent. Instead of having to deal with content of `image_min/`, you can the image pair file in the same folder as the original image or even just automatic compression at the cost of build time to have the `*_min` file generated when building the site (might not be as good quality compression as custom tweaked and costs build time for larger sites). 

