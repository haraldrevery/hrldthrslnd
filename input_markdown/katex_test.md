---
title: Blog Title
date: 2026-04-27
tags: [tag_1, tag_2]
image: /notebook_thumbnails/default.jpg
description: Blog description.
draft: true
---

Sure! Here’s a long markdown test piece featuring a mix of prose, headings, lists, tables, and various KaTeX math renderings — useful for checking how markdown and LaTeX rendering work together.  

***

$$ \omega \cdot \sum_i^S$$

## Markdown and KaTeX Test Document

### Introduction

This document serves as a **comprehensive test** of markdown formatting combined with *KaTeX expressions*. It includes headers, bold/italic text, lists, tables, and inline/block math renderings. The goal is to verify that mathematical notation integrates smoothly into complex text.

For example, the quadratic formula is written inline as \(x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}\).

***

### Section 1: Lists and Basic Math

#### Unordered list:
- The area of a circle: \(A = \pi r^2\)
- The circumference of a circle: \(C = 2\pi r\)
- The volume of a sphere: \(V = \frac{4}{3}\pi r^3\)

#### Ordered list:
1. Let’s solve \(2x + 3 = 11\).
2. Subtract 3 from both sides: \(2x = 8\).
3. Divide by 2: \(x = 4\).

***

### Section 2: Table with Equations

| Concept             | Formula                                   | Description                          |
|---------------------|-------------------------------------------|--------------------------------------|
| Kinetic Energy      | \(E_k = \frac{1}{2}mv^2\)                 | Energy due to motion                 |
| Potential Energy    | \(E_p = mgh\)                             | Energy in a gravitational field      |
| Ideal Gas Law       | \(PV = nRT\)                              | Relationship between pressure and volume |
| Wave Equation       | \(\lambda = \frac{v}{f}\)                 | Links wavelength, speed, and frequency |

***

### Section 3: Display Equations

Some equations are best shown as blocks:

\[
\int_{a}^{b} f(x)\,dx = F(b) - F(a)
\]

The above represents the **Fundamental Theorem of Calculus**, which connects differentiation and integration.

For physics, the Schrödinger equation in one dimension:

\[
i\hbar \frac{\partial \Psi(x,t)}{\partial t} = -\frac{\hbar^2}{2m}\frac{\partial^2 \Psi(x,t)}{\partial x^2} + V(x)\Psi(x,t)
\]

***

### Section 4: Text and Inline Math Blend

Let’s summarize some concepts within regular text:

If you consider acceleration \(a = \frac{dv}{dt}\), you’ll notice that integrating it gives velocity:  
\(\int a\,dt = v + C\), where \(C\) is the constant of integration.  
Similarly, integrating velocity gives position: \(\int v\,dt = s + C\).

This nested chain of derivatives means that position \(s(t)\) can be expressed as a second-degree function of time if acceleration is constant:  
\(s(t) = \frac{1}{2}at^2 + v_0t + s_0\).

***

### Section 5: Complex Equations

Fluid dynamics includes the **Navier–Stokes equations**:

\[
\rho\left(\frac{\partial \mathbf{v}}{\partial t} + (\mathbf{v}\cdot\nabla)\mathbf{v}\right)
= -\nabla p + \mu \nabla^2 \mathbf{v} + \mathbf{f}
\]

They describe how velocity fields evolve in continuous fluids.

Electromagnetism, on the other hand, is compactly expressed via **Maxwell’s equations** in differential form:

\[
\nabla \cdot \mathbf{E} = \frac{\rho}{\varepsilon_0}, \quad
\nabla \cdot \mathbf{B} = 0, \quad
\nabla \times \mathbf{E} = -\frac{\partial \mathbf{B}}{\partial t}, \quad
\nabla \times \mathbf{B} = \mu_0 \mathbf{J} + \mu_0 \varepsilon_0 \frac{\partial \mathbf{E}}{\partial t}
\]

***

### Section 6: Multiline Expressions

\[
\begin{align}
a^2 + b^2 &= c^2 \\
E &= mc^2 \\
y &= mx + b
\end{align}
\]

Here we combine several common formulas: the **Pythagorean Theorem**, **Einstein’s mass–energy equivalence**, and the **equation of a line**.

***

### Section 7: Test of Inline Variations

Some complex inline forms include:

- Binomial theorem: \( (x + y)^n = \sum_{k=0}^{n} \binom{n}{k}x^{n-k}y^k \)
- Euler’s identity: \( e^{i\pi} + 1 = 0 \)
- Definition of derivative: \( f'(x) = \lim_{h \to 0} \frac{f(x+h) - f(x)}{h} \)

***

### Section 8: Nested Math Contexts

Working with vectors:

\[
\mathbf{F} = q(\mathbf{E} + \mathbf{v} \times \mathbf{B})
\]

And tensor notation:

\[
T_{ij} = \frac{\partial u_i}{\partial x_j}
\]

You can see how different mathematical entities appear naturally in markdown with LaTeX formatting.

***

Would you like me to extend this further with **statistics and probability formulas** (such as distributions and expected values) to complete the test?

Here’s a bigger **stress-test** markdown block with more KaTeX edge cases, mixed delimiters, alignment, matrices, sets, cases, and markdown collisions. KaTeX supports a broad set of math functions and environments such as `align`, `gather`, `cases`, and `CD`, so this covers many common rendering paths. [katex](https://katex.org/docs/supported.html)

# Stress Test Document

## 1. Inline math chaos

Normal text with inline math like \(a^2 + b^2 = c^2\), \(e^{i\pi} + 1 = 0\), and \(\frac{d}{dx}\sin x = \cos x\). KaTeX also supports standard LaTeX-style inline and display math syntax, which is what most markdown integrations rely on. [unmarkdown](https://unmarkdown.com/blog/katex-math-markdown)

Mixed punctuation should not break rendering: parentheses \((x+y)^n\), commas, semicolons, and text after formulas. In markdown previews, characters like `%` can be tricky because `%` is a comment character in TeX/KaTeX, so escaping matters in real documents. [github](https://github.com/microsoft/vscode/issues/138921)

## 2. Display equations

\[
\int_0^\infty e^{-x}\,dx = 1
\]

\[
\sum_{k=0}^{n} \binom{n}{k} x^{n-k} y^k = (x+y)^n
\]

\[
\lim_{x \to 0} \frac{\sin x}{x} = 1
\]

Multi-line aligned equations are a useful stress test, and KaTeX supports aligned environments such as `align` and `split`. [katex](https://katex.org/docs/supported.html)

\[
\begin{align}
f(x) &= x^2 + 2x + 1 \\
     &= (x+1)^2
\end{align}
\]

## 3. Matrices and vectors

\[
\mathbf{A} =
\begin{bmatrix}
1 & 2 & 3 \\
0 & -1 & 4 \\
7 & 8 & 9
\end{bmatrix}
\]

\[
\mathbf{v} =
\begin{pmatrix}
x \\
y \\
z
\end{pmatrix}
\qquad
\mathbf{F} = m\mathbf{a}
\]

\[
\det(\mathbf{A}) \neq 0 \implies \mathbf{A}^{-1} \text{ exists}
\]

## 4. Piecewise and logic

KaTeX can render environments like `cases`, which is helpful for testing branchy expressions. [github](https://github.com/KaTeX/KaTeX/issues/1481)

\[
f(x) =
\begin{cases}
x^2, & x \ge 0 \\
-x, & x < 0
\end{cases}
\]

\[
P(A \mid B) = \frac{P(B \mid A)P(A)}{P(B)}
\]

\[
A \land B \implies C \quad \text{and} \quad A \lor B \iff C
\]

## 5. Tables with math

| Concept | Inline | Display |
|---|---|---|
| Energy | \(E=mc^2\) | \(\displaystyle E = mc^2\) |
| Derivative | \(f'(x)\) | \(\displaystyle \frac{d}{dx}f(x)\) |
| Probability | \(P(A\mid B)\) | \(\displaystyle \sum_{x \in S} p(x)=1\) |
| Matrix | \(\mathbf{M}\) | \(\displaystyle \begin{bmatrix}1&0\\0&1\end{bmatrix}\) |

## 6. Markdown collision checks

This line includes underscore-heavy text_which_might_confuse_markdown and should be checked alongside math like \(\underbrace{a}_{b}\). Markdown parsing can accidentally interfere with math delimiters, especially when underscores or emphasis markers appear near TeX content. [discourse.gohugo](https://discourse.gohugo.io/t/how-to-render-math-equations-properly-with-katex/40998/4)

Here is code-style text: `\alpha`, `\beta`, `\gamma`, and a literal dollar-like pattern should be treated carefully in real renderers. KaTeX-based markdown workflows often use either dollar delimiters or LaTeX delimiters, depending on the parser and platform. [auteng](https://auteng.ai/docs/guides/katex-guide)

## 7. Bigger formulas

\[
\prod_{k=1}^{n} k = n!
\]

\[
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
\]

\[
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
\]

\[
\nabla \cdot \mathbf{E} = \frac{\rho}{\varepsilon_0}
\qquad
\nabla \times \mathbf{B} = \mu_0 \mathbf{J} + \mu_0 \varepsilon_0 \frac{\partial \mathbf{E}}{\partial t}
\]

## 8. Nested environments

KaTeX supports display environments such as `gather`, `equation`, and `CD`, which makes them useful for stress testing parser coverage. 

\[
\begin{gather}
a=b+c \\
e=f+g \\
h=i+j
\end{gather}
\]

\[
\begin{CD}
A @>f>> B \\
@VgVV @VVhV \\
C @= D
\end{CD}
\]

## 9. Long mixed paragraph

When a markdown renderer processes mathematics, it usually has to separate prose from math nodes first, then turn the math into KaTeX output. That is why a sentence can include \(x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}\), another formula like \(\ln(ab)=\ln a + \ln b\), and still keep surrounding formatting intact. The best stress tests include real-world collisions: code spans, emphasis, nested punctuation, escaped symbols, and multiline equations in the same document. [github]

## 10. Final monster block

\[
\begin{aligned}
S &= \left\{ x \in \mathbb{R} : x^2 - 4x + 3 = 0 \right\} \\
  &= \{1,3\}
\end{aligned}
\]

\[
\forall x \in \mathbb{R},\; x^2 \ge 0
\qquad
\exists y \in \mathbb{R} : y^2 = 2
\]

\[
\left( \sum_{i=1}^{n} i \right)^2
=
\left(\frac{n(n+1)}{2}\right)^2
\]

If you want, I can make the next version even harsher with escaped backslashes, deeply nested lists, raw HTML, and deliberately messy TeX delimiters.
