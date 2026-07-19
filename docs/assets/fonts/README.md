# Fonts — OpenAI Sans

The OpenAI Sans WOFF2 files live in this folder and are wired up in
`assets/css/style.css` via `@font-face`. Full family (5 weights × normal/italic):

```
paper_page/assets/fonts/
├── OpenAISans-Light.woff2    / -LightItalic.woff2      (300)
├── OpenAISans-Regular.woff2  / -RegularItalic.woff2    (400)
├── OpenAISans-Medium.woff2   / -MediumItalic.woff2     (500)
├── OpenAISans-Semibold.woff2 / -SemiboldItalic.woff2   (600)   ← lowercase "b"
└── OpenAISans-Bold.woff2     / -BoldItalic.woff2        (700)
```

Each face only downloads when that weight/style is actually rendered. If the
files are ever missing, the page falls back to **Inter** and still looks clean.

> **Filename casing matters.** GitHub Pages / Linux are case-sensitive, so the
> CSS must reference `OpenAISans-Semibold.woff2` (lowercase "b") exactly — which
> it now does.

## Licensing

OpenAI Sans is a **proprietary typeface**. Embedding it on your own project page
is generally fine, but **committing the font files to a public git repo
redistributes them**, which the license may not permit. See the note in the
project response about whether to commit these `.woff2` files or keep them
untracked and upload them to the host separately.
