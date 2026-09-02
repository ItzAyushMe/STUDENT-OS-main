// ============================================================
// StudentOS — MathText
// Renders AI output as readable text even when the model slips in
// LaTeX. Converts common LaTeX commands to Unicode/plain notation
// (\frac{a}{b} → (a)/(b), \sqrt{x} → √(x), \lfloor x \rfloor → ⌊x⌋).
// Used by Tutor bubbles, quiz questions and flashcards.
// ============================================================
import React from 'react';
import { Text } from 'react-native';
import { fonts } from '../../config/theme';

export function mathify(input) {
  let t = String(input || '');
  // strip math delimiters: $$...$$, $...$, \(...\), \[...\]
  t = t.replace(/\$\$([^$]+)\$\$/g, '$1').replace(/\$([^$\n]+)\$/g, '$1');
  t = t.replace(/\\\((.+?)\\\)/gs, '$1').replace(/\\\[(.+?)\\\]/gs, '$1');
  // fractions (single level of nesting tolerated)
  for (let i = 0; i < 2; i++) {
    t = t.replace(/\\d?frac\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, '($1)/($2)');
  }
  // roots & floors
  t = t.replace(/\\sqrt\[([^\]]+)\]\{([^{}]+)\}/g, 'root$1($2)');
  t = t.replace(/\\sqrt\{([^{}]+)\}/g, '√($1)');
  t = t.replace(/\\sqrt\s+([A-Za-z0-9.]+)/g, '√$1');
  t = t.replace(/\\lfloor\s*([^{}\\]+?)\s*\\rfloor/g, '⌊$1⌋');
  t = t.replace(/\\lceil\s*([^{}\\]+?)\s*\\rceil/g, '⌈$1⌉');
  t = t.replace(/\\left\s*\\lfloor([^\\]*?)\\right\s*\\rfloor/g, '⌊$1⌋');
  // operators & relations
  t = t
    .replace(/\\times/g, '×')
    .replace(/\\cdot/g, '·')
    .replace(/\\div/g, '÷')
    .replace(/\\pm/g, '±')
    .replace(/\\leq?/g, '≤')
    .replace(/\\geq?/g, '≥')
    .replace(/\\neq?/g, '≠')
    .replace(/\\approx/g, '≈')
    .replace(/\\infty/g, '∞')
    .replace(/\\int\b/g, '∫')
    .replace(/\\sum\b/g, 'Σ')
    .replace(/\\prod\b/g, 'Π')
    .replace(/\\partial/g, '∂')
    .replace(/\\rightarrow|\\to\b/g, '→')
    .replace(/\\Rightarrow|\\implies/g, '⇒')
    .replace(/\\leftrightarrow/g, '↔')
    .replace(/\\Leftrightarrow/g, '⇔')
    .replace(/\\degree|\\circ/g, '°')
    .replace(/\\prime/g, "'");
  // greek letters
  t = t
    .replace(/\\alpha/g, 'α')
    .replace(/\\beta/g, 'β')
    .replace(/\\gamma/g, 'γ')
    .replace(/\\delta/g, 'δ')
    .replace(/\\Delta/g, 'Δ')
    .replace(/\\epsilon/g, 'ε')
    .replace(/\\theta/g, 'θ')
    .replace(/\\lambda/g, 'λ')
    .replace(/\\mu/g, 'μ')
    .replace(/\\pi/g, 'π')
    .replace(/\\sigma/g, 'σ')
    .replace(/\\Sigma/g, 'Σ')
    .replace(/\\omega/g, 'ω')
    .replace(/\\Omega/g, 'Ω')
    .replace(/\\phi/g, 'φ');
  // superscript/subscript braces
  t = t.replace(/\^\{([^{}]+)\}/g, '^($1)').replace(/_\{([^{}]+)\}/g, '_($1)');
  // leftover structural LaTeX
  t = t.replace(/\\left|\\right/g, '');
  t = t.replace(/\\begin\{[^}]*\}|\\end\{[^}]*\}|\\quad|\\qquad|\\;|\\,|\\!|\\text\{([^{}]*)\}|\\mathrm\{([^{}]*)\}/g, '$1$2');
  t = t.replace(/\\displaystyle/g, '');
  // collapse double spaces created by removals
  t = t.replace(/[ \t]{2,}/g, ' ');
  return t;
}

// Drop-in replacement for <Text> that mathifies the content first.
export function MathText({ children, style, numberOfLines, ...rest }) {
  return (
    <Text style={[{ fontFamily: fonts.body }, style]} numberOfLines={numberOfLines} {...rest}>
      {mathify(children)}
    </Text>
  );
}
