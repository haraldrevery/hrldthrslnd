---
title: Stress test
date: 2026-02-05
tags: [test, template]
image: /image/2016moremountains.jpg
description: Markdown and KaTeX stress test.
draft: false
---



# Markdown & KaTeX Stress Test

## 1. Text Formatting

**Bold text**, *italic text*, ***bold italic***, ~~strikethrough~~, `inline code`, and a mix like **bold with `code` inside** or *italic with **nested bold***.

Superscript-ish: H<sub>2</sub>O, and E = mc<sup>2</sup> (HTML fallback).

A line with a footnote reference[^1].

[^1]: This is the footnote content.

---

## 2. Headings

# H1 Heading 

Don't use H1 since YAML generates the H1 for the post.

## H2 Heading
### H3 Heading
#### H4 Heading
##### H5 Heading
###### H6 Heading

---

## 3. Lists

**Unordered:**
- Item one
- Item two
  - Nested item 2a
  - Nested item 2b
    - Deeply nested item
- Item three

**Ordered:**
1. First step
2. Second step
   1. Sub-step A
   2. Sub-step B
3. Third step

**Task list:**
- [x] Completed task
- [ ] Incomplete task
- [ ] Another pending task

---

## 4. Blockquotes

> This is a simple blockquote.
>
> > This is a nested blockquote.
> >
> > It continues here.

---

## 5. Code Blocks

Inline: `const x = 42;`

```python
def fibonacci(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a

print(fibonacci(10))
```

```javascript
const stress = (data) => data.map(x => x ** 2).filter(x => x > 10);
console.log(stress([1, 2, 3, 4, 5]));
```

---

## 6. Tables

| Feature | Supported | Notes |
|---|:---:|---|
| Tables | ✅ | Aligned columns |
| Math | ✅ | Inline and block |
| Code | ✅ | Syntax highlighting |
| Nesting | ⚠️ | Depends on renderer |

| Left | Center | Right |
|:-----|:------:|------:|
| a | b | c |
| longer text | x | 1.23 |

---

## 7. Links and Images

[A link to Anthropic](https://www.haraldrevery.com)

![Alt text for an image](/image/2016mountains_and_clouds.jpg "Optional title")

Autolink: <https://haraldrevery.com>

---

## 8. Horizontal Rules

---
***
___

---

## 9. Inline Math (KaTeX)

Euler's identity: $e^{i\pi} + 1 = 0$

Quadratic formula: $x = \dfrac{-b \pm \sqrt{b^2 - 4ac}}{2a}$

A simple fraction $\frac{1}{2}$ and a Greek soup: $\alpha, \beta, \gamma, \delta, \Omega, \Sigma, \theta, \lambda, \mu, \pi$.

Inequality chain: $0 \le \epsilon < \delta \le 1$

---

## 10. Block Math (KaTeX)

**Integral:**

$$
\int_{-\infty}^{\infty} e^{-x^2}\, dx = \sqrt{\pi}
$$

**Summation and product:**

$$
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
\qquad
\prod_{k=1}^{n} k = n!
$$

**Limits:**

$$
\lim_{x \to 0} \frac{\sin x}{x} = 1
$$

**Matrix:**

$$
A = \begin{pmatrix}
a_{11} & a_{12} & a_{13} \\
a_{21} & a_{22} & a_{23} \\
a_{31} & a_{32} & a_{33}
\end{pmatrix}
$$

**Piecewise function:**

$$
f(x) =
\begin{cases}
x^2 & \text{if } x \geq 0 \\
-x^2 & \text{if } x < 0
\end{cases}
$$

**Aligned equations:**

$$
\begin{aligned}
(a+b)^2 &= a^2 + 2ab + b^2 \\
(a-b)^2 &= a^2 - 2ab + b^2 \\
(a+b)(a-b) &= a^2 - b^2
\end{aligned}
$$

**Partial derivatives and vector calculus:**

$$
\nabla \cdot \mathbf{E} = \frac{\rho}{\varepsilon_0}, \qquad
\nabla \times \mathbf{B} - \frac{1}{c^2}\frac{\partial \mathbf{E}}{\partial t} = \mu_0 \mathbf{J}
$$

**Nested fractions and roots:**

$$
\sqrt{1 + \sqrt{1 + \sqrt{1 + \cdots}}} = \frac{1 + \sqrt{5}}{2}
$$

**Binomial coefficient:**

$$
\binom{n}{k} = \frac{n!}{k!(n-k)!}
$$

**Set notation and logic:**

$$
\forall \epsilon > 0,\ \exists \delta > 0 : |x - a| < \delta \implies |f(x) - f(a)| < \epsilon
$$

$$
A \cup B, \quad A \cap B, \quad A \subseteq B, \quad x \in \mathbb{R}, \quad \mathbb{N} \subset \mathbb{Z} \subset \mathbb{Q} \subset \mathbb{R} \subset \mathbb{C}
$$

---

## 11. Mixed Content Torture Test

> **Note:** The eigenvalues $\lambda_i$ of a matrix $A$ satisfy $\det(A - \lambda I) = 0$, as shown in the table below.

| Matrix Type | Eigenvalue Condition | Example |
|---|---|---|
| Symmetric | $\lambda \in \mathbb{R}$ | $\begin{pmatrix} 2 & 1 \\ 1 & 2 \end{pmatrix}$ |
| Orthogonal | $\lvert \lambda \rvert = 1$ | $\begin{pmatrix} 0 & -1 \\ 1 & 0 \end{pmatrix}$ |

1. First, compute $\det(A)$.
2. Then solve $A\mathbf{x} = \lambda \mathbf{x}$ for `x`.
3. Verify with:
   ```python
   import numpy as np
   A = np.array([[2, 1], [1, 2]])
   eigvals, eigvecs = np.linalg.eig(A)
   ```

---

This stress test evaluates markdown formatting, standard syntax edge cases, and complex KaTeX mathematical rendering.

## Typographic and Formatting Edge Cases

Markdown parsers often fail when dealing with nested emphasis, inline code containing delimiters, and character escaping.

- Standard paragraph text containing `code spans with `backticks` inside` using multiple delimiter sets.
- Nested formatting: *italic with **bold inside** text* and **bold with *italic inside* text**.
- Autolinks, formatted links like [Perplexity Home](https://www.perplexity.ai), and escaped brackets: \[not a link\].
- Strikethrough combined with code: ~~`deprecatedMethod()`~~.

> Blockquotes can contain headers, code blocks, and math:
> 
> \[
> \oint_{\partial \Sigma} \mathbf{E} \cdot d\boldsymbol{\ell} = -\frac{\partial}{\partial t} \iint_{\Sigma} \mathbf{B} \cdot d\mathbf{S}
> \]

## Multi-Column Table Layout

Tables require strict delimiter alignment and frequently handle mixed content such as inline math and code tokens.

| Expression Type | LaTeX / KaTeX Syntax | Rendered Output | Status |
| :--- | :--- | :--- | :---: |
| Inline Limit | `\lim_{x \to 0} \frac{\sin x}{x}` | \(\lim_{x \to 0} \frac{\sin x}{x} = 1\) | Verified |
| Inline Matrix | `\begin{pmatrix} a & b \\ c & d \end{pmatrix}` | \(\begin{pmatrix} a & b \\ c & d \end{pmatrix}\) | Verified |
| Continued Fraction | `a_0 + \frac{1}{a_1 + \frac{1}{a_2}}` | \(a_0 + \cfrac{1}{a_1 + \cfrac{1}{a_2}}\) | Verified |
| Special Function | `\zeta(s) = \sum \frac{1}{n^s}` | \(\zeta(s) = \sum_{n=1}^{\infty} \frac{1}{n^s}\) | Verified |

## Deeply Nested Lists and Task Tracking

- Top-level item A covering parsing rules.
- Top-level item B verifying task list syntax.
- [x] Completed task checkbox.
- [ ] Uncompleted task checkbox.
- Numbered item 1 inside a separate list sequence:
1. First ordered item.
2. Second ordered item with math \(\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}\).

## Advanced KaTeX Matrices and Systems

Large matrices and piecewise systems test vertical spacing, bracket alignment, and multi-line alignment rendering.

\[
\mathbf{J} = \begin{bmatrix}
\dfrac{\partial f_1}{\partial x_1} & \dfrac{\partial f_1}{\partial x_2} & \cdots & \dfrac{\partial f_1}{\partial x_n} \\[1em]
\dfrac{\partial f_2}{\partial x_1} & \dfrac{\partial f_2}{\partial x_2} & \cdots & \dfrac{\partial f_2}{\partial x_n} \\[1em]
\vdots & \vdots & \ddots & \vdots \\[1em]
\dfrac{\partial f_m}{\partial x_1} & \dfrac{\partial f_m}{\partial x_2} & \cdots & \dfrac{\partial f_m}{\partial x_n}
\end{bmatrix}
\]

\[
f(x, y) = \begin{cases}
\dfrac{x^3 y - x y^3}{x^2 + y^2} & \text{if } (x, y) \neq (0, 0) \\[1ex]
0 & \text{if } (x, y) = (0, 0)
\end{cases}
\]

## Complex Formulae and Symbols

This section tests complex operator stacking, diacritics, big operators, tensor indices, and font variants.

\[
\mathcal{L}_{\text{SM}} = -\frac{1}{4} F_{\mu\nu}^a F^{a\mu\nu} + i \bar{\psi} \cancel{D} \psi + |D_\mu \phi|^2 - V(\phi) + \left( y_{ij} \bar{\psi}_i \phi \psi_j + \text{h.c.} \right)
\]

\[
\frac{1}{\pi} = \frac{2\sqrt{2}}{9801} \sum_{k=0}^{\infty} \frac{(4k)!(1103 + 26390k)}{(k!)^4 396^{4k}}
\]

\[
\left( \prod_{j=1}^{n} \hat{A}_j \right)^\dagger = \overbrace{\hat{A}_n^\dagger \hat{A}_{n-1}^\dagger \cdots \hat{A}_1^\dagger}^{\text{reversal of operator ordering}} \qquad \text{where } \mathbb{E}[X] = \int_{\Omega} X(\omega) \, d\mathbb{P}(\omega)
\]