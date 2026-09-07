---
title: More markdown
date: 2026-08-07
tags: [test, gallery]
image: /card_thumbnail/some_text_just_works.jpg
description: Every shape a run of images can take, and what the layout does with it.
draft: false
author: Joe
category: [category_1, category_2, another category]
---

What happens now with this post, it has two more yaml?

# Markdown + KaTeX Stress Test

This document tests **bold**, *italic*, ***bold italic***, ~~strikethrough~~,
`inline code`, [links](https://example.com), and escaped characters such as
\*literal asterisks\*, \_literal underscores\_, and \$literal dollar signs\$.

A forced line break follows.  
This is the next line.

---

## Lists

- Item one
  - Nested item
  - Nested item containing $x^2 + y^2 = z^2$
- Item two
- Item three

1. First
2. Second
   1. Nested first
   2. Nested second

- [x] Completed task
- [ ] Incomplete task

> This is a blockquote containing inline math:
> $E = mc^2$
>
> > Nested blockquote with $\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$.

---

## Table

| Expression | KaTeX | Result |
|---|---:|---|
| Pythagorean theorem | `$a^2+b^2=c^2$` | $a^2+b^2=c^2$ |
| Euler's identity | `$e^{i\pi}+1=0$` | $e^{i\pi}+1=0$ |
| Integral | `$\int_0^1 x^2\,dx$` | $\int_0^1 x^2\,dx$ |
| Set membership | `$x \in \mathbb{R}$` | $x \in \mathbb{R}$ |

---

## Inline mathematics

Inline delimiters:

- `$x^2 + y^2 = z^2$`
- `\( \frac{1}{1+x^2} \)`
- `$f(x) = \sin(x) + \cos(x)$`
- `$a_{ij}$`, `$x^{n+1}$`, and `$\sqrt[n]{x}$`
- `$\alpha, \beta, \gamma, \Delta, \Omega$`
- `$\leq \geq \neq \approx \equiv \propto$`
- `$\forall x \in \mathbb{R},\; x^2 \geq 0$`

Examples:

The quadratic formula is
$x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$.

A probability density may be written as
$f(x) = \frac{1}{\sqrt{2\pi\sigma^2}}
e^{-\frac{(x-\mu)^2}{2\sigma^2}}$.

---

## Display mathematics

Euler's identity:

$$
e^{i\pi} + 1 = 0
$$

A definite integral:

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

A limit:

\[
\lim_{n\to\infty}
\left(1+\frac{1}{n}\right)^n = e
\]

An aligned equation:

$$
\begin{aligned}
f(x)
  &= (x+1)^2 - (x-1)^2 \\
  &= (x^2+2x+1) - (x^2-2x+1) \\
  &= 4x
\end{aligned}
$$

A piecewise function:

$$
f(x)=
\begin{cases}
-x, & x < 0, \\
0,  & x = 0, \\
x,  & x > 0.
\end{cases}
$$

---

## Matrices and linear algebra

$$
A =
\begin{bmatrix}
1 & 2 & 3 \\
0 & 1 & 4 \\
5 & 6 & 0
\end{bmatrix}
$$

$$
\det(A)
=
\begin{vmatrix}
a & b \\
c & d
\end{vmatrix}
= ad - bc
$$

$$
\mathbf{x}
=
\begin{pmatrix}
x_1 \\
x_2 \\
\vdots \\
x_n
\end{pmatrix},
\qquad
\|\mathbf{x}\|_2
=
\sqrt{\sum_{i=1}^{n} x_i^2}
$$

---

## Calculus and analysis

$$
\nabla f =
\left(
\frac{\partial f}{\partial x},
\frac{\partial f}{\partial y},
\frac{\partial f}{\partial z}
\right)
$$

$$
\frac{d}{dx}\left[
\int_{0}^{x} e^{-t^2}\,dt
\right]
= e^{-x^2}
$$

$$
\oint_{\partial \Omega} \mathbf{F}\cdot d\mathbf{r}
=
\iint_{\Omega}
\left(
\frac{\partial Q}{\partial x}
-
\frac{\partial P}{\partial y}
\right)\,dA
$$

---

## Logic, sets, and number theory

$$
\forall \varepsilon > 0,\;
\exists \delta > 0
\text{ such that }
0 < |x-a| < \delta
\implies
|f(x)-f(a)| < \varepsilon
$$

$$
A \subseteq B,\qquad
A \cup B,\qquad
A \cap B,\qquad
A \setminus B
$$

$$
\gcd(a,b)
=
\min\{d \in \mathbb{N} : d\mid a \text{ and } d\mid b\}
$$

---

## Long expression

$$
\hat{\theta}
=
\arg\min_{\theta \in \Theta}
\left[
-\sum_{i=1}^{n}
\left(
y_i \log \sigma(\theta^\top x_i)
+
(1-y_i)\log\left(1-\sigma(\theta^\top x_i)\right)
\right)
+
\lambda \|\theta\|_2^2
\right]
$$

---

## Markdown inside and around math

Text before $x$, text after $x$.

**Bold text with inline math:** **$E = mc^2$**

*Italic text with inline math:* *$\nabla \cdot \mathbf{E} = \rho/\varepsilon_0$*

A displayed equation can be surrounded by paragraphs:

Before the equation.

$$
\sum_{k=0}^{n} \binom{n}{k} x^k y^{n-k}
= (x+y)^n
$$

After the equation.

---

## Code blocks

Inline code should not render math: `$x^2$`.

```python
def f(x):
    return x**2 + 1

# This string contains math markup: "$x^2$"
```

```latex
\[
\int_0^\infty e^{-x}\,dx = 1
\]
```

---

## Special characters and edge cases

Currency: \$5, \$10, and \$100.

Literal Markdown characters: \* \_ \# \+ \- \. \! \[ \] \( \) \{ \}.

Backslash: `\`

HTML-style inline markup: <kbd>Ctrl</kbd> + <kbd>C</kbd>.

---

## Footnote-style Markdown

A statement with a footnote.[^note]

[^note]: Footnote text containing inline math: $a^2+b^2=c^2$.

---

## Final mixed stress test

> **Theorem.** For $n \geq 1$,
>
> $$
> \sum_{k=1}^{n} k
> =
> \frac{n(n+1)}{2}.
> $$



# KaTeX Markdown Stress Test Suite

Below is a comprehensive Markdown document designed to stress-test KaTeX rendering capabilities within a Markdown environment. This covers inline vs. display math, complex structures, markdown syntax conflicts, and edge cases.

**Note:** To use this, copy the content below into a Markdown file rendered by a tool that supports KaTeX (e.g., Obsidian, MkDocs with KaTeX plugin, or a custom HTML setup). Standard Markdown parsers without KaTeX will show the raw LaTeX code.

---

## 1. Delimiter Sensitivity
Tests different delimiter styles. Some parsers require `\( \)` while others accept `$ $`.

- **Inline (Dollar):** $E = mc^2$ and $a \ne b$.
- **Inline (Parenthesis):** \( \int_0^1 x \, dx \) and \( \sum_{i=0}^n i \).
- **Display (Dollar):** $$ \nabla \times \mathbf{E} = -\frac{\partial \mathbf{B}}{\partial t} $$
- **Display (Bracket):** \[ \mathbf{F} = m\mathbf{a} \]

**Stress Point:** Ensure currency symbols or single dollar signs (e.g., $50) do not trigger math mode unintentionally if the parser is strict.

**Price test:** The price is $50.00, not $100.00.

---

## 2. Superscripts, Subscripts, and Grouping
Tests braces `{}` and underscore/caret behavior, which often conflicts with Markdown italics/bold.

- **Subscripts:** $x_i$, $x_{ij}$, $a_{n+1}$, $x_{max}$
- **Superscripts:** $x^2$, $x^{n}$, $e^{-\lambda t}$
- **Combined:** $x_i^2$, $R_{max}^2$
- **Markdown Conflict:** Does `x_i` render as math or italic text `x_i`?
    - Math mode: $x_i$
    - Raw text: x_i (should not be italic if escaped or in code)
    - Bold conflict: $**x**$ vs $\mathbf{x}$

---

## 3. Fractions, Roots, and Binomials
Tests vertical spacing and nested structures.

- **Simple Fraction:** $\frac{1}{2}$
- **Complex Fraction:** $\frac{\frac{1}{2}}{3}$
- **Nested:** $\frac{1}{\sqrt{2} + \frac{1}{\sqrt{3}}}$
- **Roots:** $\sqrt{x}$, $\sqrt[3]{y}$, $\sqrt[n]{x}$
- **Binomial:** $\binom{n}{k}$
- **Legendre:** $P_n(x)$

---

## 4. Greek Letters and Symbols
Tests symbol coverage and case sensitivity.

- **Lowercase:** $\alpha, \beta, \gamma, \delta, \epsilon, \varepsilon, \zeta, \eta, \theta, \vartheta, \iota, \kappa, \lambda, \mu, \nu, \xi, \pi, \varpi, \rho, \varrho, \sigma, \varsigma, \tau, \upsilon, \phi, \varphi, \chi, \psi, \omega$
- **Uppercase:** $\Gamma, \Delta, \Theta, \Lambda, \Xi, \Pi, \Sigma, \Upsilon, \Phi, \Psi, \Omega$
- **Operators:** $\pm, \mp, \times, \div, \ast, \star, \dagger, \ddagger, \cdot, \cap, \cup, \vee, \wedge, \oplus, \otimes, \odot, \oslash$
- **Relations:** $\le, \ge, \neq, \approx, \equiv, \sim, \simeq, \cong, \propto, \in, \ni, \notin, \subset, \supset, \subseteq, \supseteq, \perp, \parallel$
- **Arrows:** $\leftarrow, \rightarrow, \leftrightarrow, \Leftarrow, \Rightarrow, \Leftrightarrow, \mapsto, \to, \uparrow, \downarrow, \updownarrow$
- **Miscellaneous:** $\infty, \aleph, \emptyset, \nabla, \partial, \triangleleft, \triangleright, \angle, \neg, \vee, \wedge, \forall, \exists, \nexists, \therefore, \because$

---

## 5. Delimiters and Scaling
Tests automatic sizing with `\left` and `\right`.

- **Parentheses:** $(a+b)$, $\left( \frac{a}{b} \right)$
- **Brackets:** $[a, b]$, $\left[ \frac{a}{b} \right]$
- **Braces:** $\{a, b\}$, $\left\{ \frac{a}{b} \right\}$ (Note: need escape `\{`)
- **Angles:** $\langle \psi | \phi \rangle$, $\left\langle \frac{a}{b} \right\rangle$
- **Bars:** $|x|$, $\left| \frac{a}{b} \right|$
- **Double Bars:** $\|x\|$, $\left\| \frac{a}{b} \right\|$
- **Ceiling/Floor:** $\lceil x \rceil$, $\lfloor x \rfloor$, $\left\lceil \frac{a}{b} \right\rceil$

---

## 6. Matrices and Arrays
Tests alignment and complex structures.

$$
\begin{pmatrix}
a & b & c \\
d & e & f \\
g & h & i
\end{pmatrix}
$$

$$
\begin{bmatrix}
1 & 2 \\
3 & 4
\end{bmatrix}
\quad
\begin{vmatrix}
a & b \\
c & d
\end{vmatrix}
\quad
\begin{Bmatrix}
x & y \\
z & w
\end{Bmatrix}
$$

$$
\begin{array}{c|l|c}
\text{Left} & \text{Center} & \text{Right} \\
\hline
1 & 2 & 3 \\
4 & 5 & 6
\end{array}
$$

**Cases Environment:**
$$
f(n) =
\begin{cases}
n/2 & \text{if } n \text{ is even} \\
3n+1 & \text{if } n \text{ is odd}
\end{cases}
$$

---

## 7. Operators, Limits, and Sums
Tests large operators and limit positioning.

- **Sums:** $\sum_{i=1}^n i$, $\sum_{k=0}^\infty \frac{1}{k!}$
- **Products:** $\prod_{i=1}^n x_i$
- **Integrals:** $\int_a^b f(x) \, dx$, $\iint_D f(x,y) \, dA$, $\iiint_V \rho \, dV$
- **Limits:** $\lim_{x \to 0} \frac{\sin x}{x}$
- **Coproducts:** $\coprod_{i=1}^n$
- **Disjoint Union:** $\sqcup$, $\oplus$

---

## 8. Text, Spacing, and Formatting within Math
Tests mixing text and math, and controlling spacing.

- **Text:** $\text{This is text inside math mode.}$ vs $\mathrm{This is roman.}$
- **Spacing:** $a\!b$ (negative), $ab$ (normal), $a\,b$ (thin), $a\:b$ (medium), $a\;b$ (thick), $a\quad b$, $a\qquad b$
- **Colors (if supported):** $\color{red}{x} + \color{blue}{y} = \color{green}{z}$
- **Bold:** $\mathbf{x} \in \mathbb{R}^n$
- **Calligraphic:** $\mathcal{A}, \mathcal{B}, \mathcal{C}$
- **Blackboard:** $\mathbb{N}, \mathbb{Z}, \mathbb{Q}, \mathbb{R}, \mathbb{C}$
- **Fraktur:** $\mathfrak{a}, \mathfrak{b}$
- **Accents:** $\hat{x}$, $\check{x}$, $\tilde{x}$, $\acute{x}$, $\grave{x}$, $\dot{x}$, $\ddot{x}$, $\bar{x}$, $\vec{x}$, $\overrightarrow{AB}$, $\overleftrightarrow{AB}$

---

## 9. Markdown Syntax Conflicts (Critical Stress Test)
This section tests if Markdown rendering interferes with KaTeX.

| Feature | Test Case | Expected Rendering |
| :--- | :--- | :--- |
| **Underscore** | `$x_i$` | Math subscript (not italic) |
| **Asterisk** | `$x^*$` vs `*$x*$` | Math superscript vs potential italic conflict |
| **Backslash** | `$\alpha$` | Greek letter (not escaped char) |
| **Hash** | `$x \# y$` | Hash symbol (not header trigger) |
| **Brackets** | `[$x$]` vs `\[ x \]` | Link syntax vs display math |
| **Code Span** | `` `$x$` `` | Should appear as literal text, not rendered |

**Specific Conflicts:**
1.  **Italics:** `This is $x_i$ text.` vs `This is _x_i_ text.`
2.  **Bold:** `**$x$**` vs `$\mathbf{x}$`
3.  **Headers:** `## $x^2$` Should not break header syntax.
4.  **Links:** `[Link](http://$x$)` vs `[Link](url)` containing math.

---

## 10. Long Equations and Line Breaking
KaTeX does not support automatic line breaking within display math. This tests overflow behavior.

$$
\begin{aligned}
\text{This is a very long equation that should ideally wrap but usually overflows in KaTeX: } \\
E &= \sum_{i=1}^{N} \left( \frac{1}{2} m_i v_i^2 \right) + \sum_{j=1}^{M} \left( \frac{1}{2} k_j x_j^2 \right) \\
&\quad + \sum_{k=1}^{K} \left( \frac{1}{2} I_k \omega_k^2 \right) + \text{Potential Energy Terms}
\end{aligned}
$$

**Inline Long Equation:** Note that inline math like $\frac{1}{\sqrt{2\pi\sigma^2}} e^{-\frac{(x-\mu)^2}{2\sigma^2}}$ might overflow line height if not configured properly.

---

## 11. Advanced Features (If Supported)
Tests extensions often found in full MathJax but partial in KaTeX.

- **Tagging:** $$ E = mc^2 \tag{1} $$
- **Referencing:** As seen in equation \eqref{eq:emc} (requires specific plugin support).
- **Over/Under Arrows:** $\overbrace{a+b+\cdots+z}^{26}$, $\underbrace{x_1 + \cdots + x_n}_{n}$
- **Stacking:** $\overset{\text{def}}{=} $, $\underset{\text{label}}{x}$
- **Boxed:** $\boxed{x^2 + y^2 = z^2}$
- **Cancel (if `\require{cancel}` works):** $\require{cancel} \cancel{x^2}$ (Note: KaTeX often requires macro loading)
- **Color:** $\color{#FF5733}{Highlighted}$

---

## 12. Edge Cases and Escaping
- **Underscore in text:** Use `\_` to escape. Test: $x_1$ vs $x\_1$.
- **Ampersand:** `&` is special in arrays, test in text $a \& b$.
- **Percent:** `%` is comment in LaTeX, test in text $50\%$.
- **Hash:** `\#` in math.
- **Zero Width:** $\phantom{x}$, $\vphantom{y}$, $\hphantom{z}$.
- **Sizing:** $\tiny{x}$, $\small{x}$, $\normalsize{x}$, $\large{x}$, $\Large{x}$, $\huge{x}$, $\Huge{x}$ (KaTeX support varies).
- **Kerning:** $A\!B$ (negative space).

---

## 13. Raw Markdown Block (Code)
To prevent rendering of the source, wrap in code blocks.

```latex
\begin{equation}
  \int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}
\end{equation}
```

```math
  \begin{pmatrix} a & b \\ c & d \end{pmatrix}
```

---

## 14. Chemical Formulas (Semantics Only)
KaTeX is not designed for chemistry, but tests bonding syntax coincidences.

- $\text{H}_2\text{O}$
- $\text{CO}_2$
- $\text{C}_6\text{H}_{12}\text{O}_6$

---

## Conclusion
This suite checks:
1.  **Delimiter recognition** (`$`, `$$`, `\( \)`, `\[ \]`).
2.  **Markdown interference** (underscores, asterisks, hashes).
3.  **Complex nesting** (fractions inside matrices inside cases).
4.  **Symbol coverage** (Greek, operators, arrows).
5.  **Spacing and sizing** (delimiters, text, colors).
6.  **Overflow handling** (long equations).

If all sections render correctly without raw LaTeX leaking into the view (except in code blocks), the KaTeX Markdown integration is robust.